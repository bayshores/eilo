import asyncio
import base64
import unittest

from app.gmail_source import GmailSourceError, read_thread, search_threads


def encoded(value):
    return base64.urlsafe_b64encode(value.encode()).decode().rstrip("=")


class RecordedRequest:
    """Test transport only; production receives the authenticated app request callable."""

    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []

    async def __call__(self, url, params=None):
        self.calls.append((url, dict(params or {})))
        return next(self.responses)


class GmailSourceTests(unittest.TestCase):
    def run_async(self, coroutine):
        return asyncio.run(coroutine)

    def test_search_is_one_bounded_page_with_no_completion_claim(self):
        request = RecordedRequest(
            [{"threads": [{"id": "a"}, {"id": "a"}, {"id": "b"}], "nextPageToken": "next"}]
        )
        result = self.run_async(
            search_threads(request, "from:example@example.com", max_threads=2, page_token="prior")
        )
        self.assertEqual(
            result, {"thread_ids": ["a", "b"], "nextPageToken": "next", "has_more": True}
        )
        url, params = request.calls[0]
        self.assertEqual(url, "https://gmail.googleapis.com/gmail/v1/users/me/threads")
        self.assertEqual(params["maxResults"], "2")
        self.assertEqual(params["pageToken"], "prior")
        self.assertIn("threads(id)", params["fields"])

    def test_search_rejects_unsafe_bounds_and_incomplete_collections(self):
        for bad in (0, 31, True):
            with self.assertRaises(GmailSourceError):
                self.run_async(search_threads(RecordedRequest([]), "in:inbox", max_threads=bad))
        with self.assertRaisesRegex(GmailSourceError, "search query"):
            self.run_async(search_threads(RecordedRequest([]), "bad\nquery"))
        with self.assertRaisesRegex(GmailSourceError, "incomplete"):
            self.run_async(search_threads(RecordedRequest([{"threads": {}}]), "in:inbox"))

    def test_read_prefers_plain_text_over_html_and_preserves_source_ids(self):
        payload = {
            "id": "thread/1",
            "messages": [
                {
                    "id": "message-1",
                    "threadId": "thread/1",
                    "payload": {
                        "mimeType": "multipart/alternative",
                        "headers": [
                            {"name": "Subject", "value": "Hello\n world"},
                            {"name": "From", "value": "Sender <s@example.com>"},
                            {"name": "Date", "value": "Tue"},
                        ],
                        "parts": [
                            {
                                "mimeType": "text/html",
                                "body": {
                                    "data": encoded(
                                        "<p>HTML <b>copy</b></p><script>ignore()</script>"
                                    )
                                },
                            },
                            {"mimeType": "text/plain", "body": {"data": encoded("Plain body")}},
                            {
                                "mimeType": "application/pdf",
                                "body": {"attachmentId": "never-fetched"},
                            },
                        ],
                    },
                }
            ],
        }
        request = RecordedRequest([payload])
        result = self.run_async(read_thread(request, "thread/1"))
        self.assertEqual(result["id"], "thread/1")
        self.assertEqual(result["messages"][0]["id"], "message-1")
        self.assertEqual(result["messages"][0]["thread_id"], "thread/1")
        self.assertEqual(result["messages"][0]["subject"], "Hello world")
        self.assertEqual(result["messages"][0]["excerpt"], "Plain body")
        self.assertNotIn("attachment", request.calls[0][0])
        self.assertEqual(request.calls[0][1]["format"], "full")
        self.assertIn("payload", request.calls[0][1]["fields"])

    def test_read_html_nested_parts_and_all_truncation_signals(self):
        payload = {
            "id": "t",
            "messages": [
                {
                    "id": "m1",
                    "threadId": "t",
                    "payload": {
                        "parts": [
                            {
                                "parts": [
                                    {
                                        "mimeType": "text/html",
                                        "body": {
                                            "data": encoded(
                                                "<div>Hello</div><style>hide</style><p>there</p>"
                                            )
                                        },
                                    }
                                ]
                            }
                        ]
                    },
                },
                {
                    "id": "m2",
                    "threadId": "t",
                    "payload": {"mimeType": "text/plain", "body": {"data": encoded("second")}},
                },
            ],
        }
        result = self.run_async(
            read_thread(RecordedRequest([payload]), "t", max_messages=1, max_chars=5)
        )
        self.assertEqual(result["messages"][0]["excerpt"], "secon")
        self.assertEqual(result["messages"][0]["id"], "m2")
        self.assertTrue(result["messages"][0]["truncated"])
        self.assertTrue(result["truncated"])

    def test_thread_url_is_quoted_and_invalid_or_mismatched_responses_fail_safely(self):
        request = RecordedRequest([{"id": "a/b", "messages": []}])
        self.run_async(read_thread(request, "a/b"))
        self.assertTrue(request.calls[0][0].endswith("threads/a%2Fb"))
        with self.assertRaisesRegex(GmailSourceError, "incomplete"):
            self.run_async(
                read_thread(RecordedRequest([{"id": "other", "messages": []}]), "wanted")
            )
        with self.assertRaises(GmailSourceError):
            self.run_async(read_thread(RecordedRequest([]), "t", max_chars=18_001))

    def test_malformed_mime_data_is_omitted_and_marked_truncated(self):
        payload = {
            "id": "t",
            "messages": [
                {
                    "id": "m",
                    "threadId": "t",
                    "payload": {
                        "mimeType": "text/plain",
                        "body": {"data": "not valid base64!"},
                    },
                }
            ],
        }
        result = self.run_async(read_thread(RecordedRequest([payload]), "t"))
        self.assertEqual(result["messages"][0]["excerpt"], "")
        self.assertTrue(result["messages"][0]["truncated"])

    def test_transport_details_do_not_escape(self):
        async def broken(url, params=None):
            raise RuntimeError("private network detail")

        with self.assertRaises(GmailSourceError) as caught:
            self.run_async(search_threads(broken, "in:inbox"))
        self.assertEqual(
            str(caught.exception), "Gmail could not be read. Please try reconnecting it."
        )


if __name__ == "__main__":
    unittest.main()

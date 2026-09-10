import json
import unittest

from app.stream_text import JsonTextPreview


def event_preview() -> JsonTextPreview:
    return JsonTextPreview(
        "message", required={"event_id": "event-1"}, allowed={"decision": {"ask", "check_in"}}
    )


def human_preview() -> JsonTextPreview:
    return JsonTextPreview(
        "reply",
        required={"request_id": "request-1"},
        allowed={"kind": {"chat", "clarify", "update"}},
    )


class JsonTextPreviewTests(unittest.TestCase):
    def feed_chars(self, preview, value):
        emitted = []
        for char in value:
            result = preview.feed(char)
            if result is not None:
                emitted.append(result)
        return emitted

    def test_every_character_boundary_decodes_only_the_gated_top_level_message(self):
        source = json.dumps({"event_id": "event-1", "decision": "ask", "message": "Hello"})
        emitted = self.feed_chars(event_preview(), source)
        self.assertEqual(emitted[-1], "Hello")
        self.assertNotIn("event-1", emitted)

    def test_required_and_allowed_fields_must_complete_before_target(self):
        self.assertEqual(
            self.feed_chars(
                event_preview(),
                json.dumps({"message": "early", "event_id": "event-1", "decision": "ask"}),
            ),
            [],
        )
        self.assertEqual(
            self.feed_chars(
                event_preview(),
                json.dumps({"event_id": "wrong", "decision": "ask", "message": "no"}),
            ),
            [],
        )
        self.assertEqual(
            self.feed_chars(
                event_preview(),
                json.dumps({"event_id": "event-1", "decision": "quiet", "message": "no"}),
            ),
            [],
        )
        self.assertEqual(
            self.feed_chars(
                human_preview(),
                json.dumps({"request_id": "request-1", "kind": "update", "reply": "Provisional"}),
            )[-1],
            "Provisional",
        )

    def test_nested_targets_duplicates_and_prefix_garbage_never_leak(self):
        self.assertEqual(
            self.feed_chars(
                event_preview(),
                json.dumps(
                    {
                        "event_id": "event-1",
                        "decision": "ask",
                        "operations": [{"message": "secret"}],
                    }
                ),
            ),
            [],
        )
        self.assertEqual(
            self.feed_chars(
                event_preview(),
                '{"event_id":"event-1","event_id":"event-1","decision":"ask","message":"no"}',
            ),
            [],
        )
        self.assertEqual(
            self.feed_chars(
                event_preview(), '```json {"event_id":"event-1","decision":"ask","message":"no"}'
            ),
            [],
        )

    def test_escapes_surrogates_and_injection_like_text_are_decoded_without_lone_surrogates(self):
        text = 'quote " brace } newline\n emoji 😀 {"event_id":"wrong"}'
        source = json.dumps(
            {"event_id": "event-1", "decision": "check_in", "message": text}, ensure_ascii=True
        )
        emitted = self.feed_chars(event_preview(), source)
        self.assertEqual(emitted[-1], text)
        self.assertTrue(
            all(not any(0xD800 <= ord(char) <= 0xDFFF for char in value) for value in emitted)
        )

    def test_caps_malformed_and_never_called_callback_have_no_extra_output(self):
        preview = JsonTextPreview(
            "message",
            required={"event_id": "event-1"},
            allowed={"decision": {"ask"}},
            max_chars=3,
            max_input=80,
        )
        emitted = self.feed_chars(
            preview, json.dumps({"event_id": "event-1", "decision": "ask", "message": "abcdef"})
        )
        self.assertEqual(emitted[-1], "abc")
        self.assertIsNone(preview.feed("more"))
        self.assertEqual(
            self.feed_chars(
                event_preview(), '{"event_id":"event-1","decision":"ask","message":"\\q"}'
            ),
            [],
        )
        self.assertEqual([], [])  # A provider that never invokes feed exposes nothing.

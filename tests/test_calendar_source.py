import asyncio
import unittest
from datetime import datetime, timezone

from app.calendar_source import CalendarSourceError, fetch_calendars, fetch_events


class FakeRequest:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []

    async def __call__(self, url, params=None):
        self.calls.append((url, dict(params or {})))
        return next(self.responses)


class TransportFailure(Exception):
    def __init__(self, code):
        self.code = code


class CalendarSourceTests(unittest.TestCase):
    def run_async(self, coroutine):
        return asyncio.run(coroutine)

    def test_calendar_pagination_and_reader_filter(self):
        request = FakeRequest([
            {"items": [{"id": "one", "summary": " Main\n", "primary": True, "accessRole": "owner"}, {"id": "busy", "accessRole": "freeBusyReader"}], "nextPageToken": "next"},
            {"items": [{"id": "two", "summaryOverride": " Work\t", "accessRole": "reader"}]},
        ])
        self.assertEqual(self.run_async(fetch_calendars(request)), [
            {"id": "one", "name": "Main", "primary": True, "selected": False},
            {"id": "two", "name": "Work", "primary": False, "selected": False},
        ])
        self.assertEqual(request.calls[1][1]["pageToken"], "next")

    def test_calendar_field_mask_known_empty_response_and_duplicates(self):
        request = FakeRequest([
            {"kind": "calendar#calendarList"},
        ])
        self.assertEqual(self.run_async(fetch_calendars(request)), [])
        fields = request.calls[0][1]["fields"]
        self.assertIn("accessRole", fields)
        self.assertNotIn("description", fields)
        self.assertNotIn("location", fields)

        duplicate = FakeRequest([
            {"items": [{"id": "one", "summary": "One", "accessRole": "reader"}], "nextPageToken": "two"},
            {"items": [{"id": "one", "summary": "Changed", "accessRole": "reader"}]},
        ])
        self.assertEqual(len(self.run_async(fetch_calendars(duplicate))), 1)

    def test_calendar_repeated_or_incomplete_pagination_fails(self):
        with self.assertRaisesRegex(CalendarSourceError, "repeated"):
            self.run_async(fetch_calendars(FakeRequest([
                {"items": [], "nextPageToken": "again"}, {"items": [], "nextPageToken": "again"},
            ])))
        with self.assertRaisesRegex(CalendarSourceError, "incomplete"):
            self.run_async(fetch_calendars(FakeRequest([{}])))
        with self.assertRaisesRegex(CalendarSourceError, "invalid .*page token"):
            self.run_async(fetch_calendars(FakeRequest([{"items": [], "nextPageToken": 7}])))

    def test_known_selection_and_safe_calendar_url(self):
        calendars = [{"id": "team/a@example.com", "name": "Team"}]
        request = FakeRequest([{"items": []}])
        self.run_async(fetch_events(request, calendars, ["team/a@example.com"], datetime(2026, 9, 9, 16, tzinfo=timezone.utc)))
        self.assertIn("team%2Fa%40example.com", request.calls[0][0])
        with self.assertRaisesRegex(CalendarSourceError, "no longer available"):
            self.run_async(fetch_events(FakeRequest([]), calendars, ["unknown"]))
        with self.assertRaisesRegex(CalendarSourceError, "at most 10"):
            self.run_async(fetch_events(FakeRequest([]), [{"id": str(i), "name": str(i)} for i in range(11)], [str(i) for i in range(11)]))

    def test_transport_safe_error_codes_are_preserved(self):
        async def offline_request(url, params=None):
            raise TransportFailure("offline")

        with self.assertRaises(CalendarSourceError) as caught:
            self.run_async(fetch_calendars(offline_request))
        self.assertEqual(caught.exception.code, "offline")

        async def unsafe_request(url, params=None):
            raise TransportFailure("provider-detail-should-not-cross-boundary")

        with self.assertRaises(CalendarSourceError) as caught:
            self.run_async(fetch_calendars(unsafe_request))
        self.assertIsNone(caught.exception.code)

    def test_event_filters_all_day_and_stable_recurring_instance_ids(self):
        calendars = [{"id": "cal", "name": "Calendar"}]
        request = FakeRequest([{"items": [
            {"id": "cancelled", "status": "cancelled", "start": {"dateTime": "2026-09-10T10:00:00Z"}, "end": {"dateTime": "2026-09-10T11:00:00Z"}},
            {"id": "declined", "attendees": [{"self": True, "responseStatus": "declined"}], "start": {"dateTime": "2026-09-10T10:00:00Z"}, "end": {"dateTime": "2026-09-10T11:00:00Z"}},
            {"id": "all-day", "summary": "Trip", "start": {"date": "2026-09-10"}, "end": {"date": "2026-09-13"}},
            {"id": "instance-a", "summary": "Standup", "start": {"dateTime": "2026-09-10T09:00:00-07:00"}, "end": {"dateTime": "2026-09-10T09:30:00-07:00"}},
            {"id": "instance-b", "summary": "Standup", "start": {"dateTime": "2026-09-11T09:00:00-07:00"}, "end": {"dateTime": "2026-09-11T09:30:00-07:00"}},
        ]}])
        events = self.run_async(fetch_events(request, calendars, ["cal"], datetime(2026, 9, 9, 9, tzinfo=timezone.utc)))
        self.assertEqual([(event["start"], event["end"], event["all_day"]) for event in events[:1]], [("2026-09-10", "2026-09-13", True)])
        self.assertEqual(events[1]["start"], "2026-09-10T09:00:00-07:00")
        self.assertNotEqual(events[1]["id"], events[2]["id"])
        repeated_instance = {"id": "instance-a", "summary": "Standup", "start": {"dateTime": "2026-09-10T09:00:00-07:00"}, "end": {"dateTime": "2026-09-10T09:30:00-07:00"}}
        self.assertEqual(events[1]["id"], self.run_async(fetch_events(FakeRequest([{"items": [repeated_instance]}]), calendars, ["cal"]))[0]["id"])

    def test_utc_window_and_event_pagination_errors(self):
        calendars = [{"id": "cal", "name": "Calendar"}]
        request = FakeRequest([{"items": [], "nextPageToken": "same"}, {"items": [], "nextPageToken": "same"}])
        with self.assertRaisesRegex(CalendarSourceError, "repeated"):
            self.run_async(fetch_events(request, calendars, ["cal"], datetime(2026, 9, 9, 23, tzinfo=timezone.utc)))
        first_params = request.calls[0][1]
        self.assertEqual(first_params["timeMin"], "2026-09-09T00:00:00Z")
        self.assertEqual(first_params["timeMax"], "2026-10-09T00:00:00Z")
        self.assertEqual(first_params["singleEvents"], "true")
        self.assertNotIn("syncToken", first_params)
        self.assertIn("attendees(self,responseStatus)", first_params["fields"])
        self.assertNotIn("description", first_params["fields"])
        self.assertNotIn("location", first_params["fields"])
        with self.assertRaisesRegex(CalendarSourceError, "timezone"):
            self.run_async(fetch_events(FakeRequest([]), calendars, ["cal"], datetime(2026, 9, 9)))
        with self.assertRaisesRegex(CalendarSourceError, "invalid .*page token"):
            self.run_async(fetch_events(FakeRequest([{"items": [], "nextPageToken": 7}]), calendars, ["cal"]))

    def test_event_known_empty_response_and_cross_page_deduplication(self):
        calendars = [{"id": "cal", "name": "Calendar"}]
        self.assertEqual(self.run_async(fetch_events(FakeRequest([{"kind": "calendar#events"}]), calendars, ["cal"])), [])
        event = {"id": "one", "start": {"dateTime": "2026-09-10T10:00:00Z"}, "end": {"dateTime": "2026-09-10T11:00:00Z"}}
        request = FakeRequest([
            {"items": [event], "nextPageToken": "two"},
            {"items": [event]},
        ])
        self.assertEqual(len(self.run_async(fetch_events(request, calendars, ["cal"]))), 1)


if __name__ == "__main__":
    unittest.main()

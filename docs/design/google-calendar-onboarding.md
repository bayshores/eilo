# Google Calendar onboarding

September 10, 2026. Implemented against the real Google API; developer configuration is complete, and the native Connect flow opens real Google sign-in. Real account consent, four selected calendars and a 42-event sync are verified. No sample calendar or simulated onboarding is served to users.

## User flow

Connections offers Google Calendar alongside the existing optional browser source. Users connect through Google's account/consent page in their normal browser, return to felis, choose calendars, and save the selection. The Calendar panel uses real connection status, readable labels, checkboxes, keyboard focus, optional access details, and cancellation/reconnect paths. End users do not create a Cloud project, paste tokens, or configure API credentials.

Selected upcoming events populate Today and a day view. Source events remain separate from goals and never imply attendance, task completion or an instruction to prepare work. Pause stops refresh; reconnect repairs lost access; disconnect removes the local credential and calendar projection and attempts Google revocation. If Google is unreachable, the UI distinguishes local disconnection from revoking the provider grant.

This initial version reads Calendar events and keeps the view on the Mac. It does not read Docs/Drive or the separate Google Tasks API. Calendar details are not included in human/event model prompts. The motivational role remains support for the user's own commitments, with no unsolicited preparation plans. Calendar-driven AI outreach still needs its separately disclosed context and delivery integration.

## Implementation boundaries

- Desktop OAuth client, Authorization Code + PKCE S256/state, one-use callback on a random 127.0.0.1 port, short-lived loopback listener and a static completion page. Electron opens only the exact current server-issued authorization URL with the fixed read/identity scopes. The renderer remains locked to the existing local app origin.
- Requested scopes: openid, email, calendar.calendarlist.readonly and calendar.events.readonly. Google grants calendar-list/event reading across accessible calendars; felis filters event requests to the calendars explicitly selected in the app. No event-edit scopes are requested.
- Refresh/access credentials are stored using the explicit macOS Keychain backend of pinned keyring 25.7.0. There is no plaintext fallback. The private local projection retains only account identity, selected calendar metadata and bounded event fields. Credential values never appear in the app snapshot, renderer, source repository or model prompt.
- Narrow API field masks omit event descriptions, locations and attendee email addresses. The current reader supports up to ten selected calendars and 1,000 normalized events, with bounded pagination. It refreshes a rolling UTC-day-to-30-day window every five minutes while felis runs, backs off on failure, and catches up after resume. It does not claim to run through sleep, logout or explicit Quit.
- A rolling date-window fetch is intentionally not combined with syncToken, which Google forbids with timeMin/timeMax/orderBy. Recurring instances keep provider identities; cancelled and self-declined events are excluded. Date-only all-day boundaries stay date-only and end-exclusive. Events and source permissions are revalidated before local replacement.
- Startup does not authorize Google or read the Keychain when no connection is configured. OAuth/account changes, synchronization, pause and disconnect use a generation guard so abandoned operations cannot publish newer-looking stale data. Keychain operations are serialized through completion even if their awaiting task is cancelled.

## Developer setup and release gate

Create a dedicated Google Cloud project and enable the service named `calendar-json.googleapis.com` (the Calendar API). Configure the app identity in Google Auth Platform and create a **Desktop app** OAuth client. For development, use External/Testing and list only intended testers. Import the downloaded Desktop client JSON with:

```sh
./scripts/configure-google-calendar /path/to/desktop-client.json
```

The importer retains only client_id and an optional installed-client client_secret in ignored `.state/google-calendar-client.json`. Installed-app secrets are not a confidentiality boundary; refresh tokens are the sensitive credential kept in Keychain. No sign-in tokens are bundled. The existing development app still relies on its configured checkout. A distributed build must include the developer client configuration and supported secure runtime, not make end users perform these steps.

Testing is not a production onboarding release: Google limits listed test users and expires Calendar test grants after seven days. Public users need the appropriate audience/publication and OAuth verification work before relying on unattended access. School/work accounts may also have administrator restrictions.

## Developer configuration checkpoint

September 10: the dedicated project and Calendar API are configured, a Desktop app client is stored privately outside Git, and the console shows External Testing with one approved test account. Declared scopes match the read-only and identity scopes above. The user completed the Google contact/terms steps. No production publication or billing connection was made.

## Verification checkpoint

The initial integration passed 102 Python, 76 frontend and 27 desktop checks. Subsequent conversation/Calendar fixes passed 112 Python checks and the three focused Calendar frontend checks. Existing automation tests validate source normalization, route boundaries, state/gesture regressions and the restricted authorization URL. They do not prove live Google behavior. The desktop bundle was rebuilt and reopened; the real Connections entry and Escape/focus return were inspected. The conversation, messages and goals matched their pre-restart fingerprints. No mock calendar, test user events or model request was inserted into the running app. The latest native restart again preserved the conversation, messages and goals. Connect Google Calendar opened Google’s actual account selection/sign-in in the system Chrome browser using the configured Desktop client. The user completed real Google consent. The successful completion page and native picker agree, and the authenticated Calendar API returned four calendars. The successful callback wrote credentials through the macOS Keychain backend before loading that list. The user subsequently saved all four calendars. The native app reused its Keychain credential after restart and successfully synchronized 42 events, all from the selected IDs, with no error. A real-API investigation found that a single network read could yield incomplete JSON; bounded accumulation through EOF fixed that defect. Retry sync checks the existing grant without marking connected until the actual reads succeed. The existing conversation, ten messages and saved goal remained unchanged.

## Primary references

- [Google desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Events list and query restrictions](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Testing audience limits](https://support.google.com/cloud/answer/15549945)
- [Python keyring](https://keyring.readthedocs.io/en/latest/)
- [Electron external-browser API](https://www.electronjs.org/docs/latest/api/shell)

Mobbin references inspected: [Toggl Calendar connection](https://mobbin.com/flows/e7d31aeb-c172-499c-aa99-fa3db9c33b5e) for a visible connected account/calendar list, and [Motion connection](https://mobbin.com/flows/afb6188a-6313-41c8-a2b6-c19e7f876c8d) for connect-to-selection progression. No reference screenshots or scheduling wizard are embedded.

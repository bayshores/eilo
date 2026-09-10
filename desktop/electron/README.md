# eïlo desktop development build

This first Electron host opens the existing Home, Goals, Activity and inline conversation in a native macOS window. It uses the canonical checkout's Python/Hermes service and saved state. The packaged development app **requires that checkout and its configured local runtime**. It is not yet a standalone, signed hackathon installer.

## Run and build

From `desktop/electron`, using Node 24 and npm:

```sh
npm ci
npm test
npm start
npm run package:mac
```

The macOS app is written under `.runtime/desktop-build/`. The generated bundle contains the pinned Electron runtime, desktop host and original eïlo wordmark icon. An ignored `checkout.json` resource points to the source checkout. The Python/Hermes environment, local Whisper files, conversation database and account credentials are not copied into the app bundle. Do not distribute this development bundle as a self-contained release.

## Window and backend behavior

- Closing the window, including Command-W, hides it and keeps eïlo resident. Reopen from the menu-bar icon, Dock or **Open eïlo**.
- **Quit eïlo** / Command-Q stops a backend started by this desktop process, waits for its bounded cleanup and exits. A service that was already running is left intact.
- Startup checks a local identity endpoint for the exact checkout before attaching. Another server, malformed response or timeout cannot be treated as a free port. Concurrent starts share one operation; cleanup holds only the exact child handle it spawned.
- An unexpected owned-service exit is shown in the menu and the UI reconnects without resending messages. **Reconnect to workspace** can start the service again. No login item or automatic launch-at-login is installed.
- Browser clients remain available at the existing loopback address while the service is running. Conversation and goals live in the same native store; desktop layout and browser layout preferences are separate. A draft survives hiding/reopening the window and ordinary reload; this increment does not promise unsent-draft recovery after quitting the application.

## Check-in notifications

Notifications start off. In the native **eïlo** menu or menu-bar icon, select **Check-in notifications** and confirm. **Send test notification** becomes available after enabling. macOS notification settings and Focus can still suppress delivery.

The host checks existing final check-ins every four seconds while enabled. First adoption, re-enabling and conversation changes baseline existing history quietly. It records identifiers before requesting a notification, shows at most the latest new check-in per poll, and suppresses duplicates and foreground alerts. The OS preview is generic; message text stays inside eïlo. Clicking a notification opens its existing check-in in the inline conversation without replacing the selected native conversation or starting inference. An obsolete target reports that it is no longer in the current conversation.

Preferences, a bounded seen list and a small lifecycle diagnostic are stored under ignored `.state/desktop/`. The Chromium profile is private to that folder. Message text is not copied into notification preferences or diagnostics. This local suppression policy favors avoiding repeated interruptions; it is not the durable outreach outbox in the implementation plan, and an OS request does not prove a banner was seen or read. Already accepted OS notifications cannot always be retracted before they are seen.

## Speech and permissions

The existing **Speak** control still uses local transcription and an editable draft. Starting it may ask for macOS microphone permission. The host admits only audio requests from the focused top-level Home; camera, screen capture, device access and arbitrary notification requests are denied. Recording does not begin at startup. The renderer has no Node access, uses context isolation and a sandbox, cannot open additional windows or navigate to another origin, and receives only a narrowly validated check-in target through preload IPC.

Activity sharing is unchanged. The currently permitted Chrome integration still requires its connection page and lease. Keeping Electron resident alone does not create an always-running browser observer or automatically complete tasks. No new model context, model provider, collection source or microphone permission was enabled by this build.

## Verification — September 9, 2026

- 26 desktop tests: backend ownership and concurrency; native entry-point behavior with stubbed Electron; permission/origin and preload boundaries; notification baselining, history bounds, foreground suppression and duplicate handling.
- 66 frontend tests and four focused Python route tests passed. The new desktop identity route uses existing Host/Origin/client-header boundaries.
- The packaged Apple Silicon app rendered the accepted Home in a native window. Native close/Command-W, reopen, an unsent draft, and explicit Quit were exercised. The verification draft was cleared without sending.
- Both ownership cases passed: Quit left an already-running backend untouched; a fresh desktop launch started its own backend, kept it alive when the window closed, and stopped it on Quit. The final native exit is scheduled after the cancelled quit event unwinds; calling it inside the cleanup microtask had left the first test process resident.
- The saved conversation, messages and goal state matched pre-test fingerprints after desktop-owned startup. No test prompts were sent to the live conversation, and activity and notifications remained off.
- Packaged sources matched reviewed files; the app archive contains only host code and its icon assets, without private state, credentials, Python files or development dependencies. The standard ICNS icon was verified in the bundle. The packager's optional Icon Composer-format warning does not mean the ICNS icon is missing.

**Not yet verified:** a real OS notification/banner and click round trip, microphone permission and real microphone capture in Electron, signing/notarization, standalone Python/Whisper distribution, Windows support and the full autonomous outreach loop. These are separate acceptance steps, not implied by the passing lifecycle tests.

See [the platform decision](../../design/desktop-platform.md) and [the proactive outreach plan](../../design/proactive-outreach-plan.md). Electron's [security guidance](https://www.electronjs.org/docs/latest/tutorial/security), [notification API](https://www.electronjs.org/docs/latest/api/notification) and [permission handlers](https://www.electronjs.org/docs/latest/api/session#sessetpermissionrequesthandlerhandler) informed the host boundaries.

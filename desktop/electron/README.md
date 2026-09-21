# felis desktop development build

This Electron host opens Home, Goals, Activity and inline conversation in a native macOS window. It is a local development build, not released or a standalone signed installer.

## Run and build

From `desktop/electron`, using Node 24 and npm:

```sh
npm ci
npm test
npm start
npm run package:mac
```

The macOS build output contains the pinned Electron runtime, desktop host and felis wordmark icon. Runtime state, local models, conversation data and credentials are not copied into the app bundle. Do not distribute this development bundle as a self-contained release.

## Window and backend behavior

- Closing the window, including Command-W, hides it and keeps felis resident. Reopen from the menu-bar icon, Dock or **Open felis**.
- **Quit felis** / Command-Q stops a backend started by this desktop process, waits for its bounded cleanup and exits. A service that was already running is left intact.
- Startup checks a local identity endpoint for the exact checkout before attaching. Another server, malformed response or timeout cannot be treated as a free port. Concurrent starts share one operation; cleanup holds only the exact child handle it spawned.
- An unexpected owned-service exit is shown in the menu and the UI reconnects without resending messages. **Reconnect to workspace** can start the service again. No login item or automatic launch-at-login is installed.
- Browser clients remain available at the existing loopback address while the service is running. Conversation and goals live in the same native store; desktop layout and browser layout preferences are separate. A draft survives hiding/reopening the window and ordinary reload; this increment does not promise unsent-draft recovery after quitting the application.

## Check-in notifications

Chrome setup is available in **Connections → Browser activity** and Activity's **Set up Chrome** action. The native Chrome bridge is registered at development and standalone startup. Registration does not install or connect an extension, grant host access, or enable collection; native browser capture requires an actual grant and connected extension. The optional page bridge remains a legacy compatibility path. **Open in Chrome** opens only the fixed local connection page through macOS; its IPC accepts no URL or command and requires the focused, trusted main Home frame.

Notifications start off. In the native **felis** menu or menu-bar icon, select **Check-in notifications** and confirm. **Send test notification** becomes available after enabling. macOS notification settings and Focus can still suppress delivery.

The host checks existing final check-ins every four seconds while enabled. First adoption, re-enabling and conversation changes baseline existing history quietly. It records identifiers before requesting a notification, shows at most the latest new check-in per poll, and suppresses duplicates and foreground alerts. The OS preview is generic; message text stays inside felis. Clicking a notification opens its existing check-in in the inline conversation without replacing the selected native conversation or starting inference. An obsolete target reports that it is no longer in the current conversation.

A current eligible check-in also gets a compact black-and-rose overlay while felis is out of focus. It uses the same animated particle orb, Geist typography, controls and motion language as Home; entry, content updates and both actions transition without taking focus. It shows the already-delivered assistant text, dismisses itself after 45 seconds, and opens the existing conversation only after a click. The overlay is independent of the macOS alert preference and does not expose browser or desktop-source details.

Preferences, a bounded seen list and a small lifecycle diagnostic are app-managed local state. Message text is not copied into notification preferences or diagnostics. This suppression policy favors avoiding repeated interruptions; it is not the durable outreach outbox in the implementation plan, and an OS request does not prove a banner was seen or read. Already accepted OS notifications cannot always be retracted before they are seen.

## Speech and permissions

The existing **Speak** control still uses local transcription and an editable draft. Starting it may ask for macOS microphone permission. The host admits only audio requests from the focused top-level Home; camera, screen capture, device access and arbitrary notification requests are denied. Recording does not begin at startup. The renderer has no Node access, uses context isolation and a sandbox, cannot open additional windows or navigate to another origin, and receives only a narrowly validated check-in target through preload IPC.

Activity sharing is unchanged and independently consented. Keeping Electron resident alone does not create a browser observer or automatically complete tasks. No model context, provider, collection source or microphone permission is implied by this build.

## Verification boundary

- Focused desktop tests cover backend ownership/concurrency, native entry-point behavior with stubbed Electron, permission/origin and preload boundaries, and notification baselining, history bounds, foreground suppression, and duplicate handling.
- Frontend and route tests cover the desktop identity endpoint and its existing Host/Origin/client-header boundaries.
- Lifecycle checks cover close/reopen, unsent drafts, explicit Quit, ownership boundaries, and durable-state preservation using isolated state.
- Package inspection confirms host code and icon assets without private state, credentials, Python files, or development dependencies.

**Not yet verified:** a real OS notification/banner and click round trip, microphone permission and capture in Electron, signing/notarization, standalone runtime distribution, Windows support, a live browser grant/extension connection, and the full autonomous outreach loop. These are separate acceptance steps, not implied by lifecycle tests.

See [the platform decision](../../docs/design/desktop-platform.md) and [the proactive outreach plan](../../docs/design/proactive-outreach-plan.md). Electron's [security guidance](https://www.electronjs.org/docs/latest/tutorial/security), [notification API](https://www.electronjs.org/docs/latest/api/notification) and [permission handlers](https://www.electronjs.org/docs/latest/api/session#sessetpermissionrequesthandlerhandler) informed the host boundaries.

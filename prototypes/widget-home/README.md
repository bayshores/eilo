# eïlo widget Home

The selected widget Home composition. The standalone preview uses sample data; the existing agent service now serves the same interface with native conversation and task state at `/home/`. The mockup is accepted as the implementation foundation, with refinements still expected; see the [current project brief](../../PROJECT.md).

## Run

Requires Node 20 or newer, with no package installation.

```sh
npm start
```

Open <http://127.0.0.1:41973/>. The server binds only to loopback and serves an allowlist of prototype files. `EILO_PROTO_PORT` selects another local port. Stop with Ctrl+C.

## Interactions

- Approach the left edge or activate its handle to reveal navigation. Home reclaims the space when it closes. Settings can pin it or reduce motion.
- Press and hold a non-interactive area of a widget to rearrange it. The six-dot cue reveals “Hold to move” on hover or focus. Then drag its body or grip: neighboring cards move into fitting spaces before release, and the held card settles into place. Edit home remains a keyboard alternative.
- Left-click empty Home background, or choose Done, to leave editing. Clicking widgets and controls keeps editing available; finishing a drag over empty space does not dismiss it.
- Reflow uses the pickup layout as its baseline, so reversing direction does not accumulate accidental moves. Escape or interrupted movement cancels; a completed drop saves once. Keyboard movement uses Space, arrows, and Enter; leaving the handle or reloading cancels an unfinished move.
- Drag the bottom-right grip to resize directly, even outside edit mode. Arrow keys work when that grip is focused. No size menu is required.
- Resizing shares adjacent edges: widening Today narrows the widgets to its right; shrinking it gives that space back. A bounded fit can shrink or reposition other visible widgets. If their readable minimum sizes leave no room, the requested resize stops with a “No more room” cue. Resizing never moves a visible widget into More widgets. On load, overflow from the older resize behavior is fitted into available Home space without resetting visible widget sizes.
- Add widgets with a sensible initial footprint. Remove circles appear inside the cards while editing. Removing a view keeps its contents; Undo restores the preceding layout.
- Home stays within its window. Extra views remain in More widgets, where Show on Home brings one forward.
- Layout, optional note and profile preferences use separate browser storage. Custom dimensions and responsive arrangements survive reloads.
- Navigation is centered against the full workspace height. Activity, Chats and Home keep the rail at the same vertical position even when their headers differ.

## Resize and status verification — September 10, 2026

95 Home tests pass, including exact shared-edge resizing, minimum-width clamping, reverse resizing, vertical resizing, responsive modes, recovery of the earlier overflow state and 100 deterministic mixed-layout invariant cases. Native drag verification widened Today to its maximum fitting width while both right-hand widgets remained visible, then restored its prior width. Browser keyboard resizing shrank and expanded its neighbors. Activity and Chats returned the same measured navbar top/height before and after the activation overview changes.

Activity now opens an activation overview with independent check-in and native-notification controls, current waiting conditions, and actual evaluation history. Browser verification covered the check-in switch, persistence through reload, restoring the previous preference, and empty Agent log. Native inspection confirmed the desktop-alert off state. The 22 proactive, six Home-route and 32 desktop tests pass. No live model evaluation, activity grant or notification enable was performed. The restarted app preserved conversation identity, tasks and all 10 existing messages.

The activation-control and run-history grouping was informed by inspected [Cursor](https://mobbin.com/screens/8c9f4c28-46ed-4b65-acd9-e0a3762d33e4) and [Attio](https://mobbin.com/screens/d8d6c229-4909-490c-83a1-a84958f82b83) screens from Mobbin, retaining eïlo’s selected typography and surfaces.

## Typography

Sean selected study B on September 9, 2026: IBM Plex Sans, medium-weight headings, 16.5 px body text, and restrained tracking. `typography.css` contains that treatment, including responsive sizes and aligned time numerals. The font is served locally from `assets/fonts/`; its full OFL and copyright notice are retained there. The earlier comparison remains in `../typography-study/` with a frozen baseline. This typography is part of the accepted implementation foundation.

## Boundaries

At port 41973, agenda, goal, progress and conversation content are fixtures and chat is a visual preview. At the agent service’s `/home/` route, the HTML selects live mode: ordinary messages go to the existing native conversation and widgets show its saved task projection. No synthetic schedule, dependency edges or practice streaks are presented as real data. The profile is browser-local, not authentication. Opening Home does not enable activity collection. An explicitly enabled Chrome connection renews the existing short lease; Connections provides setup, Pause and Turn off. The local observed-session journal is displayed separately from task completion. Clock uses local time; Notes is an optional scratchpad shared by its instances. The interface fills the actual application window; operating-system chrome is supplied by the host.

## Verification

`npm test` passes 37 model/gesture/client tests covering collisions, dense mixed-size reflow, hidden-widget reservations, original-state preservation, bounded layouts, malformed/empty state, responsive dimensions, hold activation and cancellation.

Browser checks cover pointer drag/drop, a live keyboard layout preview, Escape and reload cancellation, Undo, direct corner resizing, reduced motion, preserved layout and preferences, page bounds, and fully visible remove controls. Earlier checks covered the collapsing sidebar, resizing outside edit mode, persisted dimensions, and the overflow drawer. Earlier checks covered add/search, keyboard movement, content retention, empty Home, preferences and responsive rendering.

The browser controller cannot hold a mouse button down for a chosen duration. A short stationary press was checked in the browser; sustained activation and cancellation were tested in the timing model. The controller also performs pointer drags as a single action, so it verifies their completed positions rather than the full continuous motion. Physical long-press behavior and the feel of repeated freehand drags still need hands-on review. These checks do not establish comprehensive accessibility, touch-device, cross-browser or agent behavior.

`layout.js` owns layout metadata, `hold.js` the hold recognizer, and `fixtures.js` frozen content. `app.js` connects interactions and storage. `index.html`/`styles.css` define the interface. The application has no raster backdrop. Earlier mockup presentation art is archived under `design/studies/` at the repository root.


## Connected Home verification — September 9, 2026

The 37 tests comprise the existing 23 layout/gesture checks, 12 message/state contract tests, and two layout-transfer boundary tests. The backend run passed 46 Python checks and three existing JavaScript client/extension scripts. New route checks cover live HTML markers, explicit assets, local fonts, legacy routes and host/origin/API-header restrictions.

Browser validation used a separate in-memory fixture with the real static/API routes and security headers. Three commitments were displayed; sending showed an accepted row immediately; reload during the pending reply retained it; completion updated Home; a subsequent correction restored 1 of 3 practice sessions and kept the other commitments. A newer unsent draft survived reload. Home was visually inspected at 1280×720 and 990×1044 with no page scrolling; compact progress-heading clipping was found and fixed. The viewport override was reset. Existing typography B and sample Home were rechecked after the shared-source change.

The actual local service was started and connected Home loaded its existing native conversation/task state without a new user prompt. The user's existing widget arrangement and navigation/motion preferences were transferred through the Settings link and verified after fragment removal. No fixture prompt was sent to that conversation. This verifies integration wiring and deterministic lifecycle behavior, not a fresh end-to-end Luna turn or long-term coaching effectiveness.

For a future migration, **Settings → Use this layout in eïlo** in the standalone preview opens the configured default local service at port 8765. The fragment carries view metadata only; it is not sent to the server or saved in native history. Optional notes and names stay at their original browser origin.

## Live updates and speech — September 9, 2026

Connected Home adds one-at-a-time written check-ins from actual model callbacks. Seen updates do not replay after reload when storage is available; queued updates wait while a dialog is open. Final history remains in the native conversation. Conversation text streams without rebuilding its accessible log for each chunk; task-change acknowledgments wait for validated commit.

Talk to eïlo includes **Click to toggle** and **Hold to talk**. Hold supports pointer or focused Space/Enter, visible bars use actual microphone level, and Escape/Cancel discards recording or transcription. A delayed permission grant after cancellation does not start capture. Cancel during the final audio flush discards the buffer before upload and keeps new capture blocked until cleanup. Local English transcription completes after release/stop, appends to the current draft and awaits Send. No TTS is present. The controls use the approved typography/colors, visible focus, 44px speech targets and reduced-motion support.

Current verification: 72 Python tests, 56 Home/layout/gesture/queue/speech tests and the three existing workspace/extension JavaScript scripts passed. Separate real Luna calls verified human and proactive streaming; synthetic event data did not change the user's saved conversation. A public bundled audio sample verified the local model and full transcription endpoint, including a body larger than the ordinary API cap. Speech readiness, connection-page assets, missing-client/cross-origin rejection and invalid-audio rejection were checked on the running local service.

Browser inspection covered the live speech layout in 1280×720 and 990×1044 desktop views, the writing card and final conversation history, with no console errors. The final follow-up browser pass was blocked by the locked Mac. Microphone capture, actual RMS movement, permission prompts, screen-reader use, real permitted Chrome collection and full multi-tab presentation behavior have not been verified with a live user. Deterministic queue and capture tests cover reload/deduplication, permission-pending cancellation and stopping/transcribing cleanup; they do not replace those user-side checks.

## Bottom conversation bar — September 9, 2026

The user selected a permanent bottom composer with inline replies. Live Home no longer routes conversation through the detail modal or duplicates it in a preview widget. The same client, draft, speech capture and native log are mounted once on Home. Send expands bounded history above the bar; Hide replies/Escape collapses it. All conversation CTAs and incoming check-in Reply actions focus this input. Other modal views cancel active microphone capture without destroying its controller. The standalone sample remains separate.

59 frontend tests passed after the layout conversion. Browser verification covered sending/streaming, draft preservation through goal details and reload, keyboard collapse, mode persistence, one composer/log and check-in Reply routing. The actual app loaded its saved state read-only. Desktop sizes 1280×720, 1182×1044 and compact 820×640 showed no document overflow; the viewport override was reset. No microphone or model call was needed for this UI pass. See [the reference and implementation contract](../../design/conversation-dock.md).

## Navigation workspaces — September 9, 2026

Home, Goals and Activity are real workspace destinations. `workspace-views.js` renders Goals collection/detail, supported filters/search, and Activity's observation/check-in views; `goals-data.js` projects only existing public data. The shared composer survives page changes. Expanded conversation and update cards now reserve their own space and a visible close control replaces reliance on the footer toggle alone. This supersedes the overlay behavior described in the earlier dock checkpoint.

65 frontend tests and three focused Python Home route tests passed. Browser fixtures verified six mixed-state commitments, selection changes after completion, empty/search states, activity associations/check-ins, hash reload/Back and preserved drafts. Desktop and compact checks confirmed no document overflow or conversation/workspace overlap. The real service was restarted while idle and its existing state was retained; no model/microphone/activity test was run on the user's conversation. Details and limitations: [navigation contract](../../design/navigation-workspaces.md).

# Implementation status

**Task and Activity controls — September 9, 2026:** optional inline goal creation/editing, focus/lifecycle actions and recoverable task deletion are implemented in connected Home. Activity has separate record Trash/restore and unlink actions. Revisioned, conversation-bound transactions preserve drafts and reject stale or partial changes. All 93 Python and 73 frontend tests passed, browser fixtures covered recovery and compact layouts, and the live desktop restart preserved the exact saved conversation/messages/tasks. [Behavior and verification](design/task-and-activity-controls.md).

**Desktop checkpoint — September 9, 2026:** the first Electron/macOS development host is implemented. Packaged Home, close/reopen and both backend ownership/Quit paths were tested. The app remains linked to its checkout/runtime; OS notification delivery, microphone capture and standalone release packaging are unverified. Notifications and activity are off. See [desktop implementation evidence](desktop/electron/README.md).

**Prior integration direction — September 9, 2026:** connected Home now includes local observed-session upkeep, streamed written updates and local speech input. The selected layout and IBM Plex typography are preserved. See [the current project brief](PROJECT.md).

The aiohttp service serves `/home/` from canonical `prototypes/widget-home/`. `/workspace` retains earlier controls. The Node server remains a separate sample-data preview and never loads live integration modules.

## State and model authority

`app/tasks.py` validates revisioned operation batches, stable task IDs and optional focus before durable replacement. Native Hermes history is the conversation authority. Human proposals commit before their task-change acknowledgments are published; recovery finishes a saved publication without automatically repeating inference. Observations cannot complete tasks, change priority, start breaks or alter consent.

`ActivityLedger` records admitted approved origins, sample timestamps/counts and bounded observed duration in local meta. It omits titles and URL paths, retains at most 128 sessions for seven days, and closes unknown/unshared/gapped/restored sessions at their last sample. `related_task_ids` is optional model-inferred relevance validated against current open tasks. Associations are revision-scoped and do not mutate task state. New recent-session summaries are not included in model prompts; the preexisting sanitized single-observation input remains the event-lane context.

Home exposes this journal without requiring a manual progress report. A Chrome connection uses existing optional grants and lease/foreground gates. `/activity-connect` is an idle-by-default connection page for Chrome when Home runs elsewhere. No background OS service or reliable completion-source adapter is added.

## Real written streaming

The native drivers use Hermes `stream_callback` from one model turn. With `--stream`, stdout carries bounded NDJSON `preview` and `result` records; diagnostics remain separate. `JsonTextPreview` extracts only the intended top-level string after identity and allowed-kind gates, handles split escapes, and rejects malformed structure. Operations, raw proposal JSON and reasoning are not rendered. Chat/clarify replies may stream; update acknowledgments wait for commit. Event text requires matching event identity and a visible decision.

The server publishes cumulative `reply_stream` and `check_in_stream` state through the existing long poll. Human input, permission loss, context changes and state revisions invalidate event previews. Final schema/runtime/export validation remains authoritative. Interrupted output is not a completed native reply.

Home's pure update queue presents one check-in at a time, aliases streaming event identity to its final message, and persists seen IDs per conversation. It marks presentation only in a visible page without an open dialog. Historical messages do not replay on first adoption. Updates received while a dialog is open wait; hover/focus pauses dismissal. Native history retains final text. Availability of browser storage and page visibility determine these local presentation guarantees; there is no cross-device exactly-once claim. Per-token DOM updates do not repeatedly replace the accessible conversation log.

## Local speech input

`speech-capture.js` and `mic-worklet.js` capture mono PCM only after an explicit start gesture, show actual RMS level, and encode 16 kHz PCM16 WAV. Hold/release and click-toggle share the same lifecycle. Focused Space/Enter supports hold; Escape/Cancel discards. Permission-pending release invalidates capture, and delayed grants stop their tracks. Capture is bounded to 120 seconds. A recording is transcribed only after it ends; its text appends to an editable draft and is not auto-sent.

`GET /api/speech` reports local availability. `POST /api/transcribe` accepts only a bounded JSON body containing a request ID and base64 WAV. Only that endpoint permits the larger audio body; other APIs retain their 64 KiB cap. The module validates complete 16 kHz mono PCM16, at most 4 MiB/120 seconds. `POST /api/transcribe/cancel`, disconnected clients and shutdown terminate the request's child process. Private temporary audio files are removed in cleanup.

`scripts/setup-transcription` builds exact whisper.cpp v1.9.3 commit `371b5a7561823ab2bb32142d2751e35e7534727b` and verifies the `small.en` model SHA1. Runtime/weights stay in ignored `.runtime/stt/`. Recognition is local, English-only and segment-based. There is no TTS, always-listening mode, browser SpeechRecognition dependency or paid fallback. Real microphone permission/capture is still a user-side verification step.

## Interface and boundaries

Home retains floating navigation, direct corner resizing, hold-to-arrange, keyboard alternatives, More widgets, reduced motion, and separate layout/content storage. Optional customization is not required task upkeep. Existing send acceptance, reload continuity and publication recovery remain in place.

Host, Origin, same-origin client header, fixed asset allowlists and CSP remain enforced. Script/style/connect/font sources are local. The model and subscription sign-in are unchanged; raw microphone audio never goes to that provider. Native/runtime/private state stays outside Git. The selected source files are local work, not a new release verification.

## Verification — September 9, 2026

- 72 Python regressions passed, covering task/lifecycle behavior, observed-session boundaries, actual stream-envelope parsing, driver callbacks, cancellation and local transcription.
- 56 Home/layout/gesture/queue/speech tests passed including cancel-during-flush, explicit stream dismissal, final native reconciliation and dialog visibility regressions. The three existing JavaScript workspace/extension scripts also passed.
- An isolated real Luna/Codex conversation produced 40 cumulative human text previews and 15 proactive previews. Final native audits reported the exact model/provider/subscription route and zero tools. The event used synthetic approved context; the user's saved conversation was not used for test prompts.
- Local Whisper transcribed the bundled public JFK sample correctly both directly and through the loopback API. The direct cold sample took about 10.9 seconds; a later warm API sample took about 1.0 second. These isolated timings are not a normal-latency guarantee.
- Browser fixtures verified the writing presentation and speech controls without opening the microphone. Connected Home and fixtures were visually checked at desktop sizes; a final follow-up browser pass was blocked when the Mac locked. Hardware capture, screen-reader behavior and real permitted Chrome activity remain unverified. See the [widget verification](prototypes/widget-home/README.md#verification) for prior layout and integration evidence.

No real activity collection or microphone capture was enabled by these checks. Meaningful autonomous outcomes, long-term effectiveness, idle-aware attention, closed-page operation and cross-device behavior remain open.

## Bottom conversation bar — September 9, 2026

The user selected a permanent bottom composer with inline replies. Live Home no longer routes conversation through the detail modal or duplicates it in a preview widget. The same client, draft, speech capture and native log are mounted once on Home. Send expands bounded history above the bar; Hide replies/Escape collapses it. All conversation CTAs and incoming check-in Reply actions focus this input. Other modal views cancel active microphone capture without destroying its controller. The standalone sample remains separate.

59 frontend tests passed after the layout conversion. Browser verification covered sending/streaming, draft preservation through goal details and reload, keyboard collapse, mode persistence, one composer/log and check-in Reply routing. The actual app loaded its saved state read-only. Desktop sizes 1280×720, 1182×1044 and compact 820×640 showed no document overflow; the viewport override was reset. No microphone or model call was needed for this UI pass. See [the reference and implementation contract](design/conversation-dock.md).

## Navigation workspaces — September 9, 2026

Home, Goals and Activity are real workspace destinations. `workspace-views.js` renders Goals collection/detail, supported filters/search, and Activity's observation/check-in views; `goals-data.js` projects only existing public data. The shared composer survives page changes. Expanded conversation and update cards now reserve their own space and a visible close control replaces reliance on the footer toggle alone. This supersedes the overlay behavior described in the earlier dock checkpoint.

65 frontend tests and three focused Python Home route tests passed. Browser fixtures verified six mixed-state commitments, selection changes after completion, empty/search states, activity associations/check-ins, hash reload/Back and preserved drafts. Desktop and compact checks confirmed no document overflow or conversation/workspace overlap. The real service was restarted while idle and its existing state was retained; no model/microphone/activity test was run on the user's conversation. Details and limitations: [navigation contract](design/navigation-workspaces.md).


## September 10: source tools and visual execution flow

Implemented per-account Gmail authorization, separate Calendar-to-model opt-in, four scoped Hermes read tools, transient source context, narrow native OAuth/source-link bridges, and a compact real-operation progress strip. Zero real Gmail accounts are connected and Calendar answer sharing is off. Tests and runtime restart preservation are verified; actual source consent and real-account briefing quality remain unverified. See [the canonical integration record](design/companion-requests.md) for limits, verification counts, privacy behavior and the next acceptance trial.

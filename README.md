# eïlo

Connections and conversations: open **Connections** in the left navigation, or type `/mcp` to open the MCP view directly. Use the conversation name beside the composer to switch chats, or **Chats** to rename, pin, archive, restore and group conversations into projects. New chat preserves your global goals and connected services. See [the management and UX notes](design/connections-and-chats.md) for scope and verification. Custom MCP entries currently support configuration and explicit connection tests only; their tools are not enabled in conversations.

**Current phase — September 9, 2026:** the mockup is accepted as the foundation for initial implementation. Home now connects the native conversation, permitted observed-session summaries, live written updates and local speech input; remaining UI refinements continue through use. Start with the [current project brief](PROJECT.md) for accepted decisions, open questions and documentation routes.

eïlo (AY-loh) is a local accountability workspace with a durable task list and a supporting conversation. It uses the real Hermes runtime, exact `gpt-5.6-luna`, and a separate Codex subscription sign-in. Hermes remains a provisional foundation.

Ordinary explicit language can add or correct several commitments, select an optional current focus, record progress or completion, cancel or reopen work, and start or end a break. Adding work preserves existing tasks. Mentions, questions and brainstorming do not themselves establish commitments. Ambiguous changes get a clarification. A focus is optional, and working on another open task is legitimate.

## Interactive Home prototype

The interface study is in [prototypes/widget-home](prototypes/widget-home). It runs independently with sample data and requires no model account:

```sh
cd prototypes/widget-home
npm start
```

Open the local address printed by the server. Home supports direct corner resizing, hold-to-arrange, collapsing navigation and an overflow drawer. Layout editing is optional; the product direction is automatic upkeep from conversation and explicitly permitted activity.

The existing agent service also serves this interface with real conversation and task data at `/home/`. The standalone preview remains sample-only. Its Settings menu includes **Use this layout in eïlo**, which transfers normalized widget positions, sizes and navigation/motion preferences through a one-time URL fragment. Chat, task content, notes and names are excluded; the fragment is removed after import. This repository contains application source and a pinned runtime manifest, not an installed runtime or account credentials. A fresh clone can run the prototype immediately; backend launchers expect a separately configured project-local Hermes runtime.

## Desktop development app

The first macOS Electron build preserves this interface and the same local Python/Hermes service. It stays in the background when its window closes, exposes a native menu-bar icon and optional check-in notifications, and stops only a service it started when you choose Quit. The development bundle currently requires this configured checkout; standalone runtime distribution is still open. See [build instructions, verification and limits](desktop/electron/README.md).

## Use the workspace

With the project-local Hermes runtime configured, run from the repository root:

```sh
./scripts/local-chat start
```

Open [eïlo Home on this Mac](http://127.0.0.1:8765/home/). Type directly into the bottom message bar or use **Speak** to discuss commitments, progress or corrections; the widgets read the saved state automatically. **Conversation** expands recent messages above the bar without blocking Home; **Hide replies** or Escape collapses it. Older `/` and `/workspace` links now redirect to this same Home. The extension setup guide returns to `/home/#activity`. The foreground server stops with Ctrl+C or `./scripts/local-chat stop`. The active native conversation is preserved when you move between views.

Routine upkeep happens through conversation. In **Goals**, use the plus button to add a goal, or select an existing goal and open **•••** to edit its details, set/clear focus, cancel it or move it to **Trash**. **Mark complete**, **Reopen goal** and **Restore goal** are explicit actions in the detail pane. Completed and cancelled goals remain available; Trash preserves deleted goals for recovery. **Activity** has its own per-record options and Trash/restore controls. These actions change task/session records, not the native conversation history. Activity Trash shares the existing seven-day/128-session retention bound. See [all controls and limits](design/task-and-activity-controls.md). Deadlines retain the user's wording; the app does not invent calendar dates or schedule reminders. Quantity and progress fields are optional. Breaks preserve the task list and suppress background check-ins.

Enter sends a chat message; Shift+Enter adds a line. An outgoing message appears as **Sending**, then **Accepted**. Acceptance does not mean the model has finished. Reloading during a reply restores its pending receipt, then reconciles it with the native user row without duplication. In connected Home, a draft and unresolved send survive a reload in the same tab when browser session storage is available. A draft is cleared only when its matching message is accepted; a newer draft is preserved. Draft/outbox data is not carried into a different native conversation.

## Navigate the workspace

The floating rail has **Home**, **Goals** and **Activity**. Goals provides Active, Completed and All filters, search and side-by-side goal details; selecting a goal does not change it. Talk about this goal uses the existing bottom composer. Today and Progress remain Home widgets. Activity separates permitted observations from saved check-ins and links to existing connection controls.

Goals and Activity have local hash destinations (`/home/#goals`, `/home/#activity`) and support reload/Back. Your draft is shared across those views. Expanded replies occupy their own layout space, with **Close conversation**, **Hide replies** and Escape available to collapse them. See [the navigation design record](design/navigation-workspaces.md).

## Companion requests

Ordinary conversation and task updates use caller-owned response identity and a validated task projection. Cross-inbox catch-ups and Calendar-backed briefs now have four narrowly scoped read tools, optional per-source model sharing, and a compact execution-progress view. Real Gmail authorization and a first real-account brief remain to be tested. See [the requirement and implementation sequence](design/companion-requests.md) and [the conversation repair evidence](design/conversation-reliability.md).

## Google Calendar

Calendar onboarding and a read-only event view are implemented in Connections. The development OAuth setup is configured and native Connect opens real Google sign-in; real user consent, saved source selection and a 42-event sync have been verified. The native connection can retry saved access after a failed read. Users select calendars in eïlo after Google sign-in. Calendar entries remain separate from goals. See [the onboarding and setup record](design/google-calendar-onboarding.md) for scopes, secure storage, testing-mode limits and current verification.

## Speak to eïlo

Use the mode arrow beside **Speak** in the bottom bar to choose **Click to toggle** or **Hold to talk**. Toggle starts with one click and stops with another. Hold mode records while the button, Space or Enter is held while that button has focus. The visible bars follow actual microphone level. The first start may ask for browser/macOS microphone permission. Release or Stop ends recording; Cancel or Escape discards it. Leaving the page cancels capture. Typing remains available.

Transcription runs on this Mac after the recording ends, then appends to the current editable draft. Review it and choose Send to use the same native conversation. This first version is English-only, accepts up to two minutes per recording, and provides no spoken output or live speech partials. Raw audio goes only to the loopback service, is held in a private temporary WAV during recognition, and is removed after completion or cancellation. The reviewed text is sent to Luna only through the ordinary Send action.

For a fresh development checkout, with CMake and Apple compiler tools already available:

```sh
./scripts/setup-transcription
```

The setup builds pinned `whisper.cpp` v1.9.3 and downloads the checksum-verified `small.en` model into ignored `.runtime/stt/`. The model is about 466 MiB. No system-wide package install or paid recognition fallback is performed. See [third-party notices](THIRD_PARTY.md).

## Live written updates

Conversational replies and proactive check-ins can appear as text while the native model generates them. A task-change acknowledgment waits for validated commit. The stream is actual generation, not a typing animation over a finished response. Incomplete text is provisional; invalidated check-ins are removed.

Home shows one new check-in at a time. New updates queue while another is showing or a dialog is open; hover or focus pauses automatic dismissal. Open conversation retains the final history. A browser-local, conversation-specific seen list prevents replay after reload when storage is available. This does not provide read receipts or cross-device notification delivery.

## Task and conversation authority

`app/tasks.py` is a revisioned projection of explicit decisions, with stable task IDs, optional focus, separate break state, and native-message/control provenance. It is not a second transcript or an automatic history miner. Existing single-goal state migrates once. An explicitly authorized missed decision can be reconciled through the same validator with its exact native source reference.

Both chat and direct controls use the same transaction validator. Every operation in a batch is checked before any state is saved. Unknown IDs, invalid quantities, extra fields and stale revisions reject the whole batch. Retries use request IDs and do not repeat a committed change.

Human messages use `scripts/hermes-human` and supported `AIAgent.run_conversation` / `SessionDB` APIs. One native model turn returns a tentative reply and typed operations. The normal user message is stored verbatim. The raw assistant proposal is tagged `eilo_human_proposal` and withheld from the UI. Only after a durable local commit does the bridge publish a truthful acknowledgment on that exact native assistant row through display metadata. Malformed proposals leave tasks unchanged and preserve the user message.

If publication is interrupted after a commit, a private pending journal is retained. **Recover saved reply** finishes that recorded publication without another model call or duplicate user message. Restart can also recover a matching saved proposal. An interrupted inference is never automatically replayed.

Dynamic lane instructions, request IDs and the current task revision use Hermes's supported `ephemeral_system_prompt` parameter. The cached session system prompt stays stable; it must not hold changing task state. This matters because the pinned runtime restores a session's stored system prompt on later turns.

Hermes owns the durable conversation and context. `.state/local-chat.json` stores routing, task state, request/provenance bookkeeping and at most one unresolved display/publication receipt. Completed native exports are audited for model, provider, billing mode, tool counters and message-level tool fields before final publication. Provisional stream text comes from the audited constructed agent and passes narrow identity/kind gates; it never streams task-operation JSON.

## Optional activity and check-ins

**Activity → Overview** explains the current activation condition and exposes **Allow check-ins**, independently of collection permission. Home’s status pill opens this view. Switching check-ins off suppresses the event lane, including pending publication, while keeping the activity connection as it was. Older workspaces retain their previous check-in behavior; opening this view grants no new access.

**Agent log** shows up to 30 actual evaluations, including quiet, delivered, interrupted and failed attempts. **Observed** remains the separate approved-site journal; **Check-ins** holds delivered conversation messages. Empty history stays empty. Known timing gates show the earliest reevaluation time, never a promised notification. Calendar entries and natural-language deadlines do not yet trigger the activity lane on their own. Native **Desktop alerts** has its own real status and control, with the existing confirmation before enabling notifications.

Activity sharing is off until explicitly enabled in the page. The native helper checks only `NSWorkspace.frontmostApplication` locally. For other/unshared activity it discards app identity; only a coarse unknown/unshared signal is eligible for the model. That signal is never evidence of distraction.

The optional Chrome extension requires deliberate local installation and site grants. Its [setup page](http://127.0.0.1:8765/activity-setup.html) explains those steps. Open the [Chrome connection page](http://127.0.0.1:8765/activity-connect) in Chrome and choose **Connect Chrome**; keep that page open while sharing. Home can remain open in another browser. Its Connections view provides the connection link, state, Pause and Turn off. Opening either page never enables sharing automatically. The workspace remains usable without it.

| Boundary | Scope |
| --- | --- |
| Native helper | Foreground app only; no app/window inventory, screenshots, Accessibility, Input Monitoring or Apple Events |
| Approved Chrome sites | Exact optional grants for `https://leetcode.com/*`, `https://neetcode.io/*`, `https://docs.python.org/*` |
| Shared detail | Normalized HTTPS origin and sanitized active-tab title, at most 180 characters |
| Unapproved sites | Chrome withholds URL/title fields; no domain or page details are sent |
| Approved URL handling | Full URLs may be transiently available locally, but path/query/fragment and credentials are stripped or rejected before extension IPC, model input or persistence |
| Retention | Selected admitted observations/decisions go to Luna via the subscription and remain native Hermes operational rows. A separate local journal keeps at most 128 approved-origin sessions for seven days, without titles or URL paths |

The extension has no broad `tabs`/`activeTab`, scripting, history, cookies, screenshots, content-script permission, tab-event listeners, or independent polling job. Chrome site grants have broader potential capabilities; the shipped implementation performs only permitted active-tab metadata queries. No page bodies, keystrokes or clipboard data are collected.

Home exposes the local journal in Activity and uses sample-supported duration in Progress. Only adjacent valid samples add observed time. Unknown/unshared activity, gaps and restarts close a session at its last observation. Tentative goal associations do not complete tasks. New multi-session summaries are not sent to the model.

One enabled page renews a 9-second lease every 3 seconds; sampling is at most every 5 seconds. Pause/off/page close stops requests. An independent deadline cancels collection if the closing signal is lost. Reload and process restart do not re-enable it. Closing the page does not discard an accepted human reply.

Background admission requires open work, no active break, 45 seconds of stable valid context, 120 seconds after human input, a live lease, changed context and a 5-minute cooldown. It permits at most 3 event calls per rolling hour and 8 per rolling day in the selected conversation. These are interruption/cost safeguards, not a study schedule.

`scripts/hermes-event` uses the same native runtime with typed, locally validated quiet/ask/check-in output. Any open task can make the observed context legitimate; current focus is not an exclusive obligation. Observations cannot change tasks, priorities, break state or consent. Invalid input stays quiet. Provider-enforced structured output is not claimed.

Human input is accepted ahead of background work and gets the next serialized native turn. Human input, task/focus/break revisions, pause, lease expiry and changed activity suppress late results. Operational observation/proposal JSON never appears as user text. Delivered questions are labeled **eïlo check-in**.

## Runtime and boundaries

The official pinned Hermes runtime is 0.21.1, release `v2026.9.7`, commit `2237be355906fbe6065ce1815711eee52b2d646e`. See `hermes-source.json`, `requirements.hermes.lock` and [third-party notices](THIRD_PARTY.md). The runtime is installed locally and excluded from the repository.

The event agent is audited for exact Luna/Codex and zero tool schemas. The human agent exposes exactly four eïlo read tools through a per-turn capability, with ordinary task operations still validated by the app. Earlier zero-tool evidence below describes the foundation before the September 10 source integration. No provider fallback, new sign-in, credentials import, direct replacement model client, upstream runtime patch, gateway, ACP turn, notification, OS control, login item or system scheduler was introduced. The model requests leave this Mac through the authorized subscription; the UI listens only on loopback.

The aiohttp bridge checks Host, Origin, content type, strict request bodies and a same-origin client header. It exposes fixed assets and narrow conversation/task/activity endpoints, without generic RPC, native commands, credential files, filesystem operations or model switching. Request IDs and task revisions prevent duplicate or stale changes. The new client checks the service schema before enabling task controls.

Launchers keep `HERMES_HOME` under `.state/hermes`, runtime working files under `.state/workspace`, and caches/scratch under `.tmp`. Use these launchers rather than a global Hermes profile. Credentials and private state are excluded by `.gitignore`; they must stay out of publication.

ACP is not used: the pinned ACP constructor enables the broader `hermes-acp` toolset, so an empty configuration resolver was not sufficient proof of an empty constructed agent. The native gateway remains stopped because it starts scheduler/housekeeping machinery. No automatic Nebius or paid API continuation is enabled.

## Verification and practical limits

The task workspace was tested with isolated native conversations and deterministic lifecycle/transaction fixtures. The real reported wording was reproduced only in a separate test conversation. The successful sequence covers multiple additions across turns, corrections, quantity changes, completion, cancellation, reopen, focus, break/resume, non-committing brainstorms and ambiguous clarification. A controlled observation related to another open task stays quiet, and a subsequent human turn uses the correct native lane. All actual model calls used Luna/Codex with zero tools.

Native testing also found two integration defects that were fixed before release: title-based CLI export missed an interrupted first user-only session, and cached system prompts reused stale request/task data. The bridge now resolves an exact app-owned title through `SessionDB`, and changing instructions use the supported per-turn parameter. Rejected stale proposals never changed task state or produced saved acknowledgments.

Run the no-inference regressions with:

```sh
HERMES_HOME="$PWD/.state/hermes" .runtime/venv/bin/python -m unittest discover -s tests -p 'test_*.py'
node tests/workspace-client.test.js
node tests/activity-extension.test.js
node tests/app-web-client.test.js
node --test prototypes/widget-home/*.test.js
./scripts/hermes-human --dry-audit
./scripts/hermes-event --dry-audit
```

Architecture, the current integration boundary and verification summaries are in `IMPLEMENTATION.md`. `evaluation/scenarios.json` and `evaluation/README.md` provide sanitized regression material. Private operational receipts are excluded from the repository.

Real Chrome installation/grants/collection, daily effectiveness, long-term memory and compaction recovery, Windows and notification delivery remain unverified or deferred. Native outputs are locally validated; this is not a claim of universal language understanding or prompt-injection immunity. Quiet decisions have no visible stream. A September 9 isolated native test verified actual conversational and proactive text callbacks, without writing fixture prompts into the user conversation. Local transcription was verified with a bundled public audio sample; hardware microphone capture and browser/macOS permission prompts remain untested. Earlier CLI latency measurements are historical and do not establish normal response latency.

# eïlo

eïlo (AY-loh) is a local accountability workspace with a durable task list and a supporting conversation. It uses the real Hermes runtime, exact `gpt-5.6-luna`, and a separate Codex subscription sign-in. Hermes remains a provisional foundation.

Ordinary explicit language can add or correct several commitments, select an optional current focus, record progress or completion, cancel or reopen work, and start or end a break. Adding work preserves existing tasks. Mentions, questions and brainstorming do not themselves establish commitments. Ambiguous changes get a clarification. A focus is optional, and working on another open task is legitimate.

## Interactive Home prototype

The interface study is in [prototypes/widget-home](prototypes/widget-home). It runs independently with sample data and requires no model account:

```sh
cd prototypes/widget-home
npm start
```

Open the local address printed by the server. Home supports direct corner resizing, hold-to-arrange, collapsing navigation and an overflow drawer. Layout editing is optional; the product direction is automatic upkeep from conversation and explicitly permitted activity.

The agent application and this prototype are not yet integrated. This repository contains application source and a pinned runtime manifest, not an installed runtime or account credentials. A fresh clone can run the prototype immediately; backend launchers expect a separately configured project-local Hermes runtime.

## Use the workspace

With the project-local Hermes runtime configured, run from the repository root:

```sh
./scripts/local-chat start
```

Open [eïlo on this Mac](http://127.0.0.1:8765). The foreground server stops with Ctrl+C or `./scripts/local-chat stop`. There is one selected native conversation; this workspace does not introduce a history picker or discard earlier native sessions.

Describe what you need to do in chat, or use the task controls. Selecting a row opens its details; **Set current focus** is a separate explicit choice. Completed and cancelled tasks remain visible and can be reopened. Deadlines retain the user's wording; the app does not invent calendar dates or schedule reminders. Quantity and progress fields are optional. Breaks preserve the task list and suppress background check-ins.

Enter sends a chat message; Shift+Enter adds a line. An outgoing message appears as **Sending**, then **Accepted**. Acceptance does not mean the model has finished. Reloading during a reply restores its pending receipt, then reconciles it with the native user row without duplication. An unsent draft survives a temporary connection outage in the open page, but is not saved across page reloads.

## Task and conversation authority

`app/tasks.py` is a revisioned projection of explicit decisions, with stable task IDs, optional focus, separate break state, and native-message/control provenance. It is not a second transcript or an automatic history miner. Existing single-goal state migrates once. An explicitly authorized missed decision can be reconciled through the same validator with its exact native source reference.

Both chat and direct controls use the same transaction validator. Every operation in a batch is checked before any state is saved. Unknown IDs, invalid quantities, extra fields and stale revisions reject the whole batch. Retries use request IDs and do not repeat a committed change.

Human messages use `scripts/hermes-human` and supported `AIAgent.run_conversation` / `SessionDB` APIs. One native model turn returns a tentative reply and typed operations. The normal user message is stored verbatim. The raw assistant proposal is tagged `eilo_human_proposal` and withheld from the UI. Only after a durable local commit does the bridge publish a truthful acknowledgment on that exact native assistant row through display metadata. Malformed proposals leave tasks unchanged and preserve the user message.

If publication is interrupted after a commit, a private pending journal is retained. **Recover saved reply** finishes that recorded publication without another model call or duplicate user message. Restart can also recover a matching saved proposal. An interrupted inference is never automatically replayed.

Dynamic lane instructions, request IDs and the current task revision use Hermes's supported `ephemeral_system_prompt` parameter. The cached session system prompt stays stable; it must not hold changing task state. This matters because the pinned runtime restores a session's stored system prompt on later turns.

Hermes owns the durable conversation and context. `.state/local-chat.json` stores routing, task state, request/provenance bookkeeping and at most one unresolved display/publication receipt. Native exports are audited for model, provider, billing mode, tool counters and message-level tool fields before visible text reaches the browser.

## Optional activity and check-ins

Activity sharing is off until explicitly enabled in the page. The native helper checks only `NSWorkspace.frontmostApplication` locally. For other/unshared activity it discards app identity; only a coarse unknown/unshared signal is eligible for the model. That signal is never evidence of distraction.

The optional Chrome extension requires deliberate local installation and site grants. Its [setup page](http://127.0.0.1:8765/activity-setup.html) explains the deliberate user steps. The workspace remains usable without it.

| Boundary | Scope |
| --- | --- |
| Native helper | Foreground app only; no app/window inventory, screenshots, Accessibility, Input Monitoring or Apple Events |
| Approved Chrome sites | Exact optional grants for `https://leetcode.com/*`, `https://neetcode.io/*`, `https://docs.python.org/*` |
| Shared detail | Normalized HTTPS origin and sanitized active-tab title, at most 180 characters |
| Unapproved sites | Chrome withholds URL/title fields; no domain or page details are sent |
| Approved URL handling | Full URLs may be transiently available locally, but path/query/fragment and credentials are stripped or rejected before extension IPC, model input or persistence |
| Retention | Selected admitted observations/decisions go to Luna via the subscription and remain native Hermes operational rows; no separate comprehensive browsing log |

The extension has no broad `tabs`/`activeTab`, scripting, history, cookies, screenshots, content-script permission, tab-event listeners, or independent polling job. Chrome site grants have broader potential capabilities; the shipped implementation performs only permitted active-tab metadata queries. No page bodies, keystrokes or clipboard data are collected.

One enabled page renews a 9-second lease every 3 seconds; sampling is at most every 5 seconds. Pause/off/page close stops requests. An independent deadline cancels collection if the closing signal is lost. Reload and process restart do not re-enable it. Closing the page does not discard an accepted human reply.

Background admission requires open work, no active break, 45 seconds of stable valid context, 120 seconds after human input, a live lease, changed context and a 5-minute cooldown. It permits at most 3 event calls per rolling hour and 8 per rolling day in the selected conversation. These are interruption/cost safeguards, not a study schedule.

`scripts/hermes-event` uses the same native runtime with typed, locally validated quiet/ask/check-in output. Any open task can make the observed context legitimate; current focus is not an exclusive obligation. Observations cannot change tasks, priorities, break state or consent. Invalid input stays quiet. Provider-enforced structured output is not claimed.

Human input is accepted ahead of background work and gets the next serialized native turn. Human input, task/focus/break revisions, pause, lease expiry and changed activity suppress late results. Operational observation/proposal JSON never appears as user text. Delivered questions are labeled **eïlo check-in**.

## Runtime and boundaries

The official pinned Hermes runtime is 0.21.1, release `v2026.9.7`, commit `2237be355906fbe6065ce1815711eee52b2d646e`. See `hermes-source.json`, `requirements.hermes.lock` and [third-party notices](THIRD_PARTY.md). The runtime is installed locally and excluded from the repository.

Both human and event agents are audited after actual construction for exact Luna/Codex and zero tool schemas. No provider fallback, new sign-in, credentials import, direct replacement model client, upstream runtime patch, gateway, ACP turn, notification, OS control, login item or system scheduler was introduced. The model requests leave this Mac through the authorized subscription; the UI listens only on loopback.

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
./scripts/hermes-human --dry-audit
./scripts/hermes-event --dry-audit
```

Architecture, the current integration boundary and verification summaries are in `IMPLEMENTATION.md`. `evaluation/scenarios.json` and `evaluation/README.md` provide sanitized regression material. Private operational receipts are excluded from the repository.

Real Chrome installation/grants/collection, daily effectiveness, long-term memory and compaction recovery, Windows and notification delivery remain unverified or deferred. Native outputs are locally validated; this is not a claim of universal language understanding or prompt-injection immunity. Quiet mode still returns a completed response rather than a token stream. Earlier CLI latency measurements are historical and do not establish the latency of the new structured route.

# Date-aware return conversation and daytime check-ins

September 19, 2026. Status: selected third visual direction integrated locally;
source-backed automatic model briefings and expanded daytime reasoning remain
planned. The implemented opening uses saved goal/date state with existing
conversation and task APIs. Source: direct user choices in the planning conversation.
Recheck this record when the user changes the behavior or implementation begins.

## Implemented first increment

The selected third image is now represented in the live UI: goal/event summary
cards, contextual details, an expandable existing conversation dock, daily return
presentation and preserved saved widgets. Finished/Drop use revisioned task writes
with Undo. Still want to prepares an editable draft; it does not silently change
timing or send a message. A first visit with an existing draft does not auto-open.
Fresh Calendar data can be displayed locally; disconnected sources remain explicit.

Verification used an isolated real-task fixture for completion/undo, draft
persistence, message submission and detail focus restoration. Browser inspection
covered wide, compact and narrow layouts and app reduced-motion. A native restart
kept conversation, message and task hashes identical. No personal test message,
model call, source grant or notification grant was made. The complete future
source-backed catch-up and new daytime admission paths below are not implemented.

## Problem

Returning after time away leaves the person with old commitments and no clear
opening from the assistant. The person must initiate, explain and replan before
eïlo provides useful help. A generic Continue card does not resolve stale goals.

## Confirmed behavior

- On the first visit each local day, open the unified workspace with a compact
  visual briefing already visible and an expandable conversation dock. Relevant
  goal/event cards and actions sit in the same workspace. Chat grows when used;
  free-text replies remain available. After a longer absence, cover relevant
  changes since the previous visit. Brief reopens resume the existing place.
- Summarize relevant old goals and changes, then suggest a next step. If a goal's
  deadline passed, first ask whether it was completed, is still wanted, or should
  be dropped. Do not infer completion or silently renew its deadline.
- Draw on saved conversations/goals and relevant Calendar, Gmail and activity
  context only where each source is connected and permitted for AI use.
- Take initiative during the day when relevant context changes or a commitment
  needs attention. Respect breaks and avoid requiring a fresh user message.
- Put check-ins in the conversation. Send a desktop notification only when alerts
  are enabled. Never steal focus or switch the user away from their current app.

These choices define future product behavior; they do not enable collection,
sharing, check-ins or alerts on the current installation.

## Confirmed UI and motion direction

The latest user decision supersedes the earlier separate Talk-first landing:
one unified workspace should consolidate the briefing, goals, events, activity
and relevant updates into interactive widgets, with an expandable conversation
dock. The briefing and widgets remain visible while conversation grows. The primary workspace must fit the app window without page scrolling; long
conversation content and expanded details may scroll internally. Reduce
routine page changes; preserve existing saved layouts and access to management
features while their presentation is consolidated.

Preserve the app's dark visual identity and source icon colors. Use sleek,
content-specific widgets with visual hierarchy: a prominent relevant next step,
compact supporting cards, meaningful charts and concise labels. Do not force a
widget-arrangement step or fill space with empty boxes and decorative numbers.
Cards distinguish dated facts from suggestions. Empty, stale, disconnected and
loading states must remain useful.

Recommended detail behavior: open a contextual detail surface within the same
workspace, keep the originating widget recognizable, and return to its position
on close. Exact expansion geometry remains a design exploration. Keep controls
keyboard reachable, use visible focus and explicit names, restore focus after
closing, and do not rely on hover or color alone. Consolidation by itself is not
proof of accessibility.

Motion should be expressive: noticeable movement, soft spring-like settling and
an animated personality. Prioritize widget expansion/collapse, dock growth,
briefing entrances, new messages and action feedback; coordinate any remaining
page transitions. Keep controls and typing immediately available. Avoid replaying
entrances during streaming or background updates. Respect both app and OS
reduced-motion preferences, and stop work while hidden.

## Mobbin reference review — September 19, 2026

Source class: live Mobbin screen and flow search, with returned previews visually
inspected. Scope: desktop widget overviews, contextual calendar details, personal
health summaries and card collections. Broad searches returned several unrelated
products; shortlist below includes only patterns actually visible. No animation,
keyboard behavior, usability outcome or current production parity was verified.
Recheck exact interactions during prototyping.

- [Amie event detail](https://mobbin.com/screens/6fb1b287-b07f-4e0d-b0b6-d73da5c4acf2):
  task list and calendar remain visible around an event-detail popover. Strong
  reference for retaining spatial context during inspection, not for copying a
  calendar-first product structure.
- [Oura overview](https://mobbin.com/screens/85150daf-308e-41a4-b98c-5e6a6ee2fad0):
  atmospheric surface, prominent visual summary and contextual Confirm/Edit
  card. Use its hierarchy and material direction; do not invent a focus or
  wellness score for eïlo.
- [Oura readiness flow](https://mobbin.com/flows/cd0b2e3e-e462-4d9d-ba87-f0c214fe47ca):
  inspected sampled overview/detail screens show layered explanation and metric
  tiles. It still uses separate views; it is not proof of a one-page workspace.
- [Copilot Money overview](https://mobbin.com/screens/9a0533f9-be57-4f38-af9a-1dbd5239048d):
  differently sized summaries, charts, review items and upcoming information.
  Useful density reference; the captured state is sparse and includes a sidebar.
- [Gentler Streak activity](https://mobbin.com/screens/274195a9-507e-4c9e-9a58-9dc235407ada):
  visual history, soft summary tiles and individual records. Useful for observed
  activity presentation; observed time must not become proof of progress.

Design recommendation, not a claim about measured usability: combine Amie's
in-context detail with Oura's visual personality and content-specific card sizes.
Keep the user's expandable conversation dock within the unified surface.

## Current-code starting points

A focused September 19 inspection found `web/home/daily-start.js` implements a
local-day-aware Home card, not an assistant-initiated native conversation.
`app/briefing.py` scopes source capabilities to a user-requested turn. Extending
that lifecycle requires a deliberate automatic-trigger path with the same
permission and cancellation checks; do not fake a user message.
`web/workspace/router.js` owns page routing; `web/workspace/workspace.js` joins
Home and Talk. `web/adaptive/motion.js` provides GSAP/Flip motion and cleanup,
and `web/app.js` already combines app and OS reduced-motion preferences.
These are inspection pointers, not a completed architecture review.

## Proposed build sequence

### 0. Select the unified workspace design

Use Product Design to create three grounded visual directions from the inspected
references and current eïlo screen. Include the briefing, widget detail and
expanded dock states. Select a direction before changing the app shell. The
information architecture is shared across options; avoid cosmetic-only variants.

### 1. Return detection and reliable time context

Inspect the existing daily-return, conversation-routing and persistence code.
Reuse it where practical. Establish authoritative local date/time, last meaningful
visit and the last delivered catch-up. Preserve drafts and active turns. Make
repeat opens/restarts idempotent rather than generating duplicate greetings.

Verification: same-day reopen, next-day return, multi-day absence, midnight,
timezone change, active draft/turn, and interrupted delivery in isolated state.

### 2. Catch-up and stale-goal reconciliation

Assemble a bounded context packet with timestamps and source availability. Keep
stale or disconnected source data from being presented as freshly checked.
Generate a short opening in the native conversation, represented by the unified
briefing and dock, with one question at a time.
Resolve an expired goal through the user's answer before recommending the next
action. Apply confirmed changes through existing durable task transactions.

Verification: completed / still wanted / dropped / uncertain answers; multiple
expired goals without a questionnaire dump; no connected sources; denied sharing;
expired source cache; provider unavailable; correction and dismissal. Confirm a
real native-provider opening separately from fixture tests.

### 3. Context-driven daytime follow-through

Review the existing proactive decision and delivery paths before adding another
scheduler. Admit meaningful changes, prioritize foreground conversation, and
reuse quiet periods, break state, deduplication and call budgets. Publish to the
appropriate conversation before notifying. Notification opens that conversation
only after the user chooses it.

Verification: warranted check-in and appropriate silence; break/pause/revocation;
duplicate context; user reply during generation; goal changed before delivery;
restart recovery; disabled alerts; no focus stealing; actual native delivery.

### 4. App-wide motion and interaction polish

Reuse the installed GSAP implementation and existing preference handling. Add
coordinated exit/entry transitions with short offsets and soft settling, staged
briefing-card entrances and consistent inline-panel/action feedback. Prefer
transform and opacity, animate a bounded number of visible items, and preserve
scroll position, focus, draft contents and immediate interaction.

Verification: rapid page changes, interruption mid-transition, repeated data
updates, long lists, compact/wide windows, keyboard focus and reduced-motion
changes during animation. Ensure hidden pages do not keep animating and no
transition leaves content invisible or blocks a control. Inspect the native
app separately from browser fixtures.

### 5. Return-session acceptance walkthrough

Use an isolated profile with a saved conversation, expired goal and dated source
fixtures. Reopen after a simulated absence: the catch-up should explain what
matters, ask one necessary question and lead to a useful next action. Reopen
briefly and confirm continuity. Test a later relevant change and a break.
Then review the real experience with the user; fixture success alone does not
establish usefulness.

## Details to settle during implementation

Exact long-absence threshold, catch-up length, interruption limits, and how a
repeatedly ignored check-in becomes quieter remain proposed implementation
choices. Do not invent new source grants or notification permissions to satisfy
the walkthrough. User testing should determine whether the experience reduces
the effort of restarting.

Current boundaries: [Product](../product.md), [Architecture](../architecture.md),
[Security](../security.md), [Development](../development.md). Earlier
[proactive outreach research](proactive-outreach-plan.md) is background, not proof
that all its gaps remain present in current code.

## Final navigation decision — September 19

Home owns the workspace. Remove the sidebar; Goals and Activity open from Home widgets into dismissible detail panels, preserving their existing stateful controls. Settings remains a separate page with Back to Home. This supersedes the temporary sidebar restoration and any earlier distinct-page design. Close/Escape restore the workspace and widget focus; opening details preserves the conversation draft.

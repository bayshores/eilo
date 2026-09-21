# Product direction

felis supports people who struggle with focus and motivation, including people
with ADHD, in starting, staying with, and returning to any task on their laptop.
Writing, studying, research, creative work, personal administration, and coding
are all valid contexts. The experience adapts to the person's chosen work;
interview practice and LeetCode are examples, not the product's default purpose.

felis helps a person keep continuity with commitments they chose. Conversation is
the primary way to create, correct, and discuss those commitments; direct goal
controls exist for quick corrections. The product should reduce reporting and
replanning overhead while leaving the person in charge of their methods,
priorities, breaks, and external actions.

## Current experience

- **First setup** starts with a goal conversation and a compact preview of the
  proposed goal. Approval saves it, enters the unified Home, and offers optional
  source setup through independent permission choices.
- **Home** combines current focus, the next Calendar item when connected,
  retained activity analytics, source health, check-in state, and the expandable
  conversation. There is one app-owned composition with no edit or gallery mode.
- **Talk** expands inside Home while the focus and activity surfaces remain
  visible. Drafts, replies, history, and the selected conversation survive
  collapsing and reopening.
- **Goals** opens from Home as a dismissible detail view. Conversation, **New
  goal**, and `/goal` are the primary creation paths; direct controls handle
  search, corrections, progress, completion, cancellation, and recovery.
- **Activity** opens from Home and presents recorded evidence, source state,
  check-in history, and recording controls. Pausing leaves a visible **Resume
  recording** action. Recorded time never proves attention, progress, or
  completion.
- **Settings** is the only separate destination. General, Permissions, Memory,
  and Account keep presentation, source collection, AI sharing, retention, and
  sign-in decisions explicit and separate.
- **Speech** includes user-started transcription into an editable draft and
  optional spoken felis replies. Spoken replies run only while Home is active
  and stop through a visible control.

## Product limits

felis does not infer a schedule from loose wording, invent deadlines, treat an
app or page as proof of distraction, declare work complete from activity, or
automatically block access. It does not make purchases, send messages, enroll
the user, or act in external systems through ordinary conversation.

Proactive support must be contextual and restrained: a short, grounded nudge or
acknowledgment where a user-permitted signal warrants it. It should not become a
fixed coaching schedule, a stream of unsolicited work plans, or an obligation to
maintain a manual tracker. Breaks, corrections, and changed goals are legitimate
input.

## Design principles

### One unified Home

Home is a stable agent workspace, not a user-arranged canvas. Focus, activity,
agent status, and conversation share one visual system and update from the
current server state. Goals and Activity open over Home and return focus to the
originating control. Settings remains separate with an explicit return to Home.

Conversation is the primary interface for creating goals and asking for a next
step. Direct controls exist for quick, reviewable corrections. Source problems
appear only when actionable and route to the relevant permission or connection
surface. Analytics state their time window and retention limit instead of
inventing data.

### Frontend instructions

Use familiar controls, alignment, and selected states to make interactions apparent. Home is the primary workspace; Goals and Activity expand over it without a sidebar. Settings is separate. The orb remains in the Home conversation dock and first setup. Keep populated messages and the composer free of decorative logos and extra branding bars; History stays within Talk. Avoid visible counts, captions, or instructions that merely explain the interface. Keep clear text for navigation, consent, errors, and recovery. When a procedure needs instructions, show one short instruction and one immediate action at a time. Multi-step setup uses a visible current step with Back/Next; do not show the entire procedure at once. Put optional explanation, troubleshooting, and keyboard reference behind a concise disclosure. Favor less copy over additional instructional panels.

Do not use thin line dividers as a section-separation component. Group related content with spacing, alignment, typography, material, shape, or a meaningful visual instead. Lines remain valid only when they encode data or define a control's necessary boundary; they must not be decorative separators between stacked content.

Routine chat status and context usage belong with the composer. Keep the percentage and compact progress ring in its toolbar. Its inline detail shows the whole context window as an estimated, labeled category breakdown, including available space and the auto-summary reserve; omit categories that are not actually loaded. Keep exact counts and summary controls with that visual. Do not turn the composer into a tabbed settings panel or a modal. Keep typing and the conversation available. App-owned detail and confirmation flows open inline; preserve explicit confirmation controls.

Keep the consequence of a permission or destructive action visible at the decision point. Progressive disclosure must not hide what information reaches the AI, merge independent permissions, imply that a setup step granted access, or replace a necessary recovery instruction with a generic error. Preserve user-written content and real source data; this rule governs product instructions and help.

### Browser setup and focus

Browser context works across regular HTTP and HTTPS sites. Do not require users to pick from a fixed site list or label sites as productive/distracting. felis interprets permitted context alongside the person's conversation and commitments; the site alone is not evidence of intent or completion. One optional Chrome permission covers the browser. Site exclusions are optional controls, not an onboarding prerequisite.

When a focused task's distinctive terms appear in one permitted work context and a later stable context matches no open task, felis may ask whether it is a quick break or whether a small nudge back would help. It does not call that change procrastination, assume a site was off-task, or infer an outcome.

When a new eligible check-in arrives while felis is out of focus, a small native glass overlay can show the already-delivered felis message without activating its window. A delivered check-in remains eligible for that short handoff even when the source observation later ages out; a reply, goal change, new conversation, explicit pause, recovery, or its delivery window suppresses it. The overlay stays long enough to read, disappears on its own, or opens the existing conversation only after a deliberate click. Desktop alerts remain a separate optional preference.

Pointer clicks must not leave a bright keyboard-focus outline behind. Keep actual selected states, editing carets, Home controls, and visible focus when navigating by keyboard.

### Product composition

- Use varied task examples in mockups, fixtures, and onboarding. Progress should
  reflect the person's actual task and available evidence: a meaningful status,
  next step, or an appropriate unit when a count is useful. Do not default every
  task to problems solved, a fixed checklist, or a universal focus score.
- Do not restore the floating sidebar, configurable widget board, or parallel Home mode. Keep Goals and Activity accessible from Home panels, with Close and Escape returning to the workspace.
- Favor automatic upkeep from conversation and explicitly permitted context over
  repetitive forms.
- Consolidate goals, activity, and conversation into Home. Preserve their controls
  in in-place detail panels; keep Settings as the only separate settings destination.
- Make control boundaries legible. Enabling one connection does not silently
  enable another collection, model-data flow, or notification route.
- Present uncertainty honestly. The UI only claims facts supplied by its current
  backend and records.
- Preserve visual restraint: readable Source Sans body text and Bricolage headings, calm surfaces,
  and interactions that can be exited easily.

Longer research, alternatives, and dated design rationale live in
[design records](design/). A record can explain why a decision was made; the
current code and these product boundaries define what is supported now.

## Starting and returning

First setup centers one real goal and **Save goal & start**, which saves the goal
and asks for a small first step in the ordinary conversation. No mandatory timer or daily planning ritual precedes ordinary use.

A daily return briefing is on by default. On the first connected Home visit of
a local day, or after at least four hours away, it expands the conversation only
when no draft, pending reply or break is active. A blocked first visit does not
trigger delayed guidance after work clears. Dismissal persists for the local day.

An eligible return starts one detached, read-only catch-up for that conversation,
day, and reason. It can use the saved conversation and goals, plus Calendar,
Gmail, and work context only when each source is already connected and enabled
for answers. A grounded return can still help when there is no open goal; an active
break is the only task state that suppresses it. The browser cannot grant a source or
assert that a draft is absent;
a draft is only an opt-out. The worker never writes a user message, changes a
task, or retries an interrupted inference. Before a native assistant message is
appended, the service checks the current conversation, task revision, human
activity epoch, break state, and source permission again.

Exact ISO goal dates may be identified as passed; ambiguous wording is shown for
confirmation without inventing a deadline. A passed date offers **Finished**,
**Still want to**, **Drop goal**, and **Not now**; keeping it opens the goal editor
rather than silently changing timing. The compact goal and event cards remain
visible while the catch-up arrives in the conversation. Short returns retain the
draft and conversation instead of restarting guidance.

Visible navigation and restrained interface sounds default on only where no
preference exists. Explicit off choices persist. A saved permission is distinct
from receipt of activity. Home source cards and its recovery card report Desktop,
Browser, Calendar, and Gmail health and open the relevant management surface. Collection,
AI sharing and alerts never gain consent from this presentation default.

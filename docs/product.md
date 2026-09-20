# Product direction

eïlo supports people who struggle with focus and motivation, including people
with ADHD, in starting, staying with, and returning to any task on their laptop.
Writing, studying, research, creative work, personal administration, and coding
are all valid contexts. The experience adapts to the person's chosen work;
interview practice and LeetCode are examples, not the product's default purpose.

eïlo helps a person keep continuity with commitments they chose. Conversation is
the primary way to create, correct, and discuss those commitments; direct goal
controls exist for quick corrections. The product should reduce reporting and
replanning overhead while leaving the person in charge of their methods,
priorities, breaks, and external actions.

## Current experience

- **First setup** starts with a goal conversation beside a proposed arrangement
  of up to three existing widgets. Approval saves the goal and reveals that Home;
  optional source setup follows with separate collection, AI-sharing, check-in
  and alert choices. Existing profiles retain their current workspace.
- **Home** combines a date-aware goal/event/activity summary with an expandable
  conversation dock. A compact strip of saved widgets remains visible while the
  conversation is open; collapsing it reveals the full saved widget area and keeps the compact dock at the bottom. A recovery card appears only when a connected source or check-ins need attention and links to the relevant repair surface. Returning from Settings preserves whether the conversation was open. Goal details open in place; **Edit home** opens the
  saved widget arrangement directly, and Done restores the briefing and dock. Tracking shows current browser, Calendar, and Gmail
  access; Browser usage shows retained recorded time by site and day.
- **Talk** expands within Home, keeping the summary cards and compact widget
  context visible. Goals and Activity open as detail panels over this workspace. History stays inside the
  dock; drafts and the selected conversation survive collapsing and reopening.
- **Goals** opens from its Home widget and provides a detail view of active, completed, cancelled,
  and recoverable deleted goals.
- **Activity** opens from its Home widget and starts with a concise, honest
  reflection of available activity plus explicit check-in and recording controls. The recorded rows remain available on demand, while repeated unfinished check-ins are summarized before their individual audit entries. A pause keeps a visible **Resume recording** action in the same Activity header. Recoverable deleted
  items appear when they contain data. Observed time is evidence of an admitted
  signal, never proof of attention, progress, or completion.
- **Permissions** combines activity capture, detail level, AI sharing, and connected-app management in one destination with independent controls. Calendar entries are
  separate from goals; source access does not automatically authorize sharing
  that data with the model.
- **Speech** is local transcription into an editable draft. The person reviews
  and sends the text through the ordinary conversation path.

## Product limits

eïlo does not infer a schedule from loose wording, invent deadlines, treat an
app or page as proof of distraction, declare work complete from activity, or
automatically block access. It does not make purchases, send messages, enroll
the user, or act in external systems through ordinary conversation.

Proactive support must be contextual and restrained: a short, grounded nudge or
acknowledgment where a user-permitted signal warrants it. It should not become a
fixed coaching schedule, a stream of unsolicited work plans, or an obligation to
maintain a manual tracker. Breaks, corrections, and changed goals are legitimate
input.

## Design principles

### One Home component design

Every card on Home is a normal widget with the same move, resize, remove, and keyboard controls. Permitted context can add relevant widgets and update their contents; it must not hide existing widgets or replace the board with a separate fixed layout. Preserve saved positions and sizes through content updates. Removed automatic widgets stay removed until explicitly added again; whole-card pages use a compact arrow-and-dot control when all widgets cannot fit. A chosen note remains editable and separate from the layout.

**Settings** remains a separate page reached from Home, with an explicit Back to Home control, organized into General, Widgets & layout, Permissions, Memory, and Account. Source collection and AI sharing remain separate controls. Connection setup opens in Settings; other pages link there rather than hosting competing setup menus. **Add relevant widgets** is a separate presentation choice; it grants no source or AI permission. Guided first setup replaces the empty Home before approval. After approval, its optional support invitation sits beside the conversation, and connection steps open inline. Settings stays outside the widget canvas. Keep the Check-ins switch and recording state/control in the Activity header across its views. Put status details and desktop alerts behind the adjacent settings icon. Empty Activity has one source action; recorded sessions must not open to a blank Overview. Expose history filters and recovery categories when they contain records.

The ordinary starter Home uses warm surfaces and Continue, Help me start, and Change plan actions; an approved first workspace starts with only its chosen widgets. The launcher adapts to widget dimensions, and its Today summary stays inside the card. On Home, Talk expands as a dock while the day summary remains visible; collapsing it reveals saved widgets and keeps the compact dock available. Message scrolling and composer height share normal layout so long drafts cannot overlap the conversation.

### Frontend instructions

Use familiar controls, alignment, and selected states to make interactions apparent. Home is the primary workspace; Goals and Activity expand over it without a sidebar. Settings is separate. The orb remains in the Home conversation dock and first setup. Keep populated messages and the composer free of decorative logos and extra branding bars; History stays within Talk. Avoid visible counts, captions, or instructions that merely explain the interface. Keep clear text for navigation, consent, errors, and recovery. When a procedure needs instructions, show one short instruction and one immediate action at a time. Multi-step setup uses a visible current step with Back/Next; do not show the entire procedure at once. Put optional explanation, troubleshooting, and keyboard reference behind a concise disclosure. Favor less copy over additional instructional panels.

Do not use thin line dividers as a section-separation component. Group related content with spacing, alignment, typography, material, shape, or a meaningful visual instead. Lines remain valid only when they encode data or define a control's necessary boundary; they must not be decorative separators between stacked content.

Adding a Home widget starts an unsaved placement preview. Let the person drag and resize it, show which existing widgets would move to another page, and commit only with Place. Cancel or reload keeps the prior layout; confirmed placement supports Undo. Adaptive state cards display source-owned text read-only; ordinary Notes widgets remain editable.

Routine chat status and context usage belong with the composer. Keep the percentage and compact progress ring in its toolbar. Its inline detail shows the whole context window as an estimated, labeled category breakdown, including available space and the auto-summary reserve; omit categories that are not actually loaded. Keep exact counts and summary controls with that visual. Do not turn the composer into a tabbed settings panel or a modal. Keep typing and the conversation available. App-owned detail and confirmation flows open inline; preserve explicit confirmation controls.

Keep the consequence of a permission or destructive action visible at the decision point. Progressive disclosure must not hide what information reaches the AI, merge independent permissions, imply that a setup step granted access, or replace a necessary recovery instruction with a generic error. Preserve user-written content and real source data; this rule governs product instructions and help.

### Browser setup and focus

Browser context works across regular HTTP and HTTPS sites. Do not require users to pick from a fixed site list or label sites as productive/distracting. eïlo interprets permitted context alongside the person's conversation and commitments; the site alone is not evidence of intent or completion. One optional Chrome permission covers the browser. Site exclusions are optional controls, not an onboarding prerequisite.

Pointer clicks must not leave a bright keyboard-focus outline behind. Keep actual selected states, editing carets, Home arrangement cues, and visible focus when navigating by keyboard.

### Product composition

- Use varied task examples in mockups, fixtures, and onboarding. Progress should
  reflect the person's actual task and available evidence: a meaningful status,
  next step, or an appropriate unit when a count is useful. Do not default every
  task to problems solved, a fixed checklist, or a universal focus score.
- Do not restore the floating sidebar. Keep Goals and Activity accessible from
  Home widgets, with Close and Escape returning to the workspace. Keep full
  Home cards within the page; never slice a widget at the canvas boundary.
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
and asks for a small first step in the ordinary conversation. No mandatory timer,
daily planning ritual or widget arrangement precedes ordinary use.

A daily return briefing is on by default. On the first connected Home visit of
a local day, or after at least four hours away, it expands the conversation only
when no draft, pending reply or break is active. A blocked first visit does not
trigger delayed guidance after work clears. Dismissal persists for the local day. The opening is currently a
local projection of saved goal and date state, not an automatic model turn or
new mailbox read. Exact ISO goal dates may be identified as passed; ambiguous
wording is shown for confirmation without inventing a deadline. A passed date offers
**Finished**, **Still want to**, **Drop goal**, and **Not now**; keeping it opens the
real goal editor with a calendar date separate from the person's timing note. It uses confirmed task state and
only explicitly linked next-step context. Calendar information requires a current
connected cache (under fifteen minutes old); this UI performs no new AI source
read. Its next-step and dismissal choices remain optional. Dismissal applies across chats
for the local day, and the user can turn guidance off. Short returns retain the
draft and conversation instead of restarting guidance.

Visible navigation and restrained interface sounds default on only where no
preference exists. Explicit off choices persist. A saved permission is distinct
from receipt of activity. Home source cards and its recovery card report Desktop,
Browser, Calendar, and Gmail health and open the relevant management surface. Collection,
AI sharing and alerts never gain consent from this presentation default.

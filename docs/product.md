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

- **Home** combines a persistent conversation composer with configurable,
  content-specific widgets. Tracking shows current browser, Calendar, and Gmail
  access; Browser usage shows retained recorded time by site and day.
- **Goals** provides an optional direct view of active, completed, cancelled,
  and recoverable deleted goals.
- **Activity** separates explicitly permitted observations from delivered
  check-ins. Observed time is evidence of an admitted signal, never proof of
  attention, progress, or completion.
- **Connections** makes each source and its scope visible. Calendar entries are
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

**Settings** is available in the floating navigation, organized into General, Widgets & layout, Activity & AI, Connections, Memory, and Account. Source collection and AI sharing remain separate controls. Connection setup opens in Settings; other pages link there rather than hosting competing setup menus. **Add relevant widgets** is a separate presentation choice; it grants no source or AI permission. Setup and settings never take space away from the widget canvas. Keep Check-ins and its explicit on/off action visible at the top of Activity Overview, including when modern activity records are available.

Home uses warm gradient surfaces and four direct starting actions. The launcher adapts to widget dimensions, and its Today summary stays inside the card. Conversation opens as a full-height view with its own Back control; the previous page is hidden until the conversation closes. Message scrolling and composer height share normal layout so long drafts cannot overlap the conversation.

### Frontend instructions

Use familiar controls, alignment, and selected states to make interactions apparent. Avoid visible counts, captions, or instructions that merely explain the interface. Keep clear text for navigation, consent, errors, and recovery. When a procedure needs instructions, show one short instruction and one immediate action at a time. Multi-step setup uses a visible current step with Back/Next; do not show the entire procedure at once. Put optional explanation, troubleshooting, and keyboard reference behind a concise disclosure. Favor less copy over additional instructional panels.

Keep the consequence of a permission or destructive action visible at the decision point. Progressive disclosure must not hide what information reaches the AI, merge independent permissions, imply that a setup step granted access, or replace a necessary recovery instruction with a generic error. Preserve user-written content and real source data; this rule governs product instructions and help.

### Browser setup and focus

Browser context works across regular HTTP and HTTPS sites. Do not require users to pick from a fixed site list or label sites as productive/distracting. eïlo interprets permitted context alongside the person's conversation and commitments; the site alone is not evidence of intent or completion. One optional Chrome permission covers the browser. Site exclusions are optional controls, not an onboarding prerequisite.

Pointer clicks must not leave a bright keyboard-focus outline behind. Keep actual selected states, editing carets, Home arrangement cues, and visible focus when navigating by keyboard.

### Product composition

- Use varied task examples in mockups, fixtures, and onboarding. Progress should
  reflect the person's actual task and available evidence: a meaningful status,
  next step, or an appropriate unit when a count is useful. Do not default every
  task to problems solved, a fixed checklist, or a universal focus score.
- Preserve the floating sidebar. Its hover target includes a forgiving gutter,
  it stays open while the pointer or keyboard is using it, and it waits before
  hiding after pointer exit. Keep full Home cards above the composer; never
  slice a widget at the canvas boundary.
- Favor automatic upkeep from conversation and explicitly permitted context over
  repetitive forms.
- Keep Home, Goals, and Activity distinct: a configurable daily surface, a goal
  management workspace, and a record of consented context.
- Make control boundaries legible. Enabling one connection does not silently
  enable another collection, model-data flow, or notification route.
- Present uncertainty honestly. The UI only claims facts supplied by its current
  backend and records.
- Preserve visual restraint: readable IBM Plex Sans typography, calm surfaces,
  and interactions that can be exited easily.

Longer research, alternatives, and dated design rationale live in
[design records](design/). A record can explain why a decision was made; the
current code and these product boundaries define what is supported now.

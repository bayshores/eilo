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

Manual Home is the visual authority for both modes. Adaptive Home changes the
contents, emphasis and placement of those components; it must not introduce a
separate card style, type scale, notes editor or tracking/usage presentation.
Reuse Home's shared surfaces and content primitives. Keep the existing sidebar,
conversation dock and pinned widgets stable. New content types must follow the
same design, with no decorative heading badges or additional visual skin.

The header offers one Home context entry point. A plain-language Arrange Home for me setting controls automatic composition; do not bring back a competing Adaptive/Manual mode pair. Setup and settings must never consume unmeasured space above the widget canvas or hide its bottom edges.

### Frontend instructions

Across the frontend, show one short instruction and one immediate action at a time. Multi-step setup uses a visible current step with Back/Next; do not show the entire procedure at once. Put optional explanation, troubleshooting, and keyboard reference behind a concise disclosure. Favor less copy over additional instructional panels.

Keep the consequence of a permission or destructive action visible at the decision point. Progressive disclosure must not hide what information reaches the AI, merge independent permissions, imply that a setup step granted access, or replace a necessary recovery instruction with a generic error. Preserve user-written content and real source data; this rule governs product instructions and help.

### Browser setup and focus

Browser context works across regular HTTP and HTTPS sites. Do not require users to pick from a fixed site list or label sites as productive/distracting. eïlo interprets permitted context alongside the person's conversation and commitments; the site alone is not evidence of intent or completion. One optional Chrome permission covers the browser. Site exclusions are optional controls, not an onboarding prerequisite.

Pointer clicks must not leave a bright keyboard-focus outline behind. Keep actual selected states, editing carets, Home arrangement cues, and visible focus when navigating by keyboard.

### Product composition

- Use varied task examples in mockups, fixtures, and onboarding. Progress should
  reflect the person's actual task and available evidence: a meaningful status,
  next step, or an appropriate unit when a count is useful. Do not default every
  task to problems solved, a fixed checklist, or a universal focus score.
- Preserve the current sidebar's appearance and interactions during the visual
  polish pass. Generated alternatives do not supersede the existing navigation.
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

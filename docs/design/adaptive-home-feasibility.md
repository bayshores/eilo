# Adaptive Home feasibility

Assessed September 10, 2026. This is a feasibility proposal, not an accepted
design or implementation milestone. No UI, model contract, or permission changed.

A useful first version can build on the current widget system. The larger effort
is choosing a helpful presentation from incomplete context and keeping it stable
while someone works.

## Verified foundation

- [Layout](../../web/home/layout.js) already has a validated widget catalog,
  responsive footprints, positions, and normalization of saved layouts.
- [Home data](../../web/home/data.js) derives a current task, break state, and
  task-specific count and unit from the authoritative snapshot.
- [Live widgets](../../web/home/live-widgets.js) render current data. Today already
  changes between calendar and commitment content. Widget types and their internal
  compositions are currently fixed; the model does not choose a UI composition.
- [Human driver](../../app/human_driver.py) accepts a validated conversation/task
  envelope. A presentation proposal would require a new validated contract, not
  merely a prompt asking the model to redesign Home.
- [Browser context](../security.md#browser-connection-scope) supplies minimized
  site/title signals when permitted. It does not expose document bodies or prove
  progress, attention, completion, or intent.

## Proposed first slice

Keep the existing sidebar, composer, and user-arranged widgets. Add one adaptive
current-work region. The agent composes it from a small set of carefully designed
elements: a current intention, next step, relevant links, compact stages,
comparison rows, and a count only when the task has a meaningful unit.

The components should combine around the actual task, without a fixed menu of
coding/writing/study modes. For example, an essay could show the section to return
to and its source links; trip planning could show dates and options already
discussed; creative work could show the agreed next revision. These are illustrative
presentations, not capabilities that can currently inspect those documents or apps.

Start with task changes established in conversation. Retain the last useful view
through tab detours, refreshes, loading, and failed generation. Preserve drafts and
keyboard focus. A proposed pin/keep control and undo should make adjustments cheap.
Changing presentation must never silently change a commitment or source permission.

The implementation can use a validated presentation description, rendered through
eïlo's own components. A2UI documents this general pattern: agents compose surfaces
from a catalog, bind data, and update components by stable identifiers. This is a
reference pattern, not a decision to adopt its SDK or replace the current frontend.
[A2UI component documentation](https://a2ui.org/concepts/components/).

## Effort estimate

These are preliminary engineering judgments for one developer familiar with the
current code. They are not measured delivery promises. They assume reuse of the
current runtime and existing permitted data, with no new app integrations.

| Scope                                                                                                                        | Rough effort                                                  |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| One adaptive region, a few reusable elements, explicit conversational task changes, sample cases                             | 2–4 focused development days                                  |
| Integrated first version with saved presentation state, validation, fallback, pin/undo, accessibility and varied-task checks | 1–3 weeks total                                               |
| Reliable automatic task/context adaptation and learned preferences across real use                                           | Several additional weeks or longer, with ongoing user testing |

Automatic understanding of arbitrary native apps would add separate integration
work. Appearance can adapt across any task using conversation; reliable automatic
knowledge of the work depends on what evidence is actually available.

## Review checkpoint

Before widening this into whole-Home composition, compare the same adaptive region
across three unrelated tasks and a temporary tab detour. It should preserve the
current sidebar, stay concise, use appropriate progress semantics, make no invented
data claims, and recover from an incorrect adaptation without disrupting work.

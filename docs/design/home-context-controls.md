# Home context controls and clipping repair

Status: local development; not released.

## Product direction

Home widgets must have complete edges within the available canvas. Use one
plain-language arrangement control rather than competing modes or dense context
disclosure. Preserve the Manual widget design, sidebar and conversation dock. Keep
instructions short and evaluate performance as part of UI work.

## Implementation

The former setup panel took normal-flow space above the manual board while that
board still used the whole canvas height. The fixed conversation dock exposed the
resulting clipping. Setup now lives outside the canvas in a modal side panel;
the adaptive host always uses an absolute overlay and contributes no flow height.

The header has one **Home context** control with a truthful state. The drawer uses
Overview, Sources and Memory tabs. **Arrange Home for me** replaces the two mode
buttons; it changes only layout behavior. AI sharing, desktop capture, Chrome and
visible text retain independent controls. More detailed capture and exclusions use
progressive disclosure. Undo, context corrections, explicit preferences and history
removal remain available. Closing a correction cancels that edit; a changed context
cannot silently receive an older correction draft.

`web/adaptive/context-panel.js` owns the drawer and fixed control instances.
`controller.js` keeps the latest acknowledged state for commands even while Home
rendering waits for a safe moment. This avoids stale revisions or replacing earlier
permission choices when several settings are changed without closing the drawer.
Exclusions use the supported configuration endpoint and display server validation.

Reference calibration used [Amie's contextual details](https://mobbin.com/screens/ff9b0ff4-cdf3-465c-9959-eba67c46fa3f)
and [Notion's agent source controls](https://mobbin.com/screens/ff8e618b-a9a8-487b-a3f4-07ec75a397ef).
Their inspected screens informed grouping and disclosure, not a replacement visual
identity for eïlo. Motion uses transform/opacity, respects reduced motion and retains
the existing local GSAP layout animator.

## Verification

- Isolated browser checks at 1280×840, 900×650, 860×600 and 640×800 kept every visible
  widget wholly inside the canvas, clear of the conversation dock. The drawer fit
  each viewport after its entrance transition; no horizontal overflow was present.
- Source toggles retained independent values through successive acknowledged
  changes. Invalid website exclusions showed an actionable error; a valid exclusion
  could be added and removed. Dismissed errors did not reappear on a fresh open.
- Arrow-key tab navigation, Escape dismissal and focus restoration passed. The
  app's Reduce motion preference disabled drawer, backdrop and switch transitions.
- Native lifecycle checks require healthy-owned-child reuse, bounded cold-start
  readiness polling, bounded request timeouts, and protection for foreign services.
- Tests use separate synthetic state. They do not establish live capture, account,
  or model-sharing state.

## Performance evidence

An isolated fixture served the real UI with an observational probe. It recorded
event-to-next-animation-frame delay, frame intervals, browser long tasks and DOM
counts. It did not automate controls itself, call a real AI, collect activity or
transmit data. Browser actions exercised ten identical cycles of drawer open/close,
three tabs and layout on/off; each run observed 90 input/change events over about
20 seconds. These are two individual runs, not a statistical latency claim.

| Observed metric                    | Before rendering cleanup | After rendering cleanup |
| ---------------------------------- | -----------------------: | ----------------------: |
| Event to next frame, p95           |                   5.9 ms |                  5.2 ms |
| Frame interval, p95                |                   9.2 ms |                  9.2 ms |
| Longest sampled frame interval     |                  33.1 ms |                 16.5 ms |
| Sampled frame intervals over 25 ms |                        1 |                       0 |
| Browser long tasks                 |                        0 |                       0 |
| DOM mutation records               |                    4,003 |                   3,688 |
| Final DOM element count            |                      562 |                     562 |

The changes remove hidden-drawer rendering on snapshots, gate header/control writes,
separate live binding refreshes from composition animations, preserve unchanged card
bodies, gate mode/pin updates and reuse geometry already measured by the board.

A separate 122.5-second native idle sample measured cumulative CPU time and RSS for
eïlo's five app/backend processes. Mean combined CPU was about 0.30%. Renderer RSS
went from 56.1 to 34.5 MiB; backend RSS from 28.8 to 17.1 MiB. This observed no upward
trend during the sample. RSS is process resident memory, not exclusive allocation;
the instrumented browser's heap values across reloads are not a leak test.

The remaining two-hour capture/model soak, varied real work and pilot-user study
are still required. These checks do not establish performance on all machines or
qualify the full beta for release.

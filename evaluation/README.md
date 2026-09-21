# felis evaluation fixtures

felis (AY-loh) is a proposed context-aware accountability app. These two sanitized seeds and six hypothetical cases are **draft evaluation materials, not benchmark results**. Neither Hermes nor OpenClaw has been selected, installed or tested here.

## Evidence boundary

The parent supplied two Mac observations: gallery/project-page navigation with an assistant switch, and assistant/video-site/team-chat foreground changes. They establish navigation and foreground order only. Goals, content, attention, productivity, breaks and completion were not established. Seed A groups repeated page visits without inventing a page count or individual clicks.

Every user message and extension is hypothetical. Numeric offsets, identifiers and device aliases are invented replay metadata, not measured durations or intervention thresholds. The secondary desktop represents a possible Windows continuation; a connection was configured, but the computer was powered off, and no Windows history was verified. The JSON tags this provenance separately from inputs.

No raw history, communications, URLs, titles, names, private identifiers, source paths or calendar timestamps are included. Preparation involved no monitoring, computer control, credentials access, installation, network/model calls or paid usage.

## Cases

| Case | Seed | Hypothetical context or extension                                                                           |
| ---- | ---- | ----------------------------------------------------------------------------------------------------------- |
| 01   | A    | Explicit project-example research                                                                           |
| 02   | B    | Coding-study commitment before focus activation; video/chat purpose unknown                                 |
| 03   | B    | Same commitment and activity; user identifies relevant tutorial visits                                      |
| 04   | A    | User corrects the current task from coding study to project research                                        |
| 05   | B    | Declared break, explicit resume, completion, then another video-site visit                                  |
| 06   | B    | Corrected goal, break and completion across device change, compaction/restarts, duplicates and stale events |

Cases 02/03 differ in the user's explanations, not app categories. Exact escalation policy remains undecided: quiet uncertainty or a brief useful clarification can both meet the draft criteria.

## Replay contract

- `model_inputs`: common policy, reusable sequences and additional deliveries. Expose only the policy and individual events as they arrive, never future messages.
- `runner_only`: descriptive native lifecycle operations for later replay; not model-visible messages or executable controls.
- `evaluator_only`: provenance, labels and expected-state/behavior checks. Keep this section and README outside candidate context and searchable storage.

For each fresh case, resolve `sequence_id`, merge the sequence with `additional_deliveries`, and sort by `deliver_s`. Deliver each `event` with its arrival offset as transport metadata. `occurred_s` uses a common synthetic clock; negative times precede the first seed event. Preserve these offsets; no wall-clock waiting is required. A repeated event ID has an identical payload but a later arrival. Unseen stale events also arrive late. IDs are scoped to a case. Sequence provenance is inherited; every additional delivery is synthetic.

Capture replies and inert proposals; allow silence on activity events. Provide no executable app controls. Checkpoints describe semantic state, not a mandatory storage schema. `none_declared`/`not_reported` indicate missing evidence. Completed goals may remain in history with no active goal.

In case 06, invoke native compaction at 160 and native restarts at 180/220. Restore only runtime-produced summaries/state through supported continuation paths. Do not inject gold state, supply a prepared summary, manually replay history to repair persistence, or add an adapter-owned goal tracker. Normal native history restoration is allowed. Unsupported operations are limitations; recovery cannot pass unless its boundary actually runs.

## Fair later comparison

After separate authorization for runtime/model usage, pin actual Hermes/OpenClaw revisions. Match the compatible model/provider/version, sampling settings, context/output limits, policy, available tools and deliveries. Document unavoidable differences and runtime configuration. Use isolated initial state per case, preserving state only within its lifecycle boundaries. Adapters should normalize delivery, invoke supported lifecycle hooks and collect evidence.

Use the same small repeat count and alternate runtime order. Add a separate case-06 baseline without lifecycle operations to distinguish ordinary state/transport failures from recovery failures. Review replies, proposal logs and inspectable runtime-owned state; mark unverifiable state unknown. Do not request private reasoning or grade exact wording.

| Measure            | Review                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| State retention    | Current goal, superseded unfinished goal, break/resume and reported completion                      |
| Uncertainty        | Unknown purposes remain unknown; explicit explanations change assessments                           |
| Interventions      | Unwanted/repeated prompts, old-goal nudges, pressure during breaks, false action claims             |
| Recovery           | State through native compaction/restarts; need for user restatement                                 |
| Events/devices     | Duplicate/stale handling and continuity on the synthetic secondary desktop                          |
| Latency/cost       | Response and recovery latency, total tokens and actual cost including compaction, failures/timeouts |
| Integration effort | Setup, adapters, persistence/device plumbing, unsupported hooks and required runtime changes        |

Store future results separately. Replay examines responses to supplied context. Sensor fidelity, clock skew, real cross-device transport, OS control, privacy/permissions integration, intervention timing and daily usefulness remain untested.

## Validation performed

`python3 -m json.tool scenarios.json` and a one-off local structural check passed: two seeds, six cases, provenance/input separation, checkpoint references, paired-context consistency, lifecycle placement, two identical duplicate payloads and two unseen stale events. No test suite or replay framework was added; these checks validate fixtures, not agent performance.

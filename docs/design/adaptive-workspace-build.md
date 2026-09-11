# Adaptive workspace implementation

Status: local development; not released. Passing checks do not establish release readiness.

## Product contract

Home adapts to any laptop task using conversation and separately permitted context. The existing sidebar, conversation dock, manual layout, and pinned widgets remain stable. Work recognition never creates or completes a commitment. Presentations use eïlo's component catalog, known resources, and validated records rather than generated code, arbitrary actions, or invented progress.

Keep IBM Plex Sans and the charcoal/warm identity. Make the content visual through source previews, comparisons, stages, timelines, and measured usage. Instructions stay short, with secondary information on demand. Motion uses locally served pinned GSAP core/Flip: 120 ms feedback, 180 ms content changes, 360 ms layout transitions, with reduced motion and gesture deferral.

## Runtime boundaries

- Swift supplies foreground-app identity, separately permitted Accessibility text, and optional transient foreground-window images. Native browser rich capture is withheld; only the Chrome integration may establish browser privacy and exclusions. No audio, clipboard, keystrokes, or app control.
- The native Chrome bridge is registered at development and standalone startup. Browser capture still requires an actual optional host grant and a connected extension; registration alone neither enables collection nor establishes a browser session. Native ingestion uses an authenticated local socket and revisioned consent. The page bridge remains an optional legacy compatibility path.
- An isolated Hermes driver uses the existing `openai-codex` / `gpt-5.6-luna` route with no tools, native-chat persistence, background review, or fallback provider. Human conversation preempts automatic inference. Automatic context has its own 12/hour and 60/day ceiling.
- Context content is encrypted in local SQLite with a macOS Keychain key. Detailed activity expires after 24 hours; summaries after 30 days. Explicitly chosen notes/preferences can persist. Full-text search is in memory. Images never enter the content store.
- Expiry drops raw detail without unnecessarily deleting valid summaries. Explicit forgetting traverses derivation links and clears affected context, inferred preferences, search, and cached compositions. Saved conversations are a separate store and require separate deletion.

## Implementation

| Area                  | Implementation                                                                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context and memory    | Revisioned context/Home commands; encrypted SQLite records; Keychain adapter; memory-only search; intervals and return points; provenance-aware forgetting; separately retained chosen notes/preferences.                        |
| Inference             | Isolated text analysis through the pinned subscription route; no action tools or native-chat persistence; human-turn cancellation; independent 12/hour and 60/day budgets; cached restoration and bounded same-resource updates. |
| Adaptive Home         | Ten catalog components; stable widget identities; manual-layout restoration; anchors and pins; undo; note-draft preservation; deferred rearrangement while editing; inspectable presentation preferences.                        |
| Capture               | Persistent Swift helper; app activation plus bounded AX reads; idle/lock/sleep handling; consent revisions; browser rich-data withholding; separate visual code path that remains gated off.                                     |
| Chrome                | Authenticated Native Messaging host; exact extension-origin allowlist; optional broad grant; optional exclusions; private/unknown browser states withheld; transport/permission rechecks before admission.                       |
| Account and packaging | Structured user-started sign-in; no recovery/import from global credentials; managed Python runtime; app-owned writable state outside the bundle; native-host registration at development and packaged startup.                  |
| Activity and usage    | Compact episode rows with selected details; actual source health; seven days of recorded intervals; no inferred focus or completion score.                                                                                       |

The six-task interactive proof is available with `npm run dev` and `?adaptive-preview=1`. Its scenario selector and data are explicitly synthetic; the production Home has no task-category picker. `scripts/preview-context.py --port 8769` exercises real HTTP/context orchestration with an injected analyzer, temporary state, and no accounts or capture.

The implementation entrypoints are `app/context_service.py`, `app/context_store.py`, `app/adaptive_driver.py`, `app/context_capture.py`, `activity/native/EiloContextCollector.swift`, `activity/extension/native.js`, and `web/adaptive/`. The HTTP capture boundary is deliberately absent: observations arrive on the authenticated native channel.

## Verification and limits

- The complete repository check passed: formatting, lint, checked TypeScript boundaries, JavaScript tests, Python tests, public-asset allowlist and documentation links. The Home context follow-up passed 189 JavaScript tests and 226 Python tests (415 total); counts alone are not a release gate.
- A real synthetic **text** request passed on the pinned subscription. Driver construction confirmed zero tools and no native session database. Marker-only inspection found no matching synthetic fixture text in native conversation/history/log storage. This does not establish provider-side retention behavior.
- The synthetic **image** task repeatedly returned the colors in the wrong order. Visual capability is **unavailable** in the service/UI. The exact adapter/model failure remains unresolved; no provider switch or text-only image fallback was enabled.
- Native compilation, policy self-test and permission preflight cover code paths. Real AX capture and protected-field behavior under granted permissions remain unverified.
- Native-host subprocess tests cover framing, invalid origin, stale consent, disconnect and termination. Extension mocks cover private/unknown windows, exclusions during extraction, numeric timestamps and disconnect cleanup. These checks do not establish a live host grant, connected extension, or browser capture session.
- Browser inspection covered desktop and 900×700 layouts, deferred changes with the exact note/caret preserved, a pinned card, Undo with its saved note, manual restoration, task transitions and reduced motion. Broader keyboard/selection/resize combinations and measured 60 fps remain review work.
- An accelerated two-hour replay admitted 1,440 synthetic events and reported exactly 7,195 recorded seconds. With Python allocation tracing enabled: ingestion median 2.00 ms, p95 3.11 ms; snapshot 10.06 ms; traced current/peak allocation 0.25/0.66 MiB. Forgetting removed activity, episodes and search entries. This is a fast synthetic replay, **not** a two-hour real-time memory/CPU soak or end-to-end 60 fps benchmark.
- The unsigned bundle started its service from its bundled runtime with fresh temporary data, no checkout dependency, no conversations, no content-key request, capture off and `needs_sign_in`. This verifies the local service launch, not a clean-machine Electron/Chrome permission journey.

## Manual-mode regression repaired

Switching from Adaptive back to Manual could collapse cards to one pixel wide. The renderer measured the hidden manual board before revealing it; because the outer container had not resized, the resize observer never repaired the result. Geometry now comes from the visible containing block, and a genuinely hidden Home preserves its last valid measurements. The fix also applies when leaving the visual proof.

The broken 1181 px browser view was inspected before reload and showed 1 px cards. After the fix, three complete Adaptive → Manual cycles retained 361/741 px card widths. Switches at 900 px and 640 px produced 415 px and 590 px cards respectively, with no horizontal overflow. This is a geometry check of the actual rendered controls, in addition to unit checks.

Verification uses isolated synthetic state and must preserve durable state across service refresh. Browser geometry checks passed; native capture, permission, and standalone lifecycle coverage remain separate acceptance work.

## Shared Home component correction

Manual Home is the visual authority:
both modes now share the `home-widget` surface, responsive `widget-content` spacing
and typography, and `note-input` editor. Adaptive lists and stages reuse the existing
Home content primitives; Tracking and Browser usage call the same renderers and
validated selectors as Manual. Source changes refresh those widgets independently
of composition changes. The preview uses the same components, without its own skin.

Removed Adaptive's gradients, borders, smaller heading scale and inset notes field.
Pin and presentation feedback remain available in a quiet widget menu with keyboard
focus and Escape/outside-click dismissal. Manual geometry and interaction ownership
remain separate from the shared visual shell.

Codex browser comparison measured matching neutral surfaces, 22 px corners, 25 px
IBM Plex headings at weight 500, and the same responsive padding. Two complete mode
cycles at each of 1181, 900 and 640 px kept Manual widths of 361/741, 415 and 590 px,
with no horizontal overflow or collapsed cards. The synthetic note remained intact;
pin/unpin and keyboard menu dismissal passed. Six task fixtures use the same card
design. These checks are local browser fixtures, not a native capture or release gate.

## Home context and performance follow-up

The [Home context controls and performance record](home-context-controls.md) supersedes the earlier button/disclosure UI and resolves the adaptive-without-context clipping path. It records targeted rendering and native idle measurements; the longer capture/model soak remains pending.

## Work still gated or pending

1. Diagnose and prove the image path before making visual context available.
2. Exercise actual permitted native capture, private browsing, exclusions, sleep/wake and revocation with explicit consent.
3. Review the motion proof and carry out the real-time performance session and 8–12 participant comparison study. The controlled tests above do not establish ADHD benefit or long-term usefulness.
4. Validate complete Electron startup, updates/rollback and onboarding on a clean Mac before distribution work.

## Research provenance

Use capture and interval patterns from [ActivityWatch](https://github.com/ActivityWatch/aw-watcher-window/blob/master/aw_watcher_window/main.py) and [OpenAdapt Capture](https://github.com/OpenAdaptAI/openadapt-capture); evidence-linked memory patterns from [Hindsight](https://github.com/vectorize-io/hindsight) and [Graphiti](https://github.com/getzep/graphiti); stable custom components from [A2UI](https://a2ui.org/concepts/components/). [Computer History](https://learn.chatgpt.com/docs/customization/computer-history) is a conceptual reference, not an imported private runtime. Do not embed Screenpipe under its current restricted license.

Visual references are [Amie's contextual detail](https://mobbin.com/screens/ff9b0ff4-cdf3-465c-9959-eba67c46fa3f) and [Opal's focal hierarchy](https://mobbin.com/flows/b9e9caad-df96-47a8-9477-51ded4b72d37). Test motion and predictability in the actual shell, preserving its sidebar.

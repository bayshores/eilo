# Activity visuals and permission setup

September 11, 2026. The shared activity visuals and native-host registration are implemented. The guided permission handoff below remains proposed work. App distribution is on hold.

## Implemented visual behavior

Tracking uses compact source tiles inside the existing shared widget. Browser usage has a selectable seven-day chart and a proportional website ribbon. Website names and recorded time appear on pointer, keyboard focus, or click; a permanent domain label is intentionally absent to keep the default chart concise. Activity Overview combines the same Usage widget with a day map. Browser lanes use validated website origins, while desktop lanes identify the app. Selecting a session reveals its recorded page/work title, website, app, observed span, and independently recorded duration.

Manual and Adaptive use the same components. Sidebar and conversation dock remain stable. The Tracking gallery overlap is repaired with a contained preview layout. Existing notes, drafts, source permissions, and pin choices are not part of a visual update.

The map accepts at most 50 valid episodes, separates overlapping spans, preserves a selected or focused lane when limiting visible sources, and fits its UTC axis around the selected day's records. Zero-duration observations are points. Website origins must be literal canonical HTTP(S) origins; paths, queries, credentials, and malformed values cannot become a claimed site. Distinct ports remain distinct. Missing browser identity displays Website unavailable. No usage is inferred from an open app or the length of a seen span.

The sample preview is explicitly marked. Run `scripts/preview-context.py --port 8774 --sample-activity` through the project Python environment for generated data only. The sample records never enter the real context store.

## References inspected

- [Opal weekly screen-time chart](https://mobbin.com/screens/ea59c327-1787-47dc-b850-15708c5e337d): one prominent value and an immediately legible weekly shape.
- [Opal focal statistic](https://mobbin.com/screens/62769965-9c74-417e-ae28-deb6c2aba10e): visual emphasis through measured content. eïlo does not adopt a productivity forecast or focus score.
- [Square time tracking](https://mobbin.com/screens/5662c873-eade-4047-bd12-121a166f0e46): identifiable spans against a time axis.

These are visual references, not evidence that the changes improve ADHD outcomes. No third-party screenshot, logo asset, font, or runtime dependency was copied from Mobbin.

## Chrome connection repair

The development app was missing native-host registration. Its browser policy could be enabled while no extension origin was configured, and a health-refresh bug left the prior disabled status in place. Development startup now installs the same narrowly identified bridge as the standalone build, using the checkout's project Python runtime and state directory. It does not grant browser access, enable capture, or change AI policy.

Health now distinguishes missing registration, waiting for the extension, actual connection, and disconnection. Routine refresh retains observed connection state. Browser origin/title capture still goes through the extension, with the existing broad optional grant, private-window rejection, exclusions, and policy revision checks. Native app identity is never used to guess a website. See [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) and [Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs).

Registration tests verify the fixed extension identity, executable wrapper, and correct runtime/state paths. Real browser capture requires a separate end-to-end check with the installed extension and an explicit grant. After a local app update, verify saved work and permission state before claiming successful recovery; registration alone is not proof that Chrome is connected.

## Permission-flow research and recommended next pass

The proposed handoff keeps setup inside the app and advances only after the required permission or connection is verified.

[Wispr Flow's Mac setup](https://docs.wisprflow.ai/articles/3152211871-setup-guide) is the closest verified reference: a permission card initiates the native request or opens the right settings pane; the card becomes actionable again if access is not detected, and the flow advances after a grant. Its [Mac installation guide](https://docs.wisprflow.ai/articles/7682075140-how-to-install-wispr-flow-on-mac) describes revealing the next permission card after the current grant. [Granola's setup](https://docs.granola.ai/help-center/getting-started/setting-up-granola-for-the-first-time) brings microphone and system-audio prompts into onboarding, while its troubleshooting documentation illustrates why a setting alone is not evidence that capture works.

[Opal's visual permission explanation on Mobbin](https://mobbin.com/screens/6ac44043-77af-43b5-b2ff-7ff7c4b35788) shows the expected system prompt. Borrow the short visual explanation, not its highlighted approval target or its product-specific local-storage claim. [Google Meet's microphone flow](https://mobbin.com/flows/b9431137-e00c-41b5-89e6-9f6717ff2064) places the native prompt directly after using the relevant control. [Apple's privacy guidance](https://developer.apple.com/design/human-interface-guidelines/privacy/) supports asking at the point of need with a short, concrete purpose.

Recommended eïlo flow:

1. Open one source's setup card from its actual feature or a clear Finish setup action. Skip already working steps.
2. Explain the benefit and scope in one sentence, with a small visual of the relevant setting. Show the exact app/helper name only after verifying which identity macOS requires.
3. Offer one primary action: Continue for a system prompt, or Open Settings when a manual toggle is required. eïlo already has a fixed, trusted link to Accessibility settings; it currently lacks the complete guided return path.
4. Recheck permission when the app regains focus and, while setup is visible, with a bounded status check. Confirm readiness from the actual collector or extension handshake, never from clicking the button. Close or advance smoothly once verified.
5. Keep Not now available, save setup progress, and show a specific repair step after denial or disconnection. Request microphone only for Speak, visual capture only for its optional feature, and browser access separately. Avoid a mandatory all-permissions checklist.

The app can reduce navigation and explanation. It cannot click the user's macOS privacy toggles. A published extension could remove unpacked-extension installation steps, but public distribution is explicitly on hold and is not a dependency of this local repair.

## Validation and performance

- Full local checks passed: 200 JavaScript and 232 Python tests, lint, types, formatting, repository/asset coverage. Tests cover origin validation, domain/port grouping, interval geometry, selection continuity, native registration, and truthful health transitions.
- Browser review covered Home, Activity, widget gallery, day/site selection, keyboard day navigation, 900 × 650 and 640 × 800 windows, and reachable session details. Gallery headings/actions do not overlap their previews.
- An isolated browser fixture used 50 same-day synthetic episodes across ten source lanes plus valid seven-day usage. Identical snapshots preserved all descendant nodes; changed usage retained the chosen day and keyboard focus; reduced motion stopped active animations. No long tasks were observed during the short workload.
- Profiling found repeated date/time formatter construction in the day map. Reusing formatters reduced measured changed-update p95 from 15.1 ms to 3.3 ms on this run; the map's share fell from 12.4 ms to 2.4 ms. The final per-renderer p95 was 0.1 ms Tracking, 0.8 ms Usage, and 2.4 ms Map. Cache-hit updates were 0.8 ms p95. These are local synthetic measurements, not a general hardware claim.
- The visible, focused in-app browser ran at approximately 30 Hz both idle and under load (33.6 ms p95 frame gap). This test did not establish native 60 fps performance. A two-hour memory/capture soak and pilot usefulness sessions remain separate acceptance work.

The temporary instrumentation lives under ignored `.tmp/activity-visual-perf`; it is not a production route or public asset. User activity was not used as test data.

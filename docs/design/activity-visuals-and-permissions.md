# Activity visuals and permission setup

September 11, 2026. The shared activity visuals, native-host registration and guided permission handoff are implemented locally. App distribution is on hold.

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

## Guided permission handoff

Setup opens at the point of need and shows one current action. Short status copy and a source-to-eïlo visual replace the old dense instructions. Privacy, installation and repair details stay collapsed. Existing components, the sidebar and the conversation dock are preserved.

The Mac app opens the fixed extension setup page directly in Chrome. It does not depend on a pinned toolbar popup or a localhost page remaining open. The extension also registers Chrome’s [Options entry](https://developer.chrome.com/docs/extensions/develop/ui/options-page), so Details → Extension options opens the same surface. First installation opens it once; updates and reloads do not. Opening setup never requests the optional browser grant on its own.

Browser metadata intent, a connected native channel, a current-policy grant acknowledgement, and a recorded activity receipt are distinct facts. A stale acknowledgement, disconnected channel or offline snapshot cannot finish setup. Disabled capture can still verify a connection without reading tabs. Policy changes invalidate prior acknowledgements, including when multiple channels overlap.

Desktop setup requests Accessibility only after visible text was explicitly chosen. The dedicated helper command requests permission and exits without collecting content. Returning to the app performs a metadata preflight. Setup checks run at most every 2.5 seconds for two minutes while the card is visible, with one request in flight; closing or hiding it suspends checks. Backend preflight requests share a short cache and do not start capture. Native commands accept only fixed destinations from the focused, trusted Home frame.

[Wispr Flow’s Mac setup](https://docs.wisprflow.ai/articles/3152211871-setup-guide) informed the request-and-return sequence. [WRITER’s connection flow on Mobbin](https://mobbin.com/flows/157e7cb5-93d9-4a00-95c2-b43f5780a60b) informed the concise initial, waiting and completed states. No reference assets were copied. Chrome’s [optional-permission requirements](https://developer.chrome.com/docs/extensions/reference/api/permissions) keep the grant tied to an explicit user action. The app cannot click macOS privacy toggles or Chrome’s permission prompt for the user.

No extension-store submission, distribution or permission expansion is part of this local implementation. Installed-extension compatibility, the actual native prompt and received website activity require separate live verification.

## Validation and performance

Activity ingestion registers a sample as seen only after its observation and episode writes succeed. A write failure reports a content-free capture error and leaves that event eligible for retry; a later accepted sample restores capture health. The setup card also respects capture errors even when the transport and grant are verified.

The context store indexes record expiry so both payload expiry and tombstone cleanup avoid full-table scans. A 20,000-record synthetic regression checks both query plans, immediate payload expiry and continued retention of a chosen note. No cache or deferred payload cleanup changes the retention boundary.

- Local checks cover JavaScript and Python tests, lint, types, formatting and repository/asset coverage. Setup regressions include explicit consent, disabled-policy verification, stale acknowledgements, multi-client disconnection, fixed native destinations, offline snapshots, bounded visible-only checks and cleanup. Activity checks cover origin validation, domain/port grouping, interval geometry and selection continuity.
- Browser review covered Home, Activity, widget gallery, day/site selection, keyboard day navigation, 900 × 650 and 640 × 800 windows, and reachable session details. Gallery headings/actions do not overlap their previews.
- An isolated browser fixture used 50 same-day synthetic episodes across ten source lanes plus valid seven-day usage. Identical snapshots preserved all descendant nodes; changed usage retained the chosen day and keyboard focus; reduced motion stopped active animations. No long tasks were observed during the short workload.
- Profiling found repeated date/time formatter construction in the day map. Reusing formatters reduced measured changed-update p95 from 15.1 ms to 3.3 ms on this run; the map's share fell from 12.4 ms to 2.4 ms. The final per-renderer p95 was 0.1 ms Tracking, 0.8 ms Usage, and 2.4 ms Map. Cache-hit updates were 0.8 ms p95. These are local synthetic measurements, not a general hardware claim.
- The visible, focused in-app browser ran at approximately 30 Hz both idle and under load (33.6 ms p95 frame gap). This test did not establish native 60 fps performance. A two-hour memory/capture soak and pilot usefulness sessions remain separate acceptance work.

The temporary instrumentation lives under ignored `.tmp/activity-visual-perf`; it is not a production route or public asset. User activity was not used as test data.

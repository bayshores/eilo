# Browser workspace

This is the production Home interface, shared by the Python service and the isolated sample preview. Start the preview with `npm run dev` from the repository root. The live service mounts it at `/home/`; see the [development guide](../docs/development.md) for the configured backend.

The browser uses native ES modules, CSS, and locally served fonts. It requires no framework, bundler, or runtime npm dependencies. `app.js` coordinates the widget board; feature modules own their rendering and lifecycle. New behavior should stay with its feature, with pure transitions separated from DOM effects.

| Directory                   | Responsibility                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `home/`                     | Pure grid layout, hold gestures, browser persistence, widget data and sample rendering     |
| `workspace/`                | Live application composition, URL routing, shared views and record controls                |
| `chat/`                     | Conversation client, pending receipts, chat library, streamed updates and request progress |
| `goals/`                    | Goal projections and validated editor values                                               |
| `calendar/`, `connections/` | Calendar presentation and explicit service/briefing controls                               |
| `activity/`                 | Check-in display, consented activity lease and the Chrome bridge/setup pages               |
| `speech/`                   | User-started capture, audio worklet and editable transcription                             |
| `styles/`, `assets/`        | Base styling, selected typography and licensed local fonts                                 |
| `preview/`                  | Fictional sample data; no native conversation or account data                              |

`asset-manifest.json` explicitly lists public files for both servers. Add a new module or stylesheet there and run `npm run check:repository`; directory scanning is deliberately not used for HTTP serving. Tests, configuration, licenses, and development tools are not public routes.

## State and interaction contracts

The HTML starts with `data-source="sample"`. Only the Python service changes it to `live`, allowing `app.js` to import the live integration. Sample Home never connects to an API. The typography study uses its own origin and saved layout.

Persisted layout, notes and preferences keep the existing `eilo:widget-prototype:*:v1` keys for compatibility. Conversation drafts and unresolved sends belong to one native conversation. Layout transfer includes only normalized geometry and presentation preferences; the fragment is removed after import.

`home/layout.js` owns pure geometry and never reads the DOM. Hold and resize interactions use the pickup layout as their baseline; Escape, blur and page transitions cancel unfinished work. Keyboard movement and focus restoration are part of the same interaction contract. Browser storage failure must leave the current session usable.

Changes to DOM markup must preserve safe text rendering for external content, visible focus, dialog exits, reduced motion, compact-window reflow, and the shared conversation draft. See the [user guide](../docs/user-guide.md) and [architecture](../docs/architecture.md).

## Verification

`npm run test:js` discovers colocated feature tests, extension checks, and desktop tests. `npm run typecheck` checks the typed browser boundaries listed in `jsconfig.json`. Tests use fixtures; they do not grant activity, microphone, account, or notification access.

For layout changes, also exercise direct resizing, fast and slow hold-to-drag, reversal, release/Escape, keyboard movement, gallery/overflow recovery, and compact Home at wide and compact sizes. For navigation, check reload and Back across Home, Goals/Activity detail panels, and Settings. A passing pure-layout test does not establish visual correctness.

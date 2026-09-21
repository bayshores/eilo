# Browser workspace

This is the production felis interface used by both the isolated development
fixture and the native Mac app. Start the fixture with `npm run dev`; the real
local service mounts the same files at `/home/`.

The browser uses native ES modules, CSS, and local fonts. There is one Home
composition: current focus, recorded activity, agent status, and the expandable
conversation. Goals and Activity open from Home in dismissible detail views.
Settings is the only separate destination.

| Directory                   | Responsibility                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `home/`                     | Unified Home projection, return briefing, health, analytics, and presentation preferences |
| `workspace/`                | Live composition, URL routing, Goals/Activity views, conversation, and record controls    |
| `chat/`                     | Conversation client, receipts, history, streaming updates, and slash commands             |
| `adaptive/`                 | Permission and retention controls for context collection                                  |
| `goals/`                    | Goal projections and validated editor values                                              |
| `calendar/`, `connections/` | Calendar and connected-source presentation and controls                                   |
| `activity/`                 | Check-ins, recorded activity, and Chrome/desktop setup                                    |
| `speech/`                   | User-started capture, transcription, and spoken replies                                   |
| `styles/`, `assets/`        | Shared styling and licensed local assets                                                  |

`asset-manifest.json` is the public-file allowlist for both servers. Add any
new browser module or stylesheet there and run `npm run check:repository`.
Tests, configuration, licenses, and development tools are never public routes.

## State and interaction contracts

The checked-in shell declares `data-source="sample"`; both servers stamp the served Home as `live` before delivery. Synthetic development
data still travels through the real state and HTTP contracts; the browser has no
parallel sample renderer.

Conversation drafts and unresolved sends belong to one native conversation.
Browser storage owns only appearance, sound, guidance, and display-name choices.
The first current launch migrates those choices from the retired widget-prototype
key and removes that old preference record. It does not import layout metadata.

DOM changes must preserve safe text rendering, visible keyboard focus, dialog
exits, reduced motion, compact-window reflow, and the active conversation draft.
Source collection, AI sharing, notifications, microphone use, and account
connection remain independent permissions.

## Verification

`npm run test:js` discovers colocated feature, extension, and desktop tests.
`npm run typecheck` checks the browser boundaries listed in `jsconfig.json`.
After Home changes, inspect the full `npm run dev` fixture at desktop and compact
window sizes, then check the native app startup and page transitions. Exercise
Home, goal creation through conversation, Goals, Activity, Settings, the
conversation dock, recording controls, and return-to-Home focus.

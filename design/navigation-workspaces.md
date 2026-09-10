# Home, Goals and Activity

Implemented September 9, 2026 after the user accepted the navigation proposal and asked for Mobbin references.

## Reference and direction

The inspected [Height project screen](https://mobbin.com/screens/fb1724c6-793f-43ca-8077-de6eb6a62f11) keeps its collection visible beside the selected item's details. That relationship is adapted for Goals using eïlo's selected IBM Plex, charcoal/peach palette, rounded surfaces and spacing. [Airtable's project/detail screen](https://mobbin.com/screens/adc1654e-88de-4d34-8004-cee263a224a2) provided another inspected example of persistent collection/detail context. Mobbin images were examined directly; no screenshot pixels or reference-app text are embedded in the product.

The rail now has Home, Goals and Activity, with text labels, an accurate active state and account/preferences/connections at the bottom. Today and Progress remain Home widgets and route their detail actions into Goals. Navigation changes the main workspace; it does not open another conversation or task-list popup. Hash destinations, direct reload and Back preserve the page identity. The approved floating rail and optional Home arrangement remain.

## Goals

The collection supports Active, Completed and All, title/deadline-wording search, arrow-key selection and an adjacent detail pane. All includes cancelled work with its actual status; deleted goals are available separately in Trash. Selection stays on the same eligible task as state updates; completing the selected item in Active moves selection to another eligible goal. Search/filter changes expose the result from the top. Browsing and selecting do not alter task state.

Details show only public task fields: title, status, optional focus, optional deadline wording and supported quantity. Explicit, current-revision activity associations can show the latest related session, labelled as tentative context. Talk about this goal focuses the shared composer and pre-fills a subject only when the draft is empty; existing draft text is preserved. The subsequent explicit management request adds an optional inline editor and lifecycle/Trash actions; see [task and Activity controls](task-and-activity-controls.md). Artificial priority, milestones, trends, source quotes and progress history remain unsupported.

## Activity

Observed displays approved-origin session records with sample-supported duration, local-format start time and optional current-revision goal associations. Check-ins displays delivered native check-ins newest first in their existing message order. The public schema has no timestamps for those check-ins, so none are manufactured. Reply returns to the same native conversation and preserves an existing draft. Connections uses the existing disclosure and explicit-consent flow.

The current public task schema omits provenance/change history. This Activity view therefore does not claim to be a complete audit trail of autonomous task changes. Reliable outcomes, a detailed task-change history and richer goal relationships remain separate backend work. New recent-session summaries are still not sent to the model without the pending data-flow decision.

## Conversation and window fit

Expanded history and incoming updates now occupy their own layout space above the composer. They no longer overlay the workspace. The history section is capped at 160px; a visible Close conversation control, Hide replies and Escape return that space. Page changes collapse history while retaining the draft. The goals list, detail body, Activity feed and transcript can scroll internally; the document stays within the window. Existing More widgets handles limited Home space. No new capture or collection is enabled.

## Evidence

- 65 frontend tests passed, including six new goal/activity data tests; three Python Home route tests passed with the new fixed assets and strict Host/Origin/client-header checks. The first route attempt lacked sandbox loopback permission; the authorized rerun passed.
- One test fixture originally claimed 42 observed seconds inside a 20-second interval. It was corrected, and an explicit regression now rejects impossible observed duration. Validated observations can remain visible without inventing a goal association.
- A separate in-memory browser fixture covered four open, one completed and one cancelled commitment, varied title lengths and optional quantities, no-result and empty states, filter/search/selection, automatic completion updates, Activity records/check-ins, and hash reload/Back.
- Browser checks at 1280×720 and 820×640 confirmed document bounds and zero overlap between the expanded conversation and workspace. The temporary viewport was reset. The real app was then checked at 1182×1044 after an idle restart, with its saved commitment and conversation retained and no console errors.
- No test message, microphone capture, new model inference, activity grant or real collection was used in this pass. The scratch server/tab was removed after QA. Source changes are local; this is not a new commit/public-release verification.

Visual refinement remains iterative. The implemented navigation and data boundaries are established; overall aesthetic approval and long-term utility are not inferred from tests.

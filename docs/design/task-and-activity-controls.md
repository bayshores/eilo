# Goal and Activity controls

Implemented and checked September 9, 2026.

Sean asked to delete activities and have more control over tasks. This adds optional direct corrections to the existing Goals and Activity views. Conversation and permitted activity remain the intended source of routine upkeep; this does not turn setup or progress forms into a required daily workflow.

## Goals

- The plus button beside search adds a goal. Selecting a goal keeps the collection visible beside its details.
- The options menu edits the name, timing wording and optional quantity/progress, sets or clears current focus, cancels an open goal, or moves a goal to Trash.
- The primary action completes an open goal, reopens completed/cancelled work, or restores a trashed goal.
- Trash is separate from Active, Completed and All. Deletion clears current focus while preserving the goal's ID, fields, prior status and progress. Restore recovers those fields without selecting focus automatically. Immediate Undo also restores the previous focus when the task revision still matches.
- Editing happens in the existing detail pane. A failed save keeps the entered draft. Stale state is rejected and offers Load current details; it is not silently overwritten or automatically resubmitted.

Deleting a goal changes the saved task projection. It does not erase native conversation history or promise that an earlier mention has been forgotten. Other edits to a deleted goal are rejected until it is restored. The human-turn instructions recognize explicit delete/restore operations and treat the latest task state as authoritative over old conversational acknowledgments. No model call was made to test new wording in this increment.

## Activity

Observed-session rows have an options menu with Move to Trash and, when an association exists, Remove goal link. The Activity Trash tab offers Restore; the immediate deletion notice also offers Undo.

Trashed records leave observed totals and normal history but retain their sampled duration for recovery. Trashing the active record closes it at its last actual sample. Restore leaves it closed and cannot stop a different active session. Removing a goal link suppresses automatic reassociation of that same record. These actions do not update task completion or rewrite native check-ins.

The existing journal bound applies to visible and trashed records together: at most 128 sessions, retained for seven days from their last sample. Trash does not extend retention, so it is not a permanent archive. Moving a record to Trash does not disable its activity connection; later permitted observations may create a new record. Connections remains the place to pause or turn off sharing. Permanent erasure of native conversation/check-in history is outside these controls.

## Transaction and interaction behavior

Task and record requests include the current conversation identity, a request ID and the relevant revision. Task controls use the task revision; Activity uses a separate manual-control revision so incoming samples alone do not invalidate a menu action. Duplicate requests do not repeat a committed change. A mismatched conversation, stale revision, invalid item, busy human turn or pending publication rejects the action before changing records.

Record actions first validate, preempt an obsolete event, then replan against the latest journal after cancellation settles. This preserves observations admitted during that wait. Durable replacement keeps task state and native messages separate; write failure cannot partially replace the ledger. Controls preserve an unsent conversation draft and do not send a model message.

Menus use the browser's popover top layer so a scrollable goal or Activity panel cannot clip its actions. Position is bounded to the viewport. Arrow keys, Home/End, Tab, outside click and Escape are supported; Escape returns focus to the trigger. The treatment uses the accepted IBM Plex, charcoal/peach and rounded surfaces. The collection, editor and conversation remain in their existing layout regions.

## Verification

- 93 Python tests passed, including task Trash/restore, activity retention and record controls, strict routes, stale/conversation checks, cancellation races, duplicate receipts and failed-write isolation. The seven record transaction tests were rerun after making their scratch path portable.
- All 73 frontend tests passed, including safe quantity correction order, Trash projection and direct-control draft/concurrency behavior.
- A disposable local browser fixture verified inline add/edit, target/progress corrections, cancellation and Undo, delete/Undo, completed-goal Trash across reload, restoration of prior status/progress, and Activity removal/restoration. No real user record was changed for those checks.
- At 860 by 600, the document stayed within the viewport. A menu-clipping defect found with the status notice present was corrected; the full menu then extended visibly past its panel boundary. Outside-click dismissal was checked in the browser. The temporary viewport and fixture were removed afterward.
- The running Electron app was quit through its native menu, its owned service stopped, and the app reopened with the updated source. Conversation, message and task fingerprints matched before/after. The new controls were visible in the native app; Escape dismissed the menu and returned focus to its button.
- No model inference, microphone capture, real activity collection, new grant or notification enablement was performed for these changes. Notification delivery and the full proactive coordinator remain separate work. This is a locally verified source update, not a new public release.

The earlier navigation checkpoint's lack of task forms is superseded by this explicitly requested optional editor. The broader navigation composition and automatic-upkeep direction remain current. See [navigation](navigation-workspaces.md) and [current project decisions](../product.md).

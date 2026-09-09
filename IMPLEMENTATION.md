# Implementation status

The agent workspace under `app/` and standalone widget prototype under `prototypes/widget-home/` are currently separate.

## Agent workspace

`app/tasks.py` validates revisioned operation batches, stable task IDs and optional focus before durable replacement. Native Hermes history remains the conversation authority.

The human driver obtains a native response and tentative operations. The server commits validated operations before publishing an acknowledgment. Recovery finishes a recorded publication without automatically repeating a prompt. Dynamic lane state is separate from cached session instructions.

The event lane validates quiet/question/check-in proposals. Observations cannot currently complete tasks or change priority, breaks or consent. Opening a page is not proof of completed work. Human input and state revisions suppress stale events.

The runtime, sign-in material, native conversations and operational receipts remain local and excluded from Git. No credentials or installed dependencies are distributed.

## Widget Home

The prototype implements collapsing floating navigation, direct corner resizing, hold-to-arrange, keyboard alternatives, a More widgets drawer and separate storage for layout and optional content. Its samples are not live user activity. Its README records verification and the physical long-press testing limitation.

## Verification

The existing offline backend suite passes 43 Python tests and three JavaScript scripts. The widget prototype passes 15 model/gesture tests. This covers transactions, lifecycle behavior, client logic, layout invariants and gesture timing; it does not establish general intervention efficacy or live activity recognition.

## Next integration milestone

Connect the Home composition to native conversation and task state, preserve immediate outgoing-message display and restart continuity, and support conversational correction across several commitments. Activity-based progress reconciliation is a separate feature requiring meaningful permitted evidence. Optional widget editing must not become required task upkeep.

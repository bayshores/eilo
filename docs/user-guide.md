# User guide

## Start a conversation

Open Home and type in the bottom composer. Enter sends and Shift+Enter inserts a
line break. A sent message may first show an acceptance receipt while its reply
is still being generated. If a saved reply needs recovery after an interruption,
use the recovery control instead of sending the message again.

Conversation is for stating or correcting commitments, recording progress,
asking for help, or taking a break. Mentions, questions, and brainstorming do
not automatically become commitments; unclear changes should ask for a
clarification. A current focus is optional, and working on another open goal is
valid.

## Goals and Activity

Goals offers search and status filters, plus optional direct editing. You can add
or edit a goal, set or clear focus, complete, cancel, reopen, or move a goal to
Trash. Trash is recoverable local goal state; it does not erase older native
conversation history.

Activity shows permitted observations separately from check-ins. An activity
record can be moved to Trash or disconnected from a goal. Removing a goal link
does not mark work complete. Retention is bounded, so Trash is a recovery
affordance rather than a permanent archive.

## Connections and permissions

Open **Connections → Browser activity**. When the Mac app detects the extension, choose **Connect Chrome**. You do not need to keep a connection page open with the native host. Visible text and adaptive help remain separate choices.

During development, an older installed extension/host may still show the one-step-at-a-time guide and compatibility connection page. That path keeps its page-open requirement. Optional website exclusions are available in the extension and Home’s **Home context → Sources → Excluded websites**. No mandatory site selection is needed.

Connections lists sources and their current state. Connecting a source only grants
the scope shown in that flow. It does not automatically:

- enable activity collection;
- share a new data category with the model;
- enable desktop notifications;
- give eïlo authority to act in another service.

Use the source-specific pause or turn-off control when you no longer want that
context available. A broken connection should remain visible as unavailable;
reconnecting it must be an explicit action.

## Speech

Choose click-to-toggle or hold-to-talk next to the composer. Recording starts
only after an explicit gesture and may require browser or macOS microphone
permission. Stop or release to transcribe locally; Cancel or Escape discards the
recording. Review the resulting editable draft before choosing Send.

## Layout

**Tracking** shows which sources are available and whether connected Calendar or
Gmail data can be used in answers. **Browser usage** shows seven days of recorded
browser time. Select a daily bar to inspect that day, or hover, focus, or click
a website segment for its recorded time. Activity shows website lanes with page
titles and details on selection. These views fill as Chrome records activity;
they do not measure total device screen time. Daily bars use UTC.

Both are in **Edit home → Add widgets**. They also appear automatically on a fresh
or untouched Home. Your custom arrangement is kept.

Home widgets can be rearranged with the supported hold gesture and resized from
their corner grips. Layout editing is optional. You can leave it through the
visible controls, Escape, or a background click; changing layout never changes
goals or conversation content.

## Adaptive Home — private development

Open **Home context**. **Arrange Home for me** controls whether Home adapts its layout; turning it off keeps your manual arrangement. In **Sources**, **Understand my work** separately lets the existing AI use your conversation and permitted activity.

**Pin** keeps a widget through work changes; **Undo** restores the preceding composition. Home waits while you type, select text or use a widget menu. Notes stay editable. A widget's **More** menu lets you say whether it is useful for this work; saved preferences can be inspected or reset in **Home context → Memory**.

In **Home context → Sources**, desktop capture, Chrome, visible text and AI help have separate controls. **Pause capture** stops new capture. **Home context → Memory → Forget activity & context** removes activity and what was learned from it; saved conversations and explicitly chosen notes/preferences stay separate. Activity presents compact work episodes with details on selection. Recorded usage is not proof of focus or task completion.

On a new private installation, **Connect ChatGPT** starts your own account sign-in. Enter its code on the official page opened by **Continue in browser**. The app does not import another Codex application's credentials.

# felis user guide

felis opens into one workspace. Home shows the current focus, the next Calendar
item when connected, retained activity analytics, source health, check-in state,
and the conversation. There is no Home arrangement mode or separate widget
gallery.

## Start and return

On first setup, describe what you want help with in ordinary language. felis
turns the conversation into a goal proposal. **Save goal & start** commits it;
you can keep refining the wording in chat before approval.

On the first eligible visit of a local day, or after a longer absence, felis can
show a short foreground return point and expand the conversation with a catch-up.
A draft, active reply, busy service, or active break suppresses it. The daily
briefing can be disabled in **Settings → General**.

## Goals

Choose **New goal**, type `/goal`, or simply tell felis what you want to do.
The conversation is the primary goal-entry surface. felis asks for missing timing
or progress details before saving them.

The current-focus panel opens the full Goals view. There you can search, edit,
complete, cancel, restore, or update progress. Goal changes use the current server
revision; a stale page cannot silently replace newer state.

## Conversation

The conversation stays on Home and expands without covering the status panels.
Use **Open** or the composer directly. **Replies** shows or hides recent messages;
History opens saved conversations. Drafts stay with their conversation.

Slash commands appear when a message begins with `/`. Use `/goal` for
goal-focused help and `/help` to see the current command list.

## Recorded activity and check-ins

The Activity panel shows only retained data from sources you explicitly enabled.
Use **1D**, **7D**, or **31D** to change the analytics window. When only seven days
are retained, 31D remains visibly unavailable instead of estimating missing data.
App or site rankings describe recorded time, not attention or task completion.

The recording control always states whether collection is active or paused.
Pausing does not remove the setup or make the source disappear; resume is
available in the same place. **View data as list** opens Activity records and
check-in controls.

felis may ask a neutral question when permitted context and a current goal make a
check-in eligible. It does not label a website as procrastination or claim that
opening a work page completed a goal.

## Settings and permissions

Settings has four current areas:

- **General**: motion, return briefing, spoken replies, microphone mode, interface
  sounds, and your local display name.
- **Permissions**: recording, desktop and Chrome sources, visible text, visual
  context, AI access, and excluded websites.
- **Memory**: local retention windows and the explicit activity/context deletion
  control.
- **Account**: the ChatGPT account used for conversations.

Calendar, Gmail, Chrome, desktop recording, visible text, visual context, AI
sharing, check-ins, microphone capture, and desktop alerts are separate choices.
Opening a setup view grants nothing. Each control reports its current state and
keeps its consequence visible.

## Recovery and privacy

If the local service disconnects, felis keeps the draft and last confirmed state
visible. Retry checks the existing request; recovery never resends an uncertain
message automatically.

Private conversations, credentials, activity, runtime files, and account state
stay in ignored local storage. Source code and synthetic fixtures do not contain
personal installation data. See [Security and privacy](security.md) for the exact
boundaries.

# User guide

## Connect ChatGPT

Open **Settings → Account → Connect ChatGPT**. A **Connect ChatGPT** shortcut also appears on Home while sign-in is needed. The sign-in panel shows your code; choose **Continue in browser** and enter it on OpenAI’s page. The panel closes when connected. **Finish sign-in** reopens an unfinished connection, and **Cancel sign-in** stops it.

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

Goals offers search, **Add goal**, and status filters including **Recently deleted**. **Edit goal**, **Set focus**, **Clear focus**, and **Mark complete** are visible in the selected goal; cancellation and trash are under **More actions**. You can add
or edit a goal, set or clear focus, complete, cancel, reopen, or move a goal to
Trash. Trash is recoverable local goal state; it does not erase older native
conversation history.

In **Activity → Overview**, the master control at the top explicitly says **Turn off check-ins** when enabled and **Turn on check-ins** when paused. Desktop alerts have a separate control; turning alerts off does not pause the check-in engine.

Activity shows permitted observations separately from check-ins. An activity
record can be moved to Trash or disconnected from a goal. Removing a goal link
does not mark work complete. Retention is bounded, so Trash is a recovery
affordance rather than a permanent archive.

## Connections and permissions

Open **Settings → Connections → Browser activity → Open Chrome setup**. The Mac app opens a dedicated connection guide in Chrome, which checks the existing extension before asking you to install or allow anything. If Chrome is running an older copy, the guide asks for one **Reload** in Chrome’s extensions. If access is already allowed, **Retry connection** checks the local connection without requesting permission again. Only a missing grant opens the extension’s **Allow Chrome** step.

The extension and guide distinguish **Chrome access is allowed** from **Chrome connected**. Connection is verified by the desktop app; opening a tab or granting permission alone does not complete it. Once connected, return to the eïlo desktop app and close the setup tab. **Connection help** returns to this guide, never to a browser copy of Home. Opening the guide does not change page-text, AI-sharing, or other source choices.

For local development, install the extension once using the in-app guide. If the toolbar popup is unavailable, Chrome’s **eïlo → Details → Extension options** opens the same setup. Newly installing the extension opens that page once; reloading or updating it does not repeatedly open tabs. **Privacy & help** contains installation and repair actions.

**Settings → Activity & AI** keeps desktop, Chrome, visible text and AI context separate. Desktop app identity does not need text access. Choosing visible text offers a short Accessibility setup card and checks permission when you return. **Not now** leaves setup for later. Website exclusions are optional; no site picker is required.

A connection grants only the scope shown. It does not authorize notifications, a new AI-sharing category, or actions in another service. Use the source’s pause or turn-off control to stop new capture. Setup status and actual received activity remain separate, so a broken or unverified connection never appears as working.

## Speech

Choose click-to-toggle or hold-to-talk in **Settings → General → Microphone mode**. The composer keeps a single Speak control. Recording starts
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

Both are available from **Home → Add widgets** when they are not already on Home. They also appear automatically on a fresh
or untouched Home. Your custom arrangement is kept.

Choose **Edit home → Tidy layout** to align cards while keeping their sizes, or **Settings → Widgets & layout → Restore starter layout**. Both offer Undo and keep saved contents. The upgrade makes a one-time backup of old layout metadata, removes identical source cards, and aligns the source widgets; later custom placement is kept.

Until you save a name, **Add your name** on Home or Settings opens **General → Your name**. The field starts empty; the old “You” placeholder is treated as missing. Names are saved locally in this browser or desktop app.

The floating sidebar opens from the left edge and waits 1.4 seconds after the pointer leaves before hiding. **Settings → General → Keep sidebar open** pins it.

Home widgets can be rearranged with the supported hold gesture and resized from
their corner grips. Layout editing is optional. You can leave it through the
visible controls, Escape, or a background click; changing layout never changes
goals or conversation content.

## Context and automatic widgets

Open **Settings** in the floating navigation. **Activity & AI → Understand my work** separately lets the existing AI use your conversation and permitted activity. Capture, AI sharing, and check-ins each keep their own controls.

**Settings → Widgets & layout → Add relevant widgets** lets eïlo add widgets as your work changes. Every added card uses the same **Edit home**, move, resize, and remove controls as your other widgets. Your existing widgets and placement choices stay. Each Home page shows complete cards above the composer. A compact arrow-and-dot control switches pages. The active page is highlighted, and the control disappears when everything fits on one page. Removing an automatic widget keeps it removed across refreshes; it can be restored from **Add widgets** while that content is available.

A context widget's options include **Keep on Home**, which retains it through work changes. **Undo last suggestions** in Settings → Widgets & layout returns to the previous set of suggestions. Home waits while you type, select text, or use widget controls. Notes stay editable; removing a card does not erase its saved content.

In **Settings → Activity & AI**, desktop capture, Chrome, visible text and AI help have separate controls. **Pause capture** stops new capture. **Settings → Memory → Forget activity & context** removes activity and what was learned from it; saved conversations and explicitly chosen notes/preferences stay separate. Activity presents compact work episodes with details on selection. Recorded usage is not proof of focus or task completion.

On a new private installation, **Connect ChatGPT** starts your own account sign-in. Enter its code on the official page opened by **Continue in browser**. The app does not import another Codex application's credentials.

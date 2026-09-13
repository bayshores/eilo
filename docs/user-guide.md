# User guide

## Your first workspace

A new workspace asks **What would you like help getting started on?** Describe one
goal or ask for help choosing. Connect ChatGPT when prompted; the draft stays
while you finish or cancel sign-in.

Review the proposed goal, then choose **Save goal & start**. This saves it and
asks eïlo for one small first step in the same conversation. No timer, widget
arrangement or optional source setup is required. **Skip setup** opens ordinary
Home. Existing goals and custom layouts stay intact.

**Connect optional support** guides each connection, AI-sharing, check-in and
alert choice separately. These remain available in **Permissions**.

## Returning to work

Home offers **Continue**, **Help me start**, and **Change plan**. Help me start
prepares an editable message; sending it asks for a small next step without
silently changing your goal. An existing draft is never replaced.

On the first visit of the day, the inline return point uses the chosen saved goal,
an explicitly linked return point when available, and a recently synced upcoming
Calendar event when available. **Not now** dismisses it for the day across chats.
**Turn off daily guidance** disables future return points. The preference is also
in Settings → General. It does not open over a conversation or move keyboard focus.
Returning after an interruption retains the draft and conversation view; reload
also restores the reading position. Missed days do not reschedule goals.

## Connect ChatGPT

Open **Settings → Account → Connect ChatGPT**. A **Connect ChatGPT** shortcut also appears on Home while sign-in is needed. The sign-in panel shows your code; choose **Continue in browser** and enter it on OpenAI’s page. The panel closes when connected. **Finish sign-in** reopens an unfinished connection, and **Cancel sign-in** stops it.

## Start a conversation

Choose **Talk** in the navigation and type in the composer. **Workspace** returns
to the page you were using. **History** opens saved chats and projects inside Talk;
it sits beside the conversation in wide windows and replaces it in compact ones.
Drafts and cursor positions are retained when switching chats. Enter sends and
Shift+Enter inserts a line break. A sent message may first show an acceptance receipt while its reply
is still being generated. If a saved reply needs recovery after an interruption,
use the recovery control instead of sending the message again.

Conversation is for stating or correcting commitments, recording progress,
asking for help, or taking a break. Mentions, questions, and brainstorming do
not automatically become commitments; unclear changes should ask for a
clarification. A current focus is optional, and working on another open goal is
valid.

## Chat context

**Context** stays beside the composer. Its details expand inline above the message field,
keeping the conversation interactive. Open it to see estimated space used and
remaining, the current window, and when automatic summarizing starts.
**Summarize** shortens older model context while keeping your saved chat
available. If a summary is interrupted, it is not retried automatically.

**Usage** shows token totals across requests, separate from context space.
**Commands** lists the available shortcuts. Type `/context`, `/usage`, or
`/help` to open those views; `/compress` opens the summary control for review.
`/new` starts another chat. Missing measurements show a dash until a usable
reading is available.

## Goals and Activity

Goals offers search, **Add goal**, and status filters including **Recently deleted**. **Edit goal**, **Set focus**, **Clear focus**, and **Mark complete** are visible in the selected goal; cancellation and trash are under **More actions**. You can add
or edit a goal, set or clear focus, complete, cancel, reopen, or move a goal to
Trash. Trash is recoverable local goal state; it does not erase older native
conversation history.

Activity has **Recorded activity** and **AI activity** tabs. Recorded activity
opens to the latest recorded local day, with a day selector for older records.
Expand a session for its source, recorded time and forgetting control. **Show
timeline and browser usage** opens optional visual detail. Session times are
local; the existing seven-day usage aggregates remain explicitly UTC.

AI activity contains conversation replies, delivered check-ins and recorded
check-in outcomes. **What informed this?** shows the input categories actually
supplied for a new reply, including unavailable source checks. Older replies may
have no source-use receipt; the UI says so. It does not infer what influenced an
individual sentence. **More** contains recoverable legacy observations. A compact
**Talk to eïlo** button opens the existing conversation and keeps its draft.

The **Check-ins** switch stays in the Activity header. Its accessible label says
whether it will turn check-ins on or off. The adjacent settings icon opens current
status, desktop alerts and optional help. Turning alerts off does not pause the
check-in engine. Opening these settings does not grant a permission.

Activity shows permitted observations separately from check-ins. An activity
record can be moved to Trash or disconnected from a goal. Removing a goal link
does not mark work complete. Retention is bounded, so Trash is a recovery
affordance rather than a permanent archive.

## Connections and permissions

Open **Permissions → Set up Chrome**. The Mac app opens a dedicated connection guide in Chrome, which checks the existing extension before asking you to install or allow anything. If Chrome is running an older copy, the guide asks for one **Reload** in Chrome’s extensions. If access is already allowed, **Retry connection** checks the local connection without requesting permission again. Only a missing grant opens the extension’s **Allow Chrome** step.

The extension and guide distinguish **Chrome access is allowed** from **Chrome connected**. Connection is verified by the desktop app; opening a tab or granting permission alone does not complete it. Once connected, return to the eïlo desktop app and close the setup tab. **Connection help** returns to this guide, never to a browser copy of Home. Opening the guide does not change page-text, AI-sharing, or other source choices.

For local development, install the extension once using the in-app guide. If the toolbar popup is unavailable, Chrome’s **eïlo → Details → Extension options** opens the same setup. Newly installing the extension opens that page once; reloading or updating it does not repeatedly open tabs. **Privacy & help** contains installation and repair actions.

**Permissions** keeps desktop, Chrome, visible text and AI context separate. Desktop app identity does not need text access. Choosing visible text offers a short Accessibility setup card and checks permission when you return. **Not now** leaves setup for later. Website exclusions are optional; no site picker is required.

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

Both are available from **Home → Add widgets** when they are not already on Home.
The ordinary starter layout includes them; a workspace approved during first
setup begins with only the chosen widgets. Your custom arrangement is kept.

Choose **Edit home → Tidy layout** to align cards while keeping their sizes, or **Settings → Widgets & layout → Restore starter layout**. Both offer Undo and keep saved contents. The upgrade makes a one-time backup of old layout metadata, removes identical source cards, and aligns the source widgets; later custom placement is kept.

**Settings → General → Interface sounds** controls short cues for sent messages and confirmed actions. New profiles start with sounds on; saved off choices stay off. **Interface sound volume**, **Play test sound**, and the header mute control make playback easy to check. Sounds stay silent during microphone recording and while the page is hidden. Desktop alerts remain separate.

**Settings → General → Appearance → Accent color** offers Peach, Rose, Lavender, Sky, and Mint presets, plus a custom color picker and RGB values (0–255). Changes apply immediately and are saved locally in this browser or desktop app. Choose Peach to restore the original accent. Dark choices are lightened for text and filled controls to keep them readable.

Until you save a name, **Add your name** on Home or Settings opens **General → Your name**. The field starts empty; the old “You” placeholder is treated as missing. Names are saved locally in this browser or desktop app.

The labeled floating sidebar starts pinned for new profiles. **Settings → General → Keep sidebar open** controls this choice. If unpinned, it opens from the left edge and waits before hiding.

Home widgets can be rearranged with the supported hold gesture and resized from
their corner grips. Layout editing is optional. You can leave it through the
visible controls, Escape, or a background click; changing layout never changes
goals or conversation content.

## Context and automatic widgets

Open **Settings** in the floating navigation. **Permissions → Let AI use recorded activity** separately lets the existing AI use your conversation and permitted activity. Capture, AI sharing, and check-ins each keep their own controls.

**Settings → Widgets & layout → Add relevant widgets** lets eïlo add widgets as your work changes. Every added card uses the same **Edit home**, move, resize, and remove controls as your other widgets. Your existing widgets and placement choices stay. Each Home page shows complete cards; the composer appears only in Talk. A compact arrow-and-dot control switches pages. The active page is highlighted, and the control disappears when everything fits on one page. Removing an automatic widget keeps it removed across refreshes; it can be restored from **Add widgets** while that content is available.

A context widget's options include **Keep on Home**, which retains it through work changes. **Undo last suggestions** in Settings → Widgets & layout returns to the previous set of suggestions. Home waits while you type, select text, or use widget controls. Notes stay editable; removing a card does not erase its saved content.

In **Permissions**, desktop capture, Chrome, visible text and AI help have separate controls. **Pause recording** stops new capture. **Settings → Memory → Forget activity & context** removes activity and what was learned from it; saved conversations and explicitly chosen notes/preferences stay separate. Activity presents compact work episodes with details on selection. Recorded usage is not proof of focus or task completion.

On a new private installation, **Connect ChatGPT** starts your own account sign-in. Enter its code on the official page opened by **Continue in browser**. The app does not import another Codex application's credentials.

The header shows actual recording health and a **Pause recording** control when
capture is enabled. A configured permission alone is not proof that activity is
arriving. Pausing recording does not erase existing records or change AI sharing.

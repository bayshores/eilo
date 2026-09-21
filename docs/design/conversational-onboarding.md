# Conversational onboarding and gradual workspace setup

September 12, 2026. Implemented locally and verified with isolated state. This
record owns the accepted scope and its validation limits; current code and
[product boundaries](../product.md) remain authoritative.

## Accepted direction

- Start with “What are you trying to accomplish?” and the existing conversation.
- Show a small workspace proposal beside that conversation. The person can refine
  it in chat; explicit approval turns the proposal into Home.
- First setup ends with a goal and an approved workspace. Optional connections
  can follow when they would help.
- Tailor existing widgets first. Generated code, arbitrary new tools, inferred
  schedules, and automatic external actions are outside this implementation.
- Guide relevant permissions with their benefit and data scope visible.
- Offer quiet interface sounds as an optional preference, off by default.

The original isolated review found three Home pages and empty source/status
widgets before any goal existed. First setup now defers that ordinary Home
structure until the person has approved a useful starting arrangement. Existing
profiles keep their current experience.

## Implemented experience

1. **Invite a goal.** One question, a composer, optional varied starters, and an
   “I’m not sure yet” path. Navigation and Skip setup remain available.
2. **Use the configured AI.** Account readiness comes from the existing service.
   Connect ChatGPT opens the normal account panel. A draft remains in the
   existing conversation outbox through sign-in cancellation or a page reload;
   the client never sends it automatically when sign-in completes.
3. **Clarify or propose.** The ordinary human driver receives the current draft
   and a narrow setup policy. Quantitative goals can receive Goals and Progress;
   a qualitative goal can start with Goals alone. Notes, Today, and Clock are
   available when useful. There are at most three widgets including Goals.
   Preserve the person’s deadline wording and explicit progress; do not infer a
   schedule or mark work complete from observation.
4. **Review beside chat.** The same composer and native transcript sit beside
   the proposal. Refinements update the existing draft. Nothing enters the real
   goal list until Use this workspace succeeds.
5. **Continue on Home.** Approval commits the goals and setup record, then applies
   the selected layout once. The conversation continues in the normal composer.
   Existing movement, resizing, removal and widget paging remain available.
   The person can ask about features in the same conversation; explanatory
   panels are not inserted into Home.
6. **Offer support.** A small invitation below the conversation opens one
   relevant source guide, or a source choice when no recommendation exists.
   Source access, AI sharing, check-ins and desktop alerts are distinct steps.
   Back preserves the workspace; Not now/Later dismisses the invitation durably.
   Full controls remain in Settings afterward.

The AI chooses from supported presentation options; it does not gain a general
app-control tool or permission to grant access. Opening any guide is read-only.

## UI refinement after review

Sean's September 12 feedback tightened the implementation: keep the original orb
above the empty conversation question, remove generated chat badges and the
uppercase conversation strip, and use a quiet icon for Back. The populated
conversation and input do not receive decorative orb placements. First setup uses
short starters and the question itself, without explanatory subtitles.

Home and Chats now share the same outer gutter and title baseline, matching
Goals and Activity. The follow-up QC pass removed the large check-in setup card,
including the enabled-without-a-conversation state from Sean's screenshot. The
Activity header now holds one stable Check-ins switch, its settings icon and
Sources. An empty content area has only “No recorded activity” and Connect Chrome.
Status details, alert controls and permission explanation live in the native
settings dialog; opening it grants nothing. Toggle failure restores the confirmed
value, exposes the error and returns keyboard focus when dismissed.

Check-ins and recorded-history filters appear only with records; Assistant log
and Recently deleted move into More when populated. Accounts with legacy records
but no usage graph open to those records instead of an empty Overview. Usage,
episode selection and recovery remain available. Routine log subtitles and the
duplicate source link in the day map were removed; offline and failure details
remain visible.

Home no longer repeats a healthy-state subtitle or a check-in status shortcut.
Navigation keeps an empty subtitle hidden on return to Home, preventing a transient
7px layout shift. Compact navigation closes after selection unless pinned. Goals
defers empty filters and gives its compact index only the height it needs. Restoring
a goal returns to its actual state and preserves recorded progress; saving an edit
restores focus. Status banners are dismissed when leaving the page.

The onboarding proposal uses the existing card colors and avoids repeating a
single goal's title in Progress. Notes and Clock previews show their content rather
than generic instructional copy. Home Progress emphasizes the tracked goal's
completed count, falling back to completed commitments only without a tracked goal.
Settings does not repeat the name prompt or its field explanation. The shared
composer keeps offline feedback and retry controls in one recovery row.

## Ownership and reliability

| Concern                      | Owner and behavior                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup state                  | `app/onboarding.py` validates a revisioned private draft, status, allowed widgets, optional support recommendation, approval receipt and support dismissal.                                                   |
| Conversation and persistence | `app/chat_service.py` stages validated human-driver operations in the draft and uses the existing durable publication journal. Native history remains the transcript.                                         |
| Model boundary               | `app/human_driver.py` supplies draft-only instructions during setup. A bounded workspace operation may select existing widgets and recommend a source; permission operations are rejected.                    |
| Explicit commands            | `POST /api/onboarding/commands` accepts only the supported action, request ID and expected setup revision. Ordinary loopback, origin and body checks apply.                                                   |
| Approval                     | One durable metadata replacement commits setup and goals before acknowledgment. Failed writes leave memory unchanged; an identical retry is idempotent. Busy or unresolved publication state blocks approval. |
| First-run detection          | Only newly created workspace metadata gets setup state. Existing profiles lacking that record stay unchanged; an empty goal list never triggers onboarding.                                                   |
| Browser arrangement          | `web/home/layout.js` validates the chosen catalog widgets. Geometry and the acceptance marker share one browser storage write, so reloads and repeated receipts preserve later manual edits.                  |
| UI and support               | `web/onboarding/` arranges the existing conversation and reuses current connection controls. Polls do not remount the composer or embedded permission guide.                                                  |
| Sounds                       | `web/onboarding/sound.js` synthesizes short effects with the native Web Audio API and no added dependency or media asset.                                                                                     |

The client keeps an uncertain approval’s request ID for a safe retry. Interrupted
inference uses the existing recovery controls and is never replayed automatically.
Choosing ordinary goal controls during setup is an explicit alternative and
records setup as skipped. Setup completion and support completion are separate.

Composer drafts retain the existing session-storage lifetime; this feature does
not introduce another copy of conversation text. Browser layout storage failure
does not undo a durably approved goal, and presentation remains convenience state.

## Permission sequence

| Step            | Decision and confirmation                                                                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome context  | Reuse the existing Chrome guide. Require an online service, a verified connection, setup and host grant, and an enabled browser collection policy before continuing.                                      |
| Desktop context | Reuse the desktop guide. App identity is distinct from text access; text permission is not required for the app-identity path. Confirm helper readiness and collection policy.                            |
| Calendar        | Reuse Calendar authorization and selection. Connection requires selected calendars. Sharing selected events with AI is a separate existing control.                                                       |
| AI context      | Explicitly explain that the connected AI can receive the conversation and permitted context. Preserve the full current policy while changing only the requested field. Verify the returned sharing state. |
| Check-ins       | Use the dedicated check-in command and verify enabled state. Calendar alone does not provide activity check-ins; offer activity setup or finish.                                                          |
| Desktop alerts  | Use the existing native alert control and read its state back. Report felis’s saved alert preference separately from macOS delivery settings. Browser previews cannot grant native notifications.         |

A source revoked during setup returns to its connection step. Sharing revoked
during later steps returns to sharing. A delayed response cannot move the dialog
after Back, dismissal or closure. No step infers a grant from an opened dialog,
installed transport, or click alone.

The existing native alert API exposes support, felis’s enabled preference and
delivery error state. It does not attest the current macOS authorization setting.
The copy therefore does not claim that an OS grant or actual notification delivery
has been verified.

## Sound behavior

Sound starts off and is available in first setup and **Settings → General →
Interface sounds**. A user gesture must unlock playback; confirmed workspace and
support outcomes may then play a quiet short cue. Sound is suppressed while
recording or the page is hidden. There is no typing, hover or ambient audio, and
all information remains available visually. Turning effects off stops active
voices. App effects do not alter notification preferences or system volume.

The earlier concept compared felt-pluck and soft-glass timbres. Production uses
one restrained synthesized treatment. Perceived volume and timbre across physical
speakers still require listening; automated audio lifecycle tests are not evidence
of acoustic quality.

## Inspected design references

The following Mobbin screens were inspected during the September 11 design
review. They inform the interaction; their capture does not verify current product
runtime, animation, sound, or onboarding effectiveness.

| Reference                                                                                       | Pattern used                                                                                    |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [Mindvalley goal conversation](https://mobbin.com/screens/a29e2d2b-6098-4f4a-8d6a-f8e6a7097d29) | A personal goal question, optional starters and room for uncertainty.                           |
| [Asana workspace preview](https://mobbin.com/screens/deeeab75-a04c-47c8-aa26-7a15fd59c45a)      | Show the consequence of setup beside the choice.                                                |
| [Cofounder editable result](https://mobbin.com/screens/565229d4-c4ad-4b6e-adf5-8e628a509246)    | Keep the proposed result beside conversation with a clear acceptance point.                     |
| [Endel onboarding](https://mobbin.com/flows/33fa4e4a-2412-4396-94ae-99380009a403)               | One benefit and immediate permission action, with an exit. Its full sequence is not reproduced. |

The September 12 QC pass also inspected [Linear's empty Inbox](https://mobbin.com/screens/5e4be052-1838-45d0-b850-fd7306cd4bff)
and [Notion's task-source setup](https://mobbin.com/screens/9cb6b951-3dc3-49f3-a82d-1e7fd7951d72).
The applicable pattern is one small content state with configuration kept in the
header, using felis's own controls and typography.

[Apple’s onboarding guidance](https://developer.apple.com/design/human-interface-guidelines/onboarding)
and [progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
support contextual learning and deferring secondary choices.
[Apple’s audio guidance](https://developer.apple.com/design/human-interface-guidelines/playing-audio)
informed the sound constraints. The exact felis experience still needs observation
with new users.

## Verification and limits

Focused tests cover draft isolation, revisions, duplicate approval, failure
before durable publication, legacy profiles, refinements, permission rejection,
outbox preservation, layout application once, source readiness and sound lifecycle.
The final repository gate is `npm run check`.

Browser inspection uses `scripts/preview-context.py --onboarding` with synthetic
replies and temporary state. It covers initial entry, conversational refinement,
reload before and after approval, wide and compact layouts, the same conversation,
optional support, truthful unavailable-source states and remembered dismissal.
The chat refinements and Activity were also inspected at wide and compact widths;
a populated Activity fixture verified that usage and session details remain accessible.
The sample-data banner remains visible. Follow-up QC inspected 420×840,
1280×720 and 1440×1000 rendered views. Home and Chats measured the same title
origin at 1440px (28px, 56px); compact pages use a 24px side gutter. Tests covered
check-ins off/on, the no-conversation case, deliberately rejected toggles, an
interrupted fixture connection, legacy-only records, populated usage, goal
editing and Trash restoration, and onboarding approval followed by deferring
support. The repository gate passed 292 JavaScript and 304 Python tests, formatting,
lint, type checking, asset boundaries and documentation links. This is an observed
implementation pass, not a claim of user acceptance or new-user usability research.

Real provider inference, fresh-account sign-in, Chrome host grants, native
capture, physical microphone behavior and OS notification delivery require
separate authorized integration checks. No personal profile or real permission
was changed for this implementation. The earlier inline concept is a design
artifact; the isolated app preview exercises the implemented flow.

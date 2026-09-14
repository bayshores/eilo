# Activity and app setup simplification

The calm Activity pass below is implemented. The broader Apps redesign remains a proposal; the Chrome setup correction below is implemented.

The foreground should stay quiet, Activity should remain readable, and source setup should be direct. Keep IBM Plex Sans, charcoal/peach, the configurable Home, and distinct Home/Goals/Activity purposes while reviewing the composition.

## Implemented Activity quieting pass

The default Recorded activity view now opens as a scanable list: a compact total,
one visible source/time line per record, and older/newer day controls instead of a
date menu. It no longer places a browser-usage disclosure, an explanation
disclosure, a More menu, or a chevron on every record ahead of the list.

Selecting one record opens the only detail surface: alongside the list at wide
widths and below it on compact widths. That surface owns source facts, goal-link
correction, Trash/Restore, and Forget. The destructive confirmation says that
forgetting does not pause recording or mark a goal complete. Escape returns to
the selected row. Recently deleted activity appears as a quiet direct link only
when recovery is available. The Check-ins switch remains independent in the
header, next to a direct Manage activity route.

Browser-usage visualization remains available through Home's Browser usage
widget. This Activity change neither grants collection/sharing permission nor
changes retention, recovery, revision, or durable-write behavior.

## Latest correction: one browser permission and quiet pointer focus

Do not require site selection or a fixed supported-site list. Pointer activation must not leave persistent keyboard-focus outlines. These corrections supersede the earlier three-site installation flow below.

The extension offers **Allow Chrome** with one optional HTTP/HTTPS permission request. No site picker appears. Optional hostname exclusions and access removal are in **Privacy & controls**. The connection UI presents current readiness, the visible AI-sharing consequence, and the appropriate action; detailed data/retention explanation is collapsed. The guide has progressive steps.

The backend sanitizer, ledger, model-input validation, and frontend activity/goal selectors now accept general canonical browser origins. Retaining the old wire event name preserves saved records, while legacy per-site grants cannot pass the new permission handshake. Learning remains based on context and conversation, without fixed productivity labels or visit-based completion claims. The reviewed implementation follows [Chrome optional-permission guidance](https://developer.chrome.com/docs/extensions/reference/api/permissions) and [match-pattern scope](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns).

Pointer activation keeps actual focus/carets but suppresses the bright outline; keyboard navigation restores it. Parent checkbox/toggle focus rings receive the same treatment. Deliberately selected tabs and Home arrangement states remain intact.

No broad browser permission or real activity/model sharing is implied by implementation. Manifest/code changes require the extension to be refreshed before a live verification. Browser automation does not establish that refresh or a real permission grant.

Verification for the final correction covered new-site ledger/model/display acceptance, optional-grant readiness, denied/old grants, exclusions, mid-sample revocation, private windows, nonce replay, and popup gesture boundaries. Isolated UI inspection covered compact layouts, one primary permission action, and pointer → keyboard → pointer focus behavior. Fixtures cannot grant permissions, write source state, or call a model. Generic-origin display handling was also checked for HTTP/local/IP sites and malformed origins.

The native View → Reload action produced a blank window during final verification while the same live page worked in the browser. A clean quit/reopen restored Home with the final code; the service returned ready and saved-content hashes still matched. The cause of the native reload behavior was not diagnosed in this UX change.

## Earlier Chrome setup follow-up

**Earlier implementation, superseded by the correction above:** the setup guide is embedded directly in Connections → Browser activity and Activity's Set up Chrome action. It presents progressive steps with Back/Next and a fixed native Open in Chrome handoff. The standalone page uses the same component. Do not restore all-at-once instructions.

Frontend instructions use a short current step, progressive setup, and optional detail only when needed. Required permission implications remain visible at their choice. The durable rule is in [product direction](../product.md#frontend-instructions).

Verification for the integrated guide and instruction pass covered progressive navigation, optional details, compact layout, Activity entry, shorter explanatory copy, and the fixed Chrome handoff/preload with stubbed OS calls. An actual extension connection and sharing session remain unverified. Fixture checks do not enable permissions or collection.

The old page treated the absence of `chrome.runtime.connect` as proof that it was outside Chrome. That is not a valid browser test: Chrome can omit the external-extension interface when no connectable extension is installed. See the [Chromium announcement](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/tCWVZRq77cg/m/sCE44V29AgAJ) and [official external messaging documentation](https://developer.chrome.com/docs/extensions/develop/concepts/messaging).

The connection page now reports “The Chrome extension is not detected” with Set up Chrome extension and Reload page as usable actions. Unavailable Pause/Turn off controls stay hidden. Offline state waits for server confirmation rather than displaying a cached sharing claim; active sharing owned by another tab is labeled accurately. The setup guide explains installation, same-profile enablement, and reloading after installation. The session and Home help text use the same extension-aware wording.

The native helper's `--check` returns readiness without sampling foreground activity. Focused extension/bridge checks and the repository gate cover the setup/reload actions and compact layout. They do not establish a live extension connection or permission grant.

The earlier site-grant instruction is superseded by the one-permission flow above. A real connection must be verified after extension setup; helper and regression checks do not establish browser observations or model check-ins.

## Design context

- Before this pass, Activity's foreground combined a date menu, More menu, timeline disclosure, explanatory disclosure, and expandable rows with setup, policy explanation, and diagnostics. The implemented Recorded view now keeps the list first and confines secondary actions to its one selected-record surface.
- Connections has three first-party source rows but emphasizes Add MCP, plus All/Apps/MCPs and search. The same switch treatment represents different source operations.
- Calendar collection/sync and selected-event answer-sharing are independent; the source row must communicate that distinction.
- Browser setup has substantive friction beyond layout. Native bridge registration removes a universal open-page requirement, while capture still needs a connected extension and host grant.

Source ownership: [Activity views](../../web/workspace/views.js), [check-in center](../../web/activity/checkins.js), [Connections manager](../../web/connections/manager.js), [browser setup](../../web/activity/setup.html), [activity session](../../web/activity/session.js). See [product boundaries](../product.md) and [existing connection semantics](connections-and-chats.md).

## Mobbin references inspected

These are recorded interaction patterns, not proof of usability or permission to copy assets. The search results' actual preview images were inspected through the Mobbin connector.

| Reference                                                                                          | Visible pattern                                                                                                   | Proposed application                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Todoist activity](https://mobbin.com/screens/31d64829-eb1a-47de-be29-ab8612f8e8b0)                | Date groups, concise event rows, right-aligned times.                                                             | Make Activity a readable chronology rather than a control center.                                                                                                                                 |
| [Linear inbox](https://mobbin.com/screens/8337813e-f0dd-4415-8a29-87c114b0442b)                    | Compact list retains its position while selected details appear beside it.                                        | Put full evidence, explanation, and correction actions behind record selection. The proposal uses a contained detail surface; final side-panel versus overlay treatment is still a review choice. |
| [Claude Google Calendar connection](https://mobbin.com/flows/97688333-b64c-4242-8a8b-852e3e50ce33) | Connector entry near the composer, one-service detail, then visible success in the original conversation context. | Connect near the point of use, explain the source, and return with an explicit result and preserved draft.                                                                                        |
| [Midday connected apps](https://mobbin.com/flows/df7cd658-5fab-433d-8fb7-1cb0d0f56414)             | A small app picker opens directly from the assistant area.                                                        | Give the composer an Apps entry into the same manager used elsewhere. Adapt the compact picker; do not reproduce its full catalog.                                                                |

Perplexity's connection catalog, Basecamp activity, Stripe events, and ClickUp planner were also previewed. Their denser catalogs, diagnostic data, or calendar organization are less suitable as eïlo's default foreground.

## Proposed experience

### Activity

The implemented Recorded view above is the current baseline. The remaining ideas in this section are future review material, not claims about the present UI.

The main job is to answer what eïlo observed and when it checked in. Use one chronological feed with an optional All activity / Check-ins / Observed filter. Keep those record types labeled and distinguishable; a unified view must not conflate observation with a delivered message or progress.

- Header: Activity, one short description, Activity settings, and More.
- State: one quiet line with the relevant collection status and a direct Manage route. Paused, off, disconnected, waiting, and error must remain accurate backend states. An actionable failure earns a specific recovery action.
- Feed: date groups and compact rows containing source/event title, one supporting line, and timestamp. No metric cards or blanket policy explanation.
- Selection: inspect evidence and meaning; observed records retain Remove goal link and Move to Trash. Delivered check-ins link to their conversation. Routine observations cannot claim completion or attention.
- Settings: check-in permission, desktop delivery, and explanatory timing/limits. These are independent choices, not one master toggle.
- More: Agent log and Trash. Quiet decisions/interrupted checks remain auditable. Existing retention, restore, Undo, stale-write, and revision behavior must survive implementation.
- First visit: one explanation and Set up browser activity. Do not render empty timestamp panels or a full operating manual.

### Apps

Start with recognizable services and a benefit/status, not a developer catalog. For a three-service list, search and type filters do not currently earn their space. Reveal them if the real supported catalog grows.

The same Apps entry should be reachable from the composer and existing navigation. Select one service, explain what it reads and how the agent may use it, complete provider authorization where needed, choose resources, and show the resulting state before returning to the original context.

Use explicit status wording: Not connected, Finish setup, On this device / Chat access off, Available in answers, Paused, or Reconnect. Derive these from actual source state. Merely saving an endpoint, receiving OAuth credentials, or syncing Calendar is not proof the agent can use that source.

Calendar collection/sync and sharing selected event information with the model remain independently chosen. Never enable answer-sharing implicitly to reduce clicks. A successful save should name the selected scope and whether answer-sharing is on. Put disconnect, sync troubleshooting, and technical metadata in secondary controls rather than beside the main setup action.

Move MCP configuration into Advanced, with the current limit visible: saved and tested MCP servers are not yet usable in conversations. Do not imply a working general agent connector.

Browser activity gets one guided handoff with readiness feedback for the extension and optional host access. Native bridge registration supports capture without an open page; the local page bridge remains available for its legacy lease workflow.

## Reviewable proposal and verification boundary

A clickable, sample-only proposal covers the feed and first-visit alternative, record details, observation Trash/restore and unlink, secondary settings/log, an app picker, Calendar setup and its separate chat-sharing choice, and browser-setup handoff.

The preview contains no account/API calls. Google approval is explicitly simulated and all records/accounts are examples. Its fragment was read back and its JavaScript passed syntax checking. No live product code was replaced, real OAuth was attempted, or product usability pass was claimed.

Before implementing, validate whether people can identify an observation versus a check-in, locate a source's actual chat availability, complete sample setup, and return to a draft. Then validate the integrated implementation at desktop and compact sizes, with keyboard/focus, Escape, source errors, retained drafts, and preserved permission semantics. Measure observed use and taste feedback separately from automated checks.

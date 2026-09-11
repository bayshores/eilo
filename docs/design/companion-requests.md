# Source-backed requests in eïlo

Status: local development; not released. The read-only tool layer and visual execution flow are implemented; live source authorization and source-backed briefs require separate verification.

## Outcome

An ordinary request such as “Catch up on my emails, find commitments missing from my calendar, and give me a daily brief” should start a useful investigation. The user should not copy their inbox into chat, create each task, or maintain a parallel tracker.

The brief should explain what needs attention, what changed, what is already covered, and any source that could not be checked. It may recommend priorities when asked, with reasons grounded in commitments and deadlines. It should not turn those priorities into unsolicited preparation instructions, solutions, or work blocks.

## Expected behavior

1. Resolve which accounts and sources the user means from their connected accounts and saved preferences. “All my email” includes every enabled inbox, not just the first account. State the actual date window; use the previous successful catch-up where available and a bounded first-run lookback.
2. Search recent and actionable mail, then read the relevant messages and thread context. A later cancellation or reschedule supersedes an earlier confirmation. Newsletters and unanswered invitations are not automatically commitments.
3. Compare confirmed appointments and deadlines with the selected calendars. Distinguish missing events, changed events, already-covered items, and questions that need clarification. Missing information is not a license to invent a time.
4. Return a short brief in the existing inline conversation, with traceable source links and compact account/coverage status. Show the useful result first and details on demand. Avoid a new full-screen chat workflow or a setup form on every request.
5. Maintain the internal source records and deduplication automatically. A request to discover omissions is read-only; a request to make specific changes should use the app's authorized write capability when one exists. Do not infer sends, event edits, deletions, or recurring monitoring from this example.

## Implemented September 10

The human lane now exposes exactly four eïlo read tools: source availability, inbox search, bounded thread reading, and selected-calendar reading. Hermes Tool Search is explicitly off so those four schemas are exposed directly. Generic shell, filesystem, browser/action tools and fallback providers remain disabled. Ordinary task bookkeeping still uses the existing validated task transaction; a turn using external source tools cannot apply task changes in this first slice.

Gmail uses eïlo's dedicated Desktop OAuth client, separate PKCE/state/loopback flows and a per-account macOS Keychain item. Up to ten account records are supported. Each new/reconnected inbox requires explicit source-to-model consent and Google's own grant. Inbox removal deletes local credentials only; it does not revoke the Google project grant or disconnect Calendar. Google Calendar's explicit Disconnect can invalidate Gmail for the same account and marks it for reconnection. No external connector credentials are imported.

Calendar use in answers is a separate, initially disabled option tied to the connected account. Local Calendar display remains available without this option. Source controls invalidate an in-flight read turn, and checks before retrieval/publication prevent an expired capability being reused. Interrupted source turns do not auto-resume or publish on restart.

The local service owns retrieval, source references and real progress receipts. A random per-turn bearer capability connects the child agent to an expiring loopback read endpoint; renderer requests are rejected there. Source excerpts exist only in turn memory and Hermes's ephemeral request context. The native tool transcript stores status/source-ID receipts, not raw bodies. The agent's API-body debug dump is suppressed (including errors), and trajectories are off. Final user-visible answers are retained normally and may contain information from the sources. Data already transmitted cannot be recalled when a user disables sharing.

First-slice bounds: default mail lookback 30 days, explicit windows 1–90 days, up to 30 search IDs per search, at most 18 thread reads and 26 tool requests in a turn, approximately 65k source-context characters, and 180 seconds of agent work. Thread reads retain recent replies and flag truncation; attachments are not read. Calendar retrieval covers selected calendars in a fixed UTC 30-day window. A full-mailbox sweep, incremental catch-up cursor, deterministic commitment deduplication, wider Calendar windows, and background mail wakeups remain follow-ups. The model must disclose partial coverage rather than claim the whole inbox was checked.

## Visual execution flow

The accepted Home composition, IBM Plex Sans and charcoal/peach palette remain. A compact status strip above the inline composer shows real source checks. Details expose source access, each inbox search, relevant-thread reading, Calendar checking, and answer assembly when reply streaming starts. Steps transition only from actual operations; there is no timer-based progress or fabricated percentage. Failures/limits are visible; zero usable sources offers Connect a source. Stop cancels the current process; Details/Escape and Dismiss keep Home usable. Source links use server-owned IDs and narrow Google destinations, including native Electron validation.

These are eïlo's investigation steps, not proof that commitments have been completed.

## Verification boundary

- Focused Python, Electron, and frontend tests cover source availability, bounded retrieval, source links, focus/expansion preservation, Escape/dismissal, and compact detail scrolling with isolated state and fictional source data.
- Verification must confirm source-specific authorization, coverage, cancellation/reschedule interpretation, source links, and revocation behavior before relying on a source-backed brief. An on-demand daily brief does not create a recurring job.

## Acceptance checks

- A newly connected inbox and selected calendars support the example request without copying data into chat or filling out task forms.
- The result identifies an omitted commitment and an already-covered one, with supporting source links. Repeating the request does not duplicate either.
- A cancellation or reschedule changes the result correctly. An ambiguous invitation stays tentative.
- A second connected inbox is included; a failed third inbox is explicitly marked unchecked. The brief remains useful with partial coverage.
- Denied source-to-model sharing produces an honest coverage limit; no hidden context is sent. Revocation and disconnect stop reads and invalidate obsolete candidates.
- An explicitly requested priority summary remains useful without prescribing how the user performs the work.

## Provider constraints to carry into the build

Full Gmail search and body access require `gmail.readonly`; `gmail.metadata` cannot supply the same behavior and is also a restricted scope. Desktop accounts need explicit authorization, and Google's installed-app flow does not support incremental authorization. Testing-mode grants are temporary; a public Gmail product also needs the applicable restricted-scope verification, Limited Use disclosures and security review for cloud processing. These are release considerations, not evidence that the capability is already present.

Primary references: [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [message search](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list), [desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [Workspace data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy), [restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

# Security and privacy

eïlo is designed as a local application with explicit data-flow boundaries.
These are implementation requirements, not just user-interface wording.

## Local service and transport

The Python service binds to loopback. HTTP accepts a narrow set of known routes,
fixed assets, expected methods, strict request bodies, same-origin requests, and
the app client header. It does not expose a generic RPC surface, filesystem API,
native command runner, model switcher, or credential endpoint.

Validate at the route and domain boundary. Reject unknown fields, stale revisions,
unexpected conversation identifiers, invalid request IDs, and malformed content
before durable mutation. Return stable user-safe errors rather than raw runtime
diagnostics.

## Durable state

Private state belongs under ignored local directories. `write_private` writes a
new restricted file, syncs it, atomically replaces the target, then syncs the
parent directory. Update in-memory state only after that call succeeds. This
prevents a partial write from becoming an apparent completed task or reply.

Request IDs make retries safe. Revision checks stop a stale browser view from
overwriting newer state. Publication follows a successful durable commit; a
saved recovery receipt can finish interrupted publication without replaying a
model turn or duplicating a user message.

## Runtime and provider boundary

The model-backed path uses a separately provisioned Hermes runtime. The runtime
contract checks the configured model/provider/tool boundary and audits exported
native records before their messages become public eïlo state. Do not add
fallback providers, unreviewed tools, credential imports, direct model clients,
or automatic login behavior as a convenience workaround.

Runtime credentials, private state, local models, and account data must never be
committed, copied into documentation, or returned from an endpoint.

## Consent-gated context

Activity, Calendar, mailbox sources, microphone capture, desktop notifications,
and model-data sharing are independent capabilities. Each needs its own explicit
user action and visible state. A permission to inspect or connect a source does
not imply permission to collect continuously, send its details to a model, or
perform external actions.

Activity integrations minimize what they admit. Unapproved context is not a
signal about behavior; approved browser information is normalized before it can
reach persistence or model input. Do not add broad tab, history, page-content,
clipboard, screenshot, keystroke, accessibility, or background-monitoring access
without a reviewed product decision and an explicit permission flow.

## Browser and desktop context

The extension has local storage, Native Messaging and scripting capability; broad HTTP/HTTPS host access remains one explicit optional Chrome grant. There is no mandatory site picker. Updating the extension does not grant host permission, enable visible text or enable AI context.

Native transport reaches a private authenticated local socket, with an exact fixed extension-origin allowlist. The Chrome sampler accepts only a focused normal window with explicitly non-private tab/window state. It rechecks tab identity, host permission, local exclusions, service exclusions and policy revision after extraction. Unknown/private windows, browser-internal/file URLs, credential-bearing URLs and local/private network origins are withheld. Exclusions cover subdomains. Permission/exclusion changes invalidate queued observations.

Desktop collection is separately off by default. The Swift helper handles app activation, bounded Accessibility reads, idle/lock/sleep and explicit pause. Native browser AX/image content is withheld, including registered HTTP browser handlers, so it cannot bypass Chrome's privacy state. Protected fields are excluded. Visual context has its own control and is unavailable while the multimodal gate fails. Images are transient and never stored in SQLite. No clipboard, keylogging, audio capture or app automation is added by this collector.

Every admitted event is tied to source, capture time, session and policy revision. The backend validates again before persistence and model input. Detailed activity is retained for 24 hours, work summaries for 30 days, and explicitly chosen notes/preferences independently. Content uses Fernet with a macOS Keychain-backed key; the full-text index is in memory. Explicit forgetting follows derivation links through summaries, learned preferences and compositions. Saved conversations use their separate existing deletion flow.

The compatibility page bridge retains its nonce/lease/renewal and pause/closure behavior.
Its legacy check-in path remains separate from the new isolated context-analysis path.
New context observations do not enter native conversation history. Check-ins, source
sharing, contextual inference and desktop notifications have separate controls.

Automatic return briefings use a distinct detached lane. A Home request is not a
native user message, cannot change task state, and can only open the same ephemeral
read bridge already used for source-aware answers. The service treats a browser draft
as an opt-out, never as proof that no draft exists. Before publication it checks the
current session, task revision, human epoch, current local day, break state, and source
permission again.
Only an exact committed return record is projected to the browser; raw source bodies,
bridge tokens, and model diagnostics stay private. Interrupted work is marked stale
or recovered by exact native lookup, never rerun automatically.

## Review checklist

- Is the new field necessary, minimized, and retained by a named owner?
- Does the route reject unexpected input before an external or durable effect?
- Does a write commit before its result is published?
- Can retry, restart, cancellation, or a stale client duplicate an action?
- Does a new source, permission, or model-data flow require separate consent?
- Are tests using isolated state and fixtures rather than a personal account?

## Source and installation boundary

Product source and synthetic fixtures are separate from personal installation
state. The shared source-boundary policy is enforced at runtime path selection,
Git staging/push checks, package input selection, and complete staging
verification. Personal profile values come only from local preferences. See
[Source code and private local data](data-boundary.md) for the ownership table,
hook setup, and history boundary.

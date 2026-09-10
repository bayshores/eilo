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

## Review checklist

- Is the new field necessary, minimized, and retained by a named owner?
- Does the route reject unexpected input before an external or durable effect?
- Does a write commit before its result is published?
- Can retry, restart, cancellation, or a stale client duplicate an action?
- Does a new source, permission, or model-data flow require separate consent?
- Are tests using isolated state and fixtures rather than a personal account?

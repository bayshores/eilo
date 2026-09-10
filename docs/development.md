# Development

## Requirements and setup

Use Python 3.13, Node.js 24, and uv. CI pins uv 0.9.13 and installs from both
checked-in lockfiles; `uv.lock` owns Python development dependencies and
`package-lock.json` owns the root JavaScript tools.

```sh
uv sync --group dev
npm ci
```

The root preview does not need credentials:

```sh
npm run dev
```

The optional Electron host has its own dependencies:

```sh
npm ci --prefix desktop/electron
```

Hermes is intentionally separate. A configured `.runtime/venv` and its pinned
source manifest are required for the model-backed local service; they are not
installed by `uv sync` or `npm ci`. Do not turn a missing runtime into a fallback
provider, alternate client, or automatic sign-in flow.

The runtime provisioning contract is recorded in
[`hermes-source.json`](../hermes-source.json): place that exact, checksum-verified
upstream source at `.runtime/hermes-agent`, install its dependencies from
[`requirements.hermes.lock`](../requirements.hermes.lock) and
[`requirements.integrations.lock`](../requirements.integrations.lock) into a
Python 3.13 environment at `.runtime/venv`, and install the extracted Hermes
package there in editable mode without resolving a different dependency set.
Runtime provisioning is currently manual; the development `.app` also depends
on this checkout. The launchers create only project-local configuration from
the public templates, and existing private configuration is never overwritten.
The provider sign-in is a separate, explicit setup step; it is not needed for
the preview, unit tests, or CI.

## Daily commands

| Command                      | Purpose                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run dev`                | Run the dependency-free sample preview.                                                     |
| `npm test`                   | Run Node unit tests and Python tests with isolated fixtures.                                |
| `npm run check`              | Run formatting, linting, selected browser-module type checks, tests, and repository checks. |
| `./scripts/local-chat start` | Start the configured local service on loopback.                                             |
| `./scripts/local-chat stop`  | Stop the service recorded as owned by this checkout.                                        |

Tests create a temporary test home beneath `.tmp`; they must not read, write, or
depend on `.state/hermes`. Tests must also avoid real accounts, model calls,
microphone capture, operating-system permissions, and activity collection.

## Change workflow

1. Locate the module that owns the behavior or state.
2. Write or update the focused test first when a regression is practical.
3. Implement validation at the owner boundary and preserve public route contracts.
4. Run the smallest relevant test, then `npm run check` before review.
5. For a UI change, inspect the preview at a representative desktop and compact
   viewport. For a live integration, perform the separate manual check only with
   the appropriate account or OS permission.

Review comments for decisions and invariants: why an ordering exists, why a
field is minimized, or why a rejection must be fail-closed. Remove comments
that merely paraphrase the code.

## Testing levels

| Level              | Evidence                             | Scope                                                                                         |
| ------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| Unit               | `npm test`                           | Parsing, validation, state transitions, and browser logic with fixtures.                      |
| Repository gate    | `npm run check`                      | Formatting, linting, selected pure browser-module type checks, tests, and repository hygiene. |
| Preview inspection | `npm run dev`                        | Sample UI behavior and layout only.                                                           |
| Manual integration | Configured local service or Electron | Provider, OAuth, microphone, native permissions, and real OS behavior.                        |

Do not report an isolated fixture pass as proof of a real provider, account,
notification, microphone, or browser-permission flow. Keep manual checks scoped
and never use a personal conversation as a disposable test fixture.

## Repository hygiene

Do not commit `.state/`, `.runtime/`, `.tmp/`, credentials, account exports,
local model files, generated desktop artifacts, or caches. Keep changes focused;
do not combine feature behavior, dependency upgrades, and broad formatting unless
the task requires all of them.

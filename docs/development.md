# Development

## One setup, two ways to test

All commands run from the repository root. Install Node.js 24 and uv first. Python development dependencies are managed by uv from `uv.lock`; Node dependencies use the checked-in npm lockfiles.

```sh
npm run setup
npm run dev
```

`setup` installs the locked Python and root Node dependencies, installs Electron dependencies on macOS, and enables the repository’s source/privacy Git guards. Existing custom Git hooks are preserved; if the guard installer reports a conflict, follow [the hook integration instructions](data-boundary.md#local-git-guards).

`dev` starts the full interactive test app at **http://127.0.0.1:8774/home/** with synthetic activity and temporary state. It never logs into an account, invokes a model, reads personal activity, or connects the Chrome extension. **Ctrl+C** stops it and discards its temporary fixture state. The older Home-only static preview is available explicitly as `npm run dev:static`.

## First-setup fixture

To exercise conversational onboarding without a provider or personal profile:

```sh
uv run --no-sync python scripts/preview-context.py --port 8797 --onboarding
```

Open **http://127.0.0.1:8797/home/**. The visible sample banner identifies synthetic
replies; goal staging, validation, approval, Home layout and support UI use the
real implementation with temporary state. Try a goal, refine the proposal, reload,
and approve it. **Ctrl+C** discards that fixture's backend state. No account,
source capture or OS grant is enabled. Real provider and native permission checks
remain separate. The normal `npm run dev` keeps its ordinary sample Home.

For Activity QC, `--checkin-phase` accepts `off`, `no_conversation`, `no_goals`,
`awaiting_observation`, `eligible` and `unavailable`. These override presentation
only; use ordinary `--onboarding` when testing successful setting transitions.
`--fail-checkin-toggle` rejects just the two check-in toggle commands.
`--sample-records` supplies snapshot-only recorded sessions, a trashed observation,
a delivered check-in and assistant history; it can run alone or with
`--sample-activity` for usage graphs and episode details. These generated record
IDs are for rendering, not backend deletion/restoration tests. Use a goal created
in an ordinary onboarding fixture to verify durable goal recovery.

## Home layout regression checks

Run `python3 scripts/preview-home-layout.py` and open **http://127.0.0.1:8794/**.
This renders the real Home launcher and populated Browser usage cards with the
production stylesheet order and synthetic content. It does not start a model,
read personal state, or expose files outside the public asset allowlist.

The matrix covers 192 combinations of narrow/wide card widths, short/tall saved
heights, absent goals and long titles, including container-query boundaries.
Check both typography options. **Check geometry** reports overlapping controls,
controls outside their cards, missing launcher actions and invalid usage fixtures.
Inspect representative cards visually and exercise their controls too; a geometry
pass alone does not prove label readability or working navigation. After changing
Home content, verify the real app at its existing saved card sizes and the ordinary
preview at compact and wide window sizes. Window width alone is insufficient.

## Chat context verification

`.venv/bin/python scripts/preview-context.py --port 8798 --chat-context`
starts an isolated UI fixture with synthetic usage and a simulated summary.
Use it for keyboard, narrow-screen and progress-state checks without model calls.

Run `.runtime/venv/bin/python -m unittest tests.test_chat_context_native` for
native storage checks using temporary databases: usage-anchor validation,
archived history, cloned replies, summary carriers, compression rotation and
the pinned summary route. These tests skip in the developer environment when
Hermes is absent; run them explicitly with the project-local runtime.

## Real Mac app

The current native target is Apple Silicon, macOS 14 or later. Install Xcode Command Line Tools if `xcrun` is unavailable (`xcode-select --install`). Then:

```sh
npm run setup:runtime
npm start
```

`setup:runtime` reads `hermes-source.json`, downloads that exact archive, verifies its SHA-256 checksum, and provisions `.runtime/venv` using the specified Python version, the two runtime dependency lockfiles, and the pinned Hermes source. An existing working runtime is kept. A failed fresh install can resume from its verified source; an unrecognized existing source checkout is never replaced automatically. No accounts, credentials, conversations, or capture permissions are imported or enabled.

`start` opens Electron from the root, prepares missing native helpers, and lets Electron own the local service on **http://127.0.0.1:8765/home/**. Stop the app with **eïlo → Quit eïlo**. Do not separately start a second service for the desktop app. The source checkout is required for this development build.

Inside the app, choose **Connect ChatGPT** and sign in with your own account. Connect Chrome and optional desktop context only when testing those features. Each developer’s private data stays in ignored `.state`, dependencies in `.runtime`, and scratch output in `.tmp`. Never share those folders. Model/provider changes are not a startup fallback.

## Common startup problems

| Message or symptom                               | Next step                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `uv` or Node is missing                          | Install uv and Node.js 24, then rerun `npm run setup`.                                                                                      |
| Developer or Electron dependencies are missing   | Run `npm run setup`.                                                                                                                        |
| The local runtime is missing                     | Run `npm run setup:runtime`, then `npm start`.                                                                                              |
| Existing Hermes source was kept unchanged        | Keep local edits. Use a fresh clone for a clean runtime setup, or deliberately reconcile the existing runtime; setup will not overwrite it. |
| Native helper compilation fails                  | Install Xcode Command Line Tools, then rerun `npm start`.                                                                                   |
| Port 8774 is already in use                      | Stop the earlier development terminal with Ctrl+C.                                                                                          |
| Port 8765 is already in use                      | Use the already-running eïlo app, or quit it normally before starting another copy.                                                         |
| Sample activity appears instead of your activity | You opened `npm run dev`. Use `npm start` for real local data.                                                                              |

## Checks and advanced commands

`npm run check` runs formatting, lint, type checks, JavaScript/Python tests, and source/privacy/asset checks. Tests use isolated state and need no model account. After native capture edits, also run `./scripts/check-context-collector`; it compiles and runs synthetic policy checks without asking for permissions or capturing activity.

For service-only debugging, the existing `./scripts/local-chat start` and `./scripts/local-chat stop` commands remain available after runtime setup. These are advanced alternatives to `npm start`, not extra steps required alongside it. The standalone [private Mac build](beta-release.md) is a separate unreleased packaging workflow.

The development host registers the fixed Chrome native messaging bridge with its project runtime. Registration prepares transport only; it does not grant browser access or change capture/AI choices. The standalone app uses its own managed runtime and Application Support data.

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

Follow the [source/private data boundary](data-boundary.md). Personal development
records belong in ignored `.local`; they are not product documentation. Local
Git guards inspect staged blobs and all outgoing commits in addition to CI
checks. Packaging accepts reviewed indexed source, not a recursive checkout copy.

Do not commit `.state/`, `.runtime/`, `.tmp/`, `.local/`, credentials, account exports,
local model files, generated desktop artifacts, or caches. Keep changes focused;
do not combine feature behavior, dependency upgrades, and broad formatting unless
the task requires all of them.

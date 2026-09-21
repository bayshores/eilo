# felis

felis is a local, conversation-led workspace for maintaining commitments and
returning to them. It keeps a durable goal projection beside an auditable native
conversation, then adds assistance only where the person has granted the needed
context and permission.

## Start here

Install **Node.js 24** and **uv**, then run these commands from the repository root:

```sh
npm run setup
npm run dev
```

Open **http://127.0.0.1:8774/home/**. This is the full interactive development UI with synthetic activity. No account, Chrome extension, or personal data is needed. Stop it with **Ctrl+C**. Run `npm run setup` once after cloning, and again when dependencies change.

### Run the real Mac app

On an **Apple Silicon Mac with macOS 14+** and Xcode Command Line Tools:

```sh
npm run setup:runtime
npm start
```

Runtime setup is a one-time download of the pinned Hermes source and Python dependencies. Sign in with **your own account inside felis**. Chrome and desktop permissions are optional and are connected through the app. Each developer keeps their own data locally; never copy another developer’s `.state`, credentials, or runtime folder.

### Before sharing changes

```sh
npm run check
```

| Command              | Use it for                                                           |
| -------------------- | -------------------------------------------------------------------- |
| `npm run dev`        | Normal UI development and interaction testing with sample data.      |
| `npm start`          | Real Mac app, local account, and permitted capture.                  |
| `npm run check`      | All local code, test, and privacy-boundary checks.                   |
| `npm run dev:static` | The older lightweight Home-only prototype, when specifically needed. |

The app is not publicly released. Pushing source does not publish an app build. See [development](docs/development.md) for prerequisites and troubleshooting.

## Project map

| Location                       | Responsibility                                                              |
| ------------------------------ | --------------------------------------------------------------------------- |
| `app/`                         | Local Python service, domain logic, durable state, and HTTP routes.         |
| `web/`                         | Browser source for Home and workspace views, organized by feature.          |
| `desktop/electron/`            | Optional macOS-first Electron host.                                         |
| `activity/`                    | Explicitly enabled activity integrations and their narrow native bridge.    |
| `tests/`                       | Python and Node regression checks using isolated state.                     |
| `docs/`                        | Architecture, product boundaries, development guidance, and design records. |
| `prototypes/typography-study/` | Retained typography research, separate from the product UI.                 |

## Documentation

- [Documentation index](docs/README.md)
- [Architecture and state ownership](docs/architecture.md)
- [Development and verification](docs/development.md)
- [Product direction](docs/product.md)
- [User guide](docs/user-guide.md)
- [Security and privacy boundaries](docs/security.md)
- [Source code and private local data](docs/data-boundary.md)

## Contribution principles

Make a small, coherent change in the owning module. Keep policy and validation
server-side, preserve durable-write-before-publication ordering, and add a
focused regression whenever behavior or a boundary changes. Comments should
explain an invariant, security boundary, or non-obvious decision; they should
not narrate syntax.

`npm run check` is the repository gate: formatting, linting, selected
browser-module type checks, unit tests, and repository checks. It uses isolated
test state and never reads or writes `.state/hermes`.

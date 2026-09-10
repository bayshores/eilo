# eïlo

eïlo is a local, conversation-led workspace for maintaining commitments and
returning to them. It keeps a durable goal projection beside an auditable native
conversation, then adds assistance only where the person has granted the needed
context and permission.

The project is deliberately local-first. The Python service listens only on
loopback; private runtime state and credentials are ignored by Git. Hermes is a
separately provisioned runtime for the optional model-backed experience, rather
than a dependency that `npm install` can recreate.

## Quick start

Requirements: Python 3.13, Node.js 24, and uv (the Python dependency manager).

```sh
uv sync --group dev
npm ci
npm run dev
```

`npm run dev` starts the dependency-free sample preview. It needs no account or
credential. For the local application service, use the project launcher after
the separately provisioned Hermes runtime is available:

```sh
./scripts/local-chat start
# http://127.0.0.1:8765/home/
./scripts/local-chat stop
```

The Electron development host is optional:

```sh
npm ci --prefix desktop/electron
```

See [development](docs/development.md) for setup, checks, and the boundary
between fixture-based checks and live manual verification.

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

## Contribution principles

Make a small, coherent change in the owning module. Keep policy and validation
server-side, preserve durable-write-before-publication ordering, and add a
focused regression whenever behavior or a boundary changes. Comments should
explain an invariant, security boundary, or non-obvious decision; they should
not narrate syntax.

`npm run check` is the repository gate: formatting, linting, selected
browser-module type checks, unit tests, and repository checks. It uses isolated
test state and never reads or writes `.state/hermes`.

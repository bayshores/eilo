# eïlo documentation

This directory describes the current codebase and durable product decisions.
It replaces root-level status logs as the place to learn how the project works.

| Document                        | Use it for                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| [Architecture](architecture.md) | Service boundaries, request lifecycle, state ownership, and extension points.          |
| [Development](development.md)   | Local setup, commands, tests, and review expectations.                                 |
| [Product](product.md)           | Product purpose, current capabilities, and intentionally deferred work.                |
| [User guide](user-guide.md)     | Everyday controls and the meaning of permissions.                                      |
| [Security](security.md)         | Locality, authorization, data minimization, and threat-relevant invariants.            |
| [`design/`](design/)            | Dated design records and research decisions; read the newer record when they conflict. |

Start with the root [README](../README.md), then use the document that matches
your task. Historical notes are evidence, not a replacement for code, tests, or
the current product boundary.

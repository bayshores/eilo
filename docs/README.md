# eïlo documentation

This directory describes the current codebase and durable product decisions.
It replaces root-level status logs as the place to learn how the project works.

| Document                             | Use it for                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| [Architecture](architecture.md)      | Service boundaries, request lifecycle, state ownership, and extension points.          |
| [Development](development.md)        | Local setup, commands, tests, and review expectations.                                 |
| [Product](product.md)                | Product purpose, current capabilities, and intentionally deferred work.                |
| [User guide](user-guide.md)          | Everyday controls and the meaning of permissions.                                      |
| [Security](security.md)              | Locality, authorization, data minimization, and threat-relevant invariants.            |
| [Private Mac build](beta-release.md) | Standalone runtime packaging, verified limits, and deferred distribution gates.        |
| [`design/`](design/)                 | Dated design records and research decisions; read the newer record when they conflict. |

For storage ownership, private development notes, Git guards, and package inputs,
see [Source code and private local data](data-boundary.md).

For shared Tracking/Usage visuals, website-level Activity, native connection
health, and the proposed permission handoff, see
[Activity visuals and permission setup](design/activity-visuals-and-permissions.md).

Start with the root [README](../README.md), then use the document that matches
your task. Historical notes are evidence, not a replacement for code, tests, or
the current product boundary.

# Connections, chats and projects

Status: local development; not released. Implementation authority: the felis app repository.

## Product and UX

A connection/plugin manager supports local `/mcp` management and existing chats and projects. Mobbin informed the interaction review.

The reviewed references were Sana AI's [starting a chat](https://mobbin.com/flows/19170637-d4b9-4502-a716-0734e6eeb3d0), [integration detail](https://mobbin.com/flows/c051daa4-135c-4f82-85e9-b6f2c366d7e8), and [creating a folder](https://mobbin.com/flows/9720a69e-11be-4cd2-a837-fb8886d35255) flows. These supplied interaction references, not scientific evidence of effectiveness or permission to copy assets.

- Conversation switching is beside the composer: current chat, recent/searchable choices, New chat, and All chats & projects. Selecting a chat keeps the current work view and opens replies inline. There is no modal conversation takeover.
- Chats is an optional compact history view with search, All/Pinned/Archived, project filters when projects exist, and adjacent options. New chat creates immediately; its display name comes from the first user message. New project requires one name and selects the created project.
- Connections is a searchable service list with actual switches and options. Gmail, Calendar and browser activity retain their own setup and permission controls. Selecting an entry shows one service with a clear back action. Account consent is preserved across parent refreshes.
- `/mcp` opens the MCP filter directly. `/connections`, `/chats`, `/projects` and `/new` are local interface actions and never become model messages.
- IBM Plex Sans, the accepted charcoal/peach palette, floating rounded navigation and bottom composer remain. Decorative separator rules, wallpaper, textures and repeated card containers were not added.

## Ownership and data

`app/chat_catalog.py` owns display names, pin/archive states, projects and native conversation pointers. Hermes continues to own all messages. Projects group chats; they do not yet provide project-specific instructions, files, permissions or agent memory. Goals, tasks, observed activity and connection choices remain global. Renaming a chat never renames the native `eilo-ui-*` lookup title.

Historical import admits only exact felis-owned native titles. It collapses Hermes compression lineages, reads from a read-only SessionDB, and stores compact pointers plus a bounded first-message display name. It includes earlier saved setup/testing conversations; those can be archived by the user. It does not import unrelated Hermes sessions. Custom display names win over later imports.

Switching refuses busy or unresolved pending turns, preempts stale proactive work, audits the destination native record before committing, and preserves global state that arrived during export. Messages carry a stable catalog chat ID to reject stale tabs. Browser drafts and uncertain send receipts are isolated per catalog chat, including the first native-session ID assignment.

## Connections and permission semantics

Google and activity switches use the existing local controls. The Gmail master switch resumes only inboxes that were previously enabled, rather than enabling every saved inbox. Calendar sync and sending selected Calendar information to the model remain separate choices. Browser activity requires its own optional host grant and connected extension to enable collection.

Custom MCP setup is real but limited: save an HTTPS endpoint or local executable/argument list, enable/disable that configuration, explicitly test initialization and tools/list, and remove the local entry. New entries start disabled. Rendering, adding or enabling an entry never starts a server. Only Test connection starts a local command or contacts the endpoint. Probe results show counts and failures; no tool is called during a test.

MCP tools are **not available to model conversations in this increment**. The UI discloses that limit. Authentication-bearing MCP setup is not implemented. Connection configuration never changes Hermes's locked runtime MCP/tool configuration; the existing four bounded read tools are preserved. No plugin configurations or credentials are imported.

## Verification

- 154 Python regression tests passed, including new catalog, connection lifecycle, pending-turn, rollback and per-inbox resume checks.
- 80 Home frontend tests, 29 Electron tests and two legacy web-client checks passed.
- A real MCP SDK/Hermes adapter handshake against a disposable local server listed one inert tool; no tool execution or external network source was used.
- Browser interaction checks on a disposable app store covered project creation, immediate chat creation in a project, switching and restoring a draft, direct `/mcp` navigation, saving an off MCP, toggling its configuration and removing it. No test chats, projects or MCPs were written into the live workspace.
- Browser inspection covers revised history, connection list, source options, navigation, and service-restart state preservation using isolated data. Live source authorization, account-based catch-up, and usefulness remain separate acceptance work.

## Next

Verify a permitted source-backed request. Extending arbitrary MCP tools into conversations requires an explicit tool-approval and execution boundary; a successful connection probe is not evidence that arbitrary tools are safe or usable by the agent.

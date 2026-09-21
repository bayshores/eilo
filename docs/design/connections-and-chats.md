# Connections, chats and projects

Status: local development; not released. Implementation authority: the felis app repository.

## Product and UX

Connections owns machine-wide setup; the per-chat capability manager owns what a conversation may use. Existing chats and projects remain in History. See [per-chat capability profiles](capability-profiles.md). Mobbin informed the original interaction review.

The reviewed references were Sana AI's [starting a chat](https://mobbin.com/flows/19170637-d4b9-4502-a716-0734e6eeb3d0), [integration detail](https://mobbin.com/flows/c051daa4-135c-4f82-85e9-b6f2c366d7e8), and [creating a folder](https://mobbin.com/flows/9720a69e-11be-4cd2-a837-fb8886d35255) flows. These supplied interaction references, not scientific evidence of effectiveness or permission to copy assets.

- Conversation switching is beside the composer: current chat, recent/searchable choices, New chat, and All chats & projects. Selecting a chat keeps the current work view and opens replies inline. There is no modal conversation takeover.
- Chats is an optional compact history view with search, All/Pinned/Archived, project filters when projects exist, and adjacent options. New chat creates immediately; its display name comes from the first user message. New project requires one name and selects the created project.
- Connections is a searchable service list with actual switches and options. Gmail, Calendar and browser activity retain their own setup and permission controls. Selecting an entry shows one service with a clear back action. Account consent is preserved across parent refreshes.
- /capabilities, /skills, /plugins, /mcp, and /connectors open the matching current-chat filter. /connections opens machine-wide setup. These and the History commands are local interface actions and never become model messages.
- Geist Sans and Mono, the black-and-rose instrument palette, squared controls, and the Home conversation dock define the current system. Decorative icon tiles, glass cards, wallpaper, textures, and ornamental dividers are not part of this surface.

## Ownership and data

`app/chat_catalog.py` owns display names, pin/archive states, projects and native conversation pointers. Hermes continues to own all messages. Projects group chats; they do not yet provide project-specific instructions, files, permissions or agent memory. Goals, tasks, observed activity and connection choices remain global. Renaming a chat never renames the native `eilo-ui-*` lookup title.

Historical import admits only exact felis-owned native titles. It collapses Hermes compression lineages, reads from a read-only SessionDB, and stores compact pointers plus a bounded first-message display name. It includes earlier saved setup/testing conversations; those can be archived by the user. It does not import unrelated Hermes sessions. Custom display names win over later imports.

Switching refuses busy or unresolved pending turns, preempts stale proactive work, audits the destination native record before committing, and preserves global state that arrived during export. Messages carry a stable catalog chat ID to reject stale tabs. Browser drafts and uncertain send receipts are isolated per catalog chat, including the first native-session ID assignment.

## Connections and permission semantics

Google and activity switches use the existing local controls. The Gmail master switch resumes only inboxes that were previously enabled, rather than enabling every saved inbox. Calendar sync and sending selected Calendar information to the model remain separate choices. Browser activity requires its own optional host grant and connected extension to enable collection.

Custom MCP setup is real but limited: save an HTTPS endpoint or local executable/argument list, enable/disable that configuration, explicitly test initialization and tools/list, and remove the local entry. New entries start disabled. Rendering, adding or enabling an entry never starts a server. Only Test connection starts a local command or contacts the endpoint. Probe results show counts and failures; no tool is called during a test.

An enabled MCP becomes machine-available without restarting felis. It remains absent from a conversation until the current chat selects it; changes apply on the next turn. The human driver passes only the selected MCP toolset names to a new turn process and audits that tools were actually exposed. Authentication-bearing custom MCP setup is still not implemented. Plugins expose their supported contained skills and portable MCP servers only when the plugin is already enabled for felis and selected for the chat.

## Verification

- The current repository gate passes 292 JavaScript tests and 358 Python tests, with five platform-dependent skips, plus formatting, lint, type, public-asset, and private-state boundary checks.
- Native Electron inspection covered the new-day foreground transition, Home, conversation, unclipped slash menu, exact /skills routing, per-chat persistence, the this-Mac scope, History/Escape, and wide and compact layouts.
- One reversible per-chat skill selection was enabled, reloaded, and restored in an existing isolated interface-test conversation. No real goal, connector, machine-wide skill state, plugin, or MCP configuration was changed.
- The earlier disposable MCP handshake listed one inert tool. The current pass did not authenticate an external MCP or call one of its tools.

## Next

Verify authenticated MCP setup only after defining its credential and approval boundary. A successful connection probe proves enumeration, not that a particular external action is safe or appropriate.

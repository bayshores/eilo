# Per-chat capability profiles

Status: implemented for the local felis runtime.

felis separates what exists on this Mac from what the current chat may use. This
keeps a focused chat small without making installation, sign-in, or permission
state disappear.

## Vocabulary

- **Connector**: an account or local source such as Gmail, Calendar, or recorded
  browser activity. Connecting a source makes it available on this Mac; each chat
  can still keep it off.
- **Skill**: reusable instructions loaded into the next turn's system guidance.
- **MCP**: a configured server that can expose tools or data. The server must be
  globally enabled before a chat can select it.
- **Plugin**: an installed bundle. A selected plugin activates its supported
  contained skills and portable MCP servers together.

The interface shows three scopes: **built in**, **this Mac**, and **this chat**.
felis does not currently have project-local capability installation, so it does
not show a fictional project scope.

## Runtime behavior

The capabilities domain owns a revisioned profile for each chat. Global connection
and installation state remains with its existing owner. A profile may narrow that
state but never widen it: an unavailable connector, disabled skill, disabled MCP,
or inactive plugin cannot be enabled through the profile API.

Each user turn resolves the active profile once. Permitted connectors bound the
read-only source bridge, selected skills are preloaded into that turn, and only
selected MCP toolsets are passed to the new Hermes agent process. Changes apply to
the next turn, including the next turn in an existing chat; the app and local
service do not restart. A turn already in flight keeps the profile it started
with.

Machine-wide MCP definitions are written atomically to the private Hermes config.
The pinned runtime contract admits exactly those definitions while still refusing
fallback providers and default action toolsets. Connection tests enumerate tools
without calling them. A chat turn can call tools only when that MCP is both
globally enabled and selected for the chat.

## Interaction

Settings has one **Capabilities** area with a short glossary, filters, search,
and an explicit **this chat** / **this Mac** scope control. Chat switches narrow
the next turn. Mac switches enable or disable installed skills and plugins for
felis on the next turn. Connector and MCP setup routes to **Manage connections**.
Unavailable rows remain visible and disabled so the reason is inspectable.

The slash commands /capabilities, /skills, /plugins, /mcp, and /connectors open
the matching filter. /connections opens machine-wide connection setup. These are
local interface commands and never become model messages.

The design follows the useful separation found in Claude Code's local, project,
and user MCP scopes, adapted to felis's actual built-in/Mac/chat boundaries. It
also follows Codex's distinction between plugins as packages, skills as
instructions, and MCP servers as tool providers. Codex App Server's live skill
toggle and MCP reload APIs support the decision that capability changes should
not require an application restart.

Primary references:

- [OpenAI plugin concepts](https://developers.openai.com/plugins/concepts/plugins)
- [OpenAI Codex skills](https://developers.openai.com/codex/skills)
- [OpenAI Codex MCP](https://developers.openai.com/codex/mcp)
- [OpenAI Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Claude Code MCP scopes](https://docs.anthropic.com/en/docs/claude-code/mcp)
- [Claude Code plugins](https://code.claude.com/docs/en/plugins)

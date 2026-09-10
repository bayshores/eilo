// These are interface actions, never prompts sent to the model.
export const LOCAL_COMMANDS = Object.freeze([
  { command: '/mcp', label: 'Manage MCP servers', page: 'connections' },
  { command: '/connections', label: 'Manage connected services', page: 'connections' },
  { command: '/chats', label: 'Open your chats', page: 'chats' },
  { command: '/projects', label: 'Open your projects', page: 'projects' },
  { command: '/new', label: 'Start a new chat', page: null },
]);
/** @param {string} text */
export function localCommand(text) {
  return LOCAL_COMMANDS.find((item) => item.command === String(text).trim().toLowerCase()) || null;
}
/** @param {string} text */
export function commandMatches(text) {
  const query = String(text).trim().toLowerCase();
  return query.startsWith('/')
    ? LOCAL_COMMANDS.filter((item) => item.command.startsWith(query))
    : [];
}

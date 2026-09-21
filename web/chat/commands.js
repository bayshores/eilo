// Commands stay local. Workflow commands may prepare an editable draft, but
// they never send a hidden prompt or submit on the user's behalf.
export const LOCAL_COMMANDS = Object.freeze([
  {
    command: '/goal',
    label: 'Create or update a goal',
    page: null,
    acceptsInput: true,
  },
  { command: '/context', label: 'View context space', page: null },
  { command: '/compress', label: 'Summarize older context', page: null },
  { command: '/usage', label: 'View token usage', page: null },
  { command: '/help', label: 'Show chat commands', page: null },
  { command: '/mcp', label: 'Manage MCP servers', page: 'connections' },
  { command: '/connections', label: 'Manage connected services', page: 'connections' },
  { command: '/chats', label: 'Open your chats', page: 'chats' },
  { command: '/projects', label: 'Open your projects', page: 'projects' },
  { command: '/new', label: 'Start a new chat', page: null },
]);
/** @param {string} text */
export function localCommand(text) {
  const value = String(text).trim();
  const separator = value.search(/\s/);
  const name = (separator === -1 ? value : value.slice(0, separator)).toLowerCase();
  const command = LOCAL_COMMANDS.find((item) => item.command === name);
  if (!command) return null;
  const input = separator === -1 ? '' : value.slice(separator).trim();
  if (input && !command.acceptsInput) return null;
  return { ...command, input };
}
/** @param {string} text */
export function commandMatches(text) {
  const query = String(text).trim().toLowerCase();
  return query.startsWith('/')
    ? LOCAL_COMMANDS.filter((item) => item.command.startsWith(query))
    : [];
}

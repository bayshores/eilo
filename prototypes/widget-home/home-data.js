// The native conversation and revisioned task projection are the only content authority.
export function homeData(snapshot) {
  const supported = snapshot?.schema_version === 2 && Array.isArray(snapshot.tasks?.tasks)
    && snapshot.tasks.tasks.every(task => typeof task?.id === 'string' && typeof task.title === 'string'
      && ['open', 'completed', 'cancelled', 'deleted'].includes(task.status));
  if (!supported) return { supported: false, tasks: [], trash: [], open: [], completed: [], focus: null, onBreak: false };
  const tasks = snapshot.tasks.tasks.filter(task=>task.status!=='deleted');
  const trash = snapshot.tasks.tasks.filter(task=>task.status==='deleted');
  return {
    supported, tasks, trash,
    open: tasks.filter(task => task.status === 'open'),
    completed: tasks.filter(task => task.status === 'completed'),
    focus: tasks.find(task => task.status === 'open' && task.id === snapshot.tasks.focus_id) || null,
    onBreak: snapshot.tasks.break_active === true,
  };
}

export function progressText(task) {
  if (!Number.isInteger(task.target_count) || task.target_count < 1 || !Number.isInteger(task.completed_count)) return '';
  return `${task.completed_count} of ${task.target_count}${task.unit ? ` ${task.unit}` : ''}`;
}

export const deliveryLabel = status => ({ sending: 'Sending…', accepted: 'Accepted · waiting for eïlo', failed: 'Reply failed', interrupted: 'Reply interrupted', unconfirmed: 'Delivery not confirmed', rejected: 'Not sent' })[status] || '';

export function conversationEntries(snapshot, localPending) {
  const messages = (Array.isArray(snapshot?.messages) ? snapshot.messages : [])
    .filter(message => ['user', 'assistant'].includes(message?.role) && typeof message.text === 'string')
    .map(message => ({ ...message, delivery: null }));
  const pending = snapshot?.pending_message;
  if (pending && typeof pending.text === 'string') messages.push({ id: pending.request_id, role: 'user', text: pending.text, delivery: pending.status });
  if (localPending && pending?.request_id !== localPending.request_id && !snapshot?.accepted_request_ids?.includes(localPending.request_id)) {
    messages.push({ id: localPending.request_id, role: 'user', text: localPending.text, delivery: localPending.status });
  }
  return messages;
}

// Notification routing never switches or recreates a conversation.
export function notificationEntry(snapshot, target) {
  if (!target || snapshot?.conversation_id !== target.conversationId) return null;
  return (Array.isArray(snapshot?.messages) ? snapshot.messages : []).find(entry =>
    entry?.id === target.messageId && entry.event_id === target.eventId
    && entry.role === 'assistant' && entry.origin === 'check_in') || null;
}

const SOURCES = {
  conversation: 'Conversation',
  goals: 'Saved goals',
  connections: 'Connection status',
  mail: 'Gmail',
  calendar: 'Calendar',
  work_context: 'Permitted work context',
  activity: 'Permitted activity',
};
const STATUSES = {
  used: 'Provided to AI',
  unavailable: 'Unavailable',
  no_data: 'No data returned',
};

export function provenanceRows(value) {
  if (
    !value ||
    value.version !== 1 ||
    !Number.isInteger(value.task_revision) ||
    value.task_revision < 0 ||
    !Array.isArray(value.sources) ||
    value.sources.length > 24
  )
    return null;
  if (
    !value.sources.every(
      (item) => item && Object.hasOwn(SOURCES, item.source) && Object.hasOwn(STATUSES, item.status),
    )
  )
    return null;
  return value.sources.map((item) => ({
    name: SOURCES[item.source],
    status: STATUSES[item.status],
  }));
}

export function appendProvenance(host, entry) {
  if (entry.role !== 'assistant' || entry.preview) return;
  const details = document.createElement('details');
  details.className = 'provenance-details';
  const summary = document.createElement('summary');
  summary.textContent = 'What informed this?';
  details.append(summary);
  const rows = provenanceRows(entry.provenance);
  if (rows) {
    const caption = document.createElement('p');
    caption.textContent = 'Inputs supplied for this reply.';
    const list = document.createElement('ul');
    for (const row of rows) {
      const item = document.createElement('li');
      item.textContent = row.name + ' · ' + row.status;
      list.append(item);
    }
    details.append(caption, list);
  } else {
    const note = document.createElement('p');
    note.textContent = 'Source-use details aren’t available for this reply.';
    details.append(note);
  }
  host.append(details);
}

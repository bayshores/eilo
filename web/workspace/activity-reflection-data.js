const ownActivity = (record) => {
  const text = [record?.appName, record?.title, record?.origin]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase();
  return (
    text.includes('eïlo') ||
    text.includes('eilo') ||
    text.includes('127.0.0.1') ||
    text.includes('localhost')
  );
};

const recordedSeconds = (record) => {
  const value = record?.kind === 'episode' ? record.recordedSeconds : record?.observed_seconds;
  return Number.isFinite(value) && value >= 0 ? value : 0;
};

export function activityReflection(records) {
  const items = Array.isArray(records) ? records : [];
  const own = items.filter(ownActivity).length;
  const other = items.length - own;
  const seconds = items.reduce((total, record) => total + recordedSeconds(record), 0);
  if (!items.length)
    return {
      kind: 'empty',
      title: 'Nothing shared yet',
      detail: 'Connect a source when you are ready.',
      recordCount: 0,
      otherCount: 0,
      seconds: 0,
    };
  if (!other)
    return {
      kind: 'setup',
      title: 'No work context yet',
      detail: 'eïlo has only recorded its own setup and conversation activity so far.',
      recordCount: items.length,
      otherCount: 0,
      seconds,
    };
  if (other < 3)
    return {
      kind: 'snapshot',
      title: 'A small activity snapshot',
      detail: 'There is not enough recorded context for a useful pattern yet.',
      recordCount: items.length,
      otherCount: other,
      seconds,
    };
  return {
    kind: 'activity',
    title: 'Activity at a glance',
    detail: 'This is recorded context, never proof of attention, progress, or completion.',
    recordCount: items.length,
    otherCount: other,
    seconds,
  };
}

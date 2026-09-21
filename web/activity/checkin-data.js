const PHASES = {
  off: ['Check-ins off', 'Automatic check-ins are paused. You can still chat.', 'off'],
  unavailable: ['Needs attention', 'Reconnect the conversation to restore check-ins.', 'warning'],
  in_conversation: ['In conversation', 'Check-ins wait while felis replies.', 'active'],
  no_conversation: ['Ready when you are', 'Start a conversation with felis.', 'waiting'],
  on_break: ['You’re on a break', 'Check-ins wait until your break ends.', 'paused'],
  no_goals: ['Waiting for a goal', 'Tell felis what you want to work toward.', 'waiting'],
  activity_off: ['Waiting for activity', 'Browser activity sharing is off.', 'waiting'],
  activity_paused: [
    'Activity disconnected',
    'Reconnect the Chrome activity page to resume sharing.',
    'waiting',
  ],
  deciding: ['Considering a check-in', 'felis is reviewing context. It may stay quiet.', 'active'],
  awaiting_observation: [
    'Waiting for context',
    'Connected. Waiting for approved activity.',
    'waiting',
  ],
  settling: ['Letting you settle in', 'Waiting for activity to settle.', 'active'],
  human_grace: ['Giving you room', 'Waiting after your recent conversation.', 'active'],
  cooldown: ['Giving you room', 'Waiting before the next check.', 'active'],
  unchanged: ['Waiting for a change', 'This context has already been considered.', 'active'],
  budget: ['Quiet for now', 'The check-in limit has been reached.', 'paused'],
  eligible: ['Ready to notice', 'New activity may prompt a check-in.', 'active'],
};

export const OUTCOMES = {
  delivered: [
    'Checked in',
    'A check-in was saved in your conversation. This does not confirm that a desktop notification appeared.',
  ],
  quiet: ['Stayed quiet', 'The check finished without sending you a message.'],
  stale: ['Set aside', 'The check was interrupted or its context changed before it could be used.'],
  failed_quiet: ['Couldn’t finish', 'The check failed. No check-in was sent from this attempt.'],
  running: ['Reviewing context', 'felis is deciding whether a check-in would help.'],
};

const stamp = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
export function checkinView(view) {
  const data = view?.snapshot?.accountability?.check_ins;
  const supported =
    data?.version === 1 && typeof data.enabled === 'boolean' && !!PHASES[data.phase];
  if (view?.connection !== 'connected' || !supported)
    return {
      supported: false,
      enabled: false,
      phase: 'unavailable',
      tone: 'warning',
      title: view?.connection === 'loading' ? 'Connecting…' : 'Status unavailable',
      description: 'Reconnect to see current check-in status.',
      chip: 'Check-ins · status unavailable',
      history: [],
      eligibleAt: null,
      observation: null,
    };
  const [title, description, tone] = PHASES[data.phase];
  const history = (Array.isArray(data.history) ? data.history : [])
    .filter((item) => item && OUTCOMES[item.outcome] && stamp(item.created_at))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 30)
    .map((item) => ({
      outcome: item.outcome,
      createdAt: stamp(item.created_at),
      finishedAt: stamp(item.finished_at),
      title: OUTCOMES[item.outcome][0],
      description: OUTCOMES[item.outcome][1],
    }));
  const observed = data.last_observation;
  const observation =
    observed &&
    ['approved_study_context', 'activity_unshared', 'activity_unknown'].includes(observed.kind) &&
    stamp(observed.at)
      ? { kind: observed.kind, at: observed.at }
      : null;
  return {
    supported,
    enabled: data.enabled,
    phase: data.phase,
    title,
    description,
    tone,
    chip: data.phase === 'off' ? 'Check-ins off' : title,
    history,
    eligibleAt: stamp(data.eligible_at),
    evaluatedAt: stamp(data.evaluated_at),
    observation,
    rules: data.rules || {},
    delivered: history.filter((item) => item.outcome === 'delivered').length,
  };
}

export function groupedCheckinHistory(history) {
  let failed = 0;
  for (const item of history || []) {
    if (item?.outcome !== 'failed_quiet') break;
    failed += 1;
  }
  if (failed < 2) return { summary: null, failed: [], entries: history || [] };
  return {
    summary: {
      count: failed,
      title: 'Recent check-ins could not finish',
      description: 'No check-in was sent from these attempts. The recorded details are kept below.',
    },
    failed: history.slice(0, failed),
    entries: history.slice(failed),
  };
}

export function checkinTime(value) {
  return stamp(value)
    ? new Date(value * 1000).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'Not yet';
}

export function observedContext(observation) {
  if (!observation) return 'Nothing observed yet';
  return observation.kind === 'approved_study_context'
    ? 'Browser context received'
    : observation.kind === 'activity_unshared'
      ? 'Activity details not shared'
      : 'Activity unavailable';
}

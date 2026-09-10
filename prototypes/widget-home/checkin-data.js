const PHASES = {
  off: ['Check-ins off', 'eïlo will respond when you message it. Automatic check-ins are paused.', 'off'],
  unavailable: ['Needs attention', 'The local agent is unavailable. Check the conversation connection before expecting a check-in.', 'warning'],
  in_conversation: ['In conversation', 'eïlo is responding to you. Automatic check-ins wait until that conversation turn finishes.', 'active'],
  no_conversation: ['Ready when you are', 'Start a conversation so eïlo has somewhere to continue with you.', 'waiting'],
  on_break: ['You’re on a break', 'Check-ins wait while your break is active. Your goals are kept.', 'paused'],
  no_goals: ['Waiting for a goal', 'Tell eïlo what you want to work toward. It needs an open goal to make a check-in relevant.', 'waiting'],
  activity_off: ['Waiting for activity', 'Activity sharing is off, so eïlo cannot notice changes in what you’re doing or initiate an activity-based check-in.', 'waiting'],
  activity_paused: ['Activity disconnected', 'Sharing has paused. Reconnect the Chrome activity page to let eïlo notice changes again.', 'waiting'],
  deciding: ['Considering a check-in', 'eïlo is reviewing the current context. It may reach out or decide to leave you to it.', 'active'],
  awaiting_observation: ['Waiting for context', 'Activity sharing is connected. eïlo is waiting for its first usable observation.', 'waiting'],
  settling: ['Letting you settle in', 'eïlo waits for activity to settle before deciding whether a check-in would help.', 'active'],
  human_grace: ['Giving you room', 'You recently spoke with eïlo. It gives you time to act before considering a check-in.', 'active'],
  cooldown: ['Giving you room', 'A check was made recently. eïlo waits before considering another.', 'active'],
  unchanged: ['Waiting for a change', 'The current context has already been considered. eïlo waits for a change or something new from you.', 'active'],
  budget: ['Quiet for now', 'The check-in limit has been reached. eïlo will become eligible to check again later.', 'paused'],
  eligible: ['Ready to notice', 'The conditions allow another check. The next observation can prompt eïlo to decide whether reaching out would help.', 'active'],
};

export const OUTCOMES = {
  delivered: ['Checked in', 'A check-in was saved in your conversation. This does not confirm that a desktop notification appeared.'],
  quiet: ['Stayed quiet', 'The check finished without sending you a message.'],
  stale: ['Set aside', 'The check was interrupted or its context changed before it could be used.'],
  failed_quiet: ['Couldn’t finish', 'The check failed. No check-in was sent from this attempt.'],
  running: ['Reviewing context', 'eïlo is deciding whether a check-in would help.'],
};

const stamp=value=>typeof value==='number'&&Number.isFinite(value)&&value>0?value:null;
export function checkinView(view) {
  const data=view?.snapshot?.accountability?.check_ins;
  const supported=data?.version===1&&typeof data.enabled==='boolean'&&!!PHASES[data.phase];
  if(view?.connection!=='connected'||!supported) return {
    supported:false, enabled:false, phase:'unavailable', tone:'warning',
    title:view?.connection==='loading'?'Connecting…':'Status unavailable',
    description:'Live check-in status will appear when the local service is connected. Saved information is not proof that eïlo is running.',
    chip:'Check-ins · status unavailable', history:[], eligibleAt:null, observation:null,
  };
  const [title,description,tone]=PHASES[data.phase];
  const history=(Array.isArray(data.history)?data.history:[])
    .filter(item=>item&&OUTCOMES[item.outcome]&&stamp(item.created_at))
    .sort((a,b)=>b.created_at-a.created_at).slice(0,30)
    .map(item=>({outcome:item.outcome,createdAt:stamp(item.created_at),finishedAt:stamp(item.finished_at),title:OUTCOMES[item.outcome][0],description:OUTCOMES[item.outcome][1]}));
  const observed=data.last_observation;
  const observation=observed&&['approved_study_context','activity_unshared','activity_unknown'].includes(observed.kind)&&stamp(observed.at)?{kind:observed.kind,at:observed.at}:null;
  return {supported,enabled:data.enabled,phase:data.phase,title,description,tone,
    chip:data.phase==='off'?'Check-ins off':title,history,eligibleAt:stamp(data.eligible_at),
    evaluatedAt:stamp(data.evaluated_at),observation,rules:data.rules||{},
    delivered:history.filter(item=>item.outcome==='delivered').length,
  };
}

export function checkinTime(value) {
  return stamp(value)?new Date(value*1000).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Not yet';
}

export function observedContext(observation) {
  if(!observation)return 'Nothing observed yet';
  return observation.kind==='approved_study_context'?'Approved site context received':observation.kind==='activity_unshared'?'Activity details not shared':'Activity unavailable';
}

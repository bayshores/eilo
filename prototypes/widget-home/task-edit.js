// The form creates one validated transaction; it never predicts a saved result.
function quantity(value, label, {optional=false, minimum=0}={}) {
  const text=String(value??'').trim();
  if(optional&&!text)return null;
  if(!/^\d+$/.test(text)||Number(text)<minimum||Number(text)>10000)throw new Error(`${label} must be a whole number from ${minimum} to 10,000.`);
  return Number(text);
}

export function taskEditOperations(task, values, tempId='new_manual') {
  const title=String(values.title||'').trim(),due=String(values.due_text||'').trim()||null;
  if(!title||title.length>500)throw new Error('Enter a goal name of 1–500 characters.');
  if(due&&due.length>120)throw new Error('Keep timing to 120 characters.');
  const target=quantity(values.target_count,'Target',{optional:true,minimum:1});
  const unit=target===null?null:String(values.unit||'').trim()||null;
  if(unit&&unit.length>60)throw new Error('Keep the unit to 60 characters.');
  const fields={title,due_text:due,target_count:target,unit};
  if(!task)return [{op:'add',temp_id:tempId,...fields}];
  if(task.status==='deleted')throw new Error('Restore this goal before editing it.');
  const changes=Object.fromEntries(Object.entries(fields).filter(([key,value])=>value!==(task[key]??null)));
  const count=target!==null&&task.status==='open'?quantity(values.completed_count,'Completed'):task.completed_count;
  if(target!==null&&count>target)throw new Error('Completed progress cannot exceed the target.');
  const edit=Object.keys(changes).length?{op:'edit',task_id:task.id,...changes}:null;
  const progress=target!==null&&task.status==='open'&&count!==task.completed_count?{op:'progress',task_id:task.id,completed_count:count}:null;
  // Lower progress before a smaller target; expand a target before increasing progress.
  return target!==null&&target<task.completed_count?[progress,edit].filter(Boolean):[edit,progress].filter(Boolean);
}

export function goalActionOperations(task, action, focusId=null) {
  if(action==='focus')return [{op:'focus',task_id:focusId===task.id?null:task.id}];
  if(!['complete','cancel','reopen','delete','restore'].includes(action))throw new Error('Choose a supported goal action.');
  return [{op:action,task_id:task.id}];
}

export function undoGoalOperations(task, action, focusId=null) {
  const restoreFocus=focusId===task.id?[{op:'focus',task_id:task.id}]:[];
  if(action==='delete')return [{op:'restore',task_id:task.id},...restoreFocus];
  if(action==='focus')return [{op:'focus',task_id:focusId}];
  if(action==='complete'||action==='cancel'){
    if(task.status==='open')return [{op:'reopen',task_id:task.id},...(task.target_count!==null?[{op:'progress',task_id:task.id,completed_count:task.completed_count}]:[]),...restoreFocus];
    return [{op:task.status==='completed'?'complete':'cancel',task_id:task.id}];
  }
  if(action==='reopen')return [{op:task.status==='completed'?'complete':'cancel',task_id:task.id}];
  return [];
}

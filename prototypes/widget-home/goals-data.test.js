import test from 'node:test';
import assert from 'node:assert/strict';
import { selectGoals, relatedSessions, deliveredCheckIns, observedSessions } from './goals-data.js';

const task = (id, status, title, extra = {}) => ({ id, status, title, ...extra });
const snapshot = (tasks, extra = {}) => ({ schema_version:2, tasks:{ revision:4, focus_id:'focus', break_active:true, tasks }, messages:[], ...extra });

test('goals filters, searches, orders the focused open task, and keeps an eligible selection', () => {
  const tasks=[task('later','open','Read algorithms',{due_text:'Friday'}),task('focus','open','Practice graphs',{target_count:3,completed_count:1,unit:'problems'}),task('done','completed','Submit outline'),task('cancel','cancelled','Old draft')];
  const state=snapshot(tasks), open=selectGoals(state,{query:'  graph ',selectedId:'focus'});
  assert.equal(open.supported,true); assert.deepEqual(open.items.map(item=>item.id),['focus']); assert.equal(open.selected.id,'focus');
  assert.deepEqual(open.counts,{open:2,completed:1,cancelled:1,all:4,deleted:0}); assert.equal(open.onBreak,true);
  assert.deepEqual(selectGoals(state,{filter:'completed'}).items.map(item=>item.id),['done']);
  assert.deepEqual(selectGoals(state,{filter:'all',query:'fri'}).items.map(item=>item.id),['later']);
});
test('selection falls back after completion and optional quantity never changes the task object', () => {
  const tasks=[task('focus','completed','Practice',{target_count:null,completed_count:0}),task('next','open','Next')];
  const state=snapshot(tasks,{tasks:{revision:4,focus_id:'focus',break_active:false,tasks}}), before=structuredClone(state);
  const value=selectGoals(state,{filter:'open',selectedId:'focus'});
  assert.equal(value.selected.id,'next'); assert.deepEqual(state,before);
});
test('unknown schemas and filters have no invented categories or selections', () => {
  const unsupported=selectGoals({schema_version:99,tasks:{tasks:[]}}); assert.equal(unsupported.supported,false); assert.equal(unsupported.selected,null);
  const tasks=[task('a','open','A')], value=selectGoals(snapshot(tasks),{filter:'cancelled'});
  assert.deepEqual(value.items.map(item=>item.id),['a']);
});
test('related sessions require current explicit task relation and complete approved session data', () => {
  const valid={id:'valid',origin:'https://leetcode.com',related_task_ids:['focus'],related_task_revision:4,observed_seconds:12,start:10,last_seen:30};
  const newest={id:'newest',origin:'https://docs.python.org',related_task_ids:['focus'],related_task_revision:4,observed_seconds:3,start:20,last_seen:40};
  const sessions=[valid,newest,{...valid,id:'stale',related_task_revision:3},{...valid,id:'foreign',related_task_ids:['other']},{...valid,id:'bad-origin',origin:'https://evil.example'},{...valid,id:'missing-time',last_seen:Infinity},{...valid,id:'unrelated',related_task_ids:[]}];
  const state=snapshot([task('focus','open','Focus')],{accountability:{observed_activity:{recent_sessions:sessions}}}), before=structuredClone(state);
  assert.deepEqual(relatedSessions(state,'focus').map(session=>session.id),['newest','valid']);
  assert.deepEqual(relatedSessions(state,'unrelated-task'),[]); assert.deepEqual(state,before);
});
test('delivered check-ins isolate only complete native check-in messages in existing order', () => {
  const state=snapshot([],{messages:[{id:'u',role:'user',text:'Hi'},{id:'a',role:'assistant',text:'Reply'},{id:'c1',role:'assistant',origin:'check_in',text:'First'},{id:'bad',role:'assistant',origin:'check_in',text:''},{id:'c2',role:'assistant',origin:'check_in',text:'Second'}]});
  assert.deepEqual(deliveredCheckIns(state).map(message=>message.id),['c2','c1']);
});

test('observed sessions remain visible without a goal link but reject impossible duration and unshared origins', () => {
  const valid={id:'unlinked',origin:'https://neetcode.io',start:10,last_seen:30,observed_seconds:12};
  const input={accountability:{observed_activity:{recent_sessions:[valid,{...valid,id:'too-long',observed_seconds:25},{...valid,id:'reversed',last_seen:9},{...valid,id:'unshared',origin:'https://example.test'}]}}};
  assert.deepEqual(observedSessions(input).map(item=>item.id),['unlinked']);
  assert.deepEqual(relatedSessions({...input,tasks:{revision:4}},'anything'),[]);
});

test('Trash stays out of active counts and is explicitly inspectable without mutating state',()=>{
  const tasks=[task('active','open','Current goal'),task('removed','deleted','Old goal',{target_count:4,completed_count:2})];
  const state=snapshot(tasks),before=structuredClone(state);
  assert.deepEqual(selectGoals(state,{filter:'all'}).items.map(item=>item.id),['active']);
  const trash=selectGoals(state,{filter:'deleted',selectedId:'removed'});
  assert.equal(trash.selected.id,'removed');assert.equal(trash.counts.deleted,1);assert.equal(trash.counts.all,1);assert.deepEqual(state,before);
});

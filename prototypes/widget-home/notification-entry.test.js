import {test} from 'node:test';
import assert from 'node:assert/strict';
import {notificationEntry} from './home-data.js';
test('notification opens only its existing assistant check-in in the current conversation',()=>{
  const message={id:'12',role:'assistant',origin:'check_in',event_id:'event-1',text:'A check-in'};
  const snapshot={conversation_id:'one',messages:[message]};
  const target={conversationId:'one',messageId:'12',eventId:'event-1'};
  assert.equal(notificationEntry(snapshot,target),message);
  for(const change of [{conversationId:'two'},{messageId:'13'},{eventId:'other'}])assert.equal(notificationEntry(snapshot,{...target,...change}),null);
  assert.equal(notificationEntry({...snapshot,messages:[{...message,origin:'user'}]},target),null);
  assert.equal(notificationEntry(null,target),null);
});

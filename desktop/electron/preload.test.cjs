const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'preload.cjs'),'utf8');
function load(location){
  let bridge,listener;const sent=[],invoked=[];
  vm.runInNewContext(source,{location,require:name=>{
    assert.equal(name,'electron');return {
      contextBridge:{exposeInMainWorld:(key,value)=>{assert.equal(key,'eiloDesktop');bridge=value;}},
      ipcRenderer:{on:(channel,fn)=>{assert.equal(channel,'eilo:open-check-in');listener=fn;},send:channel=>sent.push(channel),invoke:(channel,...args)=>{invoked.push([channel,...args]);return Promise.resolve({enabled:false,supported:true,error:false});},removeListener:()=>{listener=null;}},
    };
  }});
  return {get bridge(){return bridge;},deliver:value=>listener?.({privateNativeObject:true},value),sent,invoked};
}
test('only Home receives a narrow subscription; native event and extra payload do not cross the bridge',()=>{
  const host=load({origin:'http://127.0.0.1:8765',pathname:'/home/'}),received=[];
  assert.deepEqual(Object.keys(host.bridge),['openGoogleAuthorization','openBriefingAuthorization','openBriefingSource','getCheckInNotifications','setCheckInNotifications','onOpenCheckIn']);
  const unsubscribe=host.bridge.onOpenCheckIn(target=>received.push(target));
  assert.deepEqual(host.sent,['eilo:home-ready']);
  host.deliver({conversationId:'one',eventId:'two',messageId:'3',command:'ignored'});
  assert.equal(JSON.stringify(received),JSON.stringify([{conversationId:'one',messageId:'3',eventId:'two'}]));
  host.deliver({conversationId:'one',eventId:'file:///etc',messageId:'3'});
  assert.equal(received.length,1);unsubscribe();
  host.deliver({conversationId:'one',eventId:'four',messageId:'5'});
  assert.equal(received.length,1);
});
test('notification status bridge permits only booleans for the mutating channel',async()=>{
  const host=load({origin:'http://127.0.0.1:8765',pathname:'/home/'});
  assert.deepEqual(await host.bridge.getCheckInNotifications(),{enabled:false,supported:true,error:false});
  assert.deepEqual(await host.bridge.setCheckInNotifications(true),{enabled:false,supported:true,error:false});
  assert.deepEqual(await host.bridge.setCheckInNotifications('true'),{enabled:false,supported:true,error:false});
  assert.deepEqual(host.invoked,[
    ['eilo:check-in-notification-status'],
    ['eilo:set-check-in-notifications',true],
    ['eilo:check-in-notification-status'],
  ]);
});
test('other origins and local setup pages have no privileged bridge',()=>{
  assert.equal(load({origin:'https://example.test',pathname:'/home/'}).bridge,undefined);
  assert.equal(load({origin:'http://127.0.0.1:8765',pathname:'/activity-setup.html'}).bridge,undefined);
});

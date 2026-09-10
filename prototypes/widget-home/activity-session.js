import './activity-config.js';
import './activity-client.js';

export function createActivitySession(client) {
  const id = crypto.randomUUID();
  let allowed = false, leaseTimer = null, lastRenewal = 0, state = null;
  const headers = { 'X-Eilo-Client':'local-chat', 'Content-Type':'application/json' };
  const capable = () => typeof globalThis.chrome?.runtime?.connect === 'function';
  const owns = () => allowed && state?.state === 'active' && state.lease_client_id === id;
  function disconnect() {
    allowed = false; clearInterval(leaseTimer); leaseTimer = null;
    globalThis.EiloActivityBridge?.disconnect();
  }
  async function post(path, body) {
    const result = await fetch(path,{method:'POST',headers,body:JSON.stringify(body)});
    if (!result.ok) throw new Error('The Chrome connection stopped. Reconnect when you are ready.');
    return result.json();
  }
  async function renew() {
    if (!owns() || Date.now()-lastRenewal<2500) return;
    lastRenewal=Date.now();
    try { await post('/api/activity/lease',{client_id:id}); }
    catch { disconnect(); client.refresh(); }
  }
  function update(next) {
    state = next.snapshot?.accountability?.activity;
    if (!owns()) { if (allowed && state?.lease_client_id !== id) disconnect(); return; }
    if (!leaseTimer) leaseTimer=setInterval(renew,3000);
    renew(); globalThis.EiloActivityBridge?.update(state);
  }
  async function enable() {
    if (!capable()) throw new Error('Open the Chrome connection page to share approved activity. Home can stay open here.');
    const connected=globalThis.EiloActivityBridge.connect(globalThis.EILO_ACTIVITY_EXTENSION_ID,id,
      async(nonce,observation)=>{
        if (!owns()) return;
        try { await post('/api/activity/observation',{client_id:id,nonce,observation}); client.refresh(); }
        catch { client.refresh(); }
      },
      connected=>{ if (!connected && allowed) { disconnect(); client.activityControl('pause',id).catch(()=>{}); } });
    if (!connected.ok) throw new Error('The eïlo Chrome extension could not connect. Open its setup instructions.');
    allowed=true;
    try { await client.activityControl('enable',id); } catch(error) { disconnect(); throw error; }
  }
  async function control(action) { if(action==='enable')return enable(); disconnect(); return client.activityControl(action,id); }
  window.addEventListener('pagehide',()=>{
    const wasOwner=owns(); disconnect();
    if (wasOwner) fetch('/api/activity',{method:'POST',headers,body:JSON.stringify({action:'off',client_id:id}),keepalive:true}).catch(()=>{});
  });
  return {update,control,capable,owns};
}

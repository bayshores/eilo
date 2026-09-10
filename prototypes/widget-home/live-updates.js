import { createUpdateQueue } from './update-queue.js';

export function createLiveUpdates({openConversation, container=null, isConversationOpen=()=>false}) {
  const prefix='eilo:seen-check-ins:v1:';
  const queue=createUpdateQueue({
    loadSeen:id=>{try{const raw=localStorage.getItem(prefix+id);return raw===null?null:JSON.parse(raw);}catch{return null;}},
    saveSeen:(id,ids)=>{try{localStorage.setItem(prefix+id,JSON.stringify(ids));}catch{}},
  });
  const panel=document.createElement('aside');panel.className='live-update';panel.hidden=true;panel.setAttribute('aria-label','New update from eïlo');
  panel.innerHTML='<div class="live-update-heading"><span>eïlo</span><span class="live-update-state"></span><button class="icon-button live-update-dismiss" aria-label="Dismiss this update">×</button></div><p class="live-update-text"></p><div class="live-update-footer"><button class="text-button live-update-open">Reply</button><span class="live-update-count"></span></div>';
  (container || document.querySelector('.app-window')).append(panel);
  const announce=document.createElement('div');announce.className='sr-only';announce.setAttribute('role','status');document.body.append(announce);
  let latest=null,timer=null,shownId=null,finishedId=null,paused=false;
  function dismiss(){clearTimeout(timer);queue.dismiss();shownId=null;finishedId=null;render();}
  panel.querySelector('.live-update-dismiss').addEventListener('click',dismiss);
  panel.querySelector('.live-update-open').addEventListener('click',()=>{openConversation();dismiss();});
  panel.addEventListener('pointerenter',()=>{paused=true;clearTimeout(timer);});
  panel.addEventListener('pointerleave',()=>{paused=false;schedule();});
  panel.addEventListener('focusin',()=>{paused=true;clearTimeout(timer);});
  panel.addEventListener('focusout',()=>{paused=false;schedule();});
  function schedule(){
    clearTimeout(timer);const active=queue.snapshot().active;
    if(active?.status==='complete'&&!paused&&!panel.contains(document.activeElement)&&visible())timer=setTimeout(dismiss,Math.max(12000,Math.min(30000,active.text.length*65)));
  }
  const visible=()=>document.visibilityState==='visible'&&!document.querySelector('dialog[open]')&&!isConversationOpen();
  function render(){
    const value=queue.snapshot(),active=value.active,wasHidden=panel.hidden;
    panel.hidden=!active||!visible();
    if(panel.hidden){clearTimeout(timer);return;}
    if(shownId!==active.id){shownId=active.id;finishedId=null;queue.markDisplayed(active.id);announce.textContent='A new update from eïlo is appearing.';}
    panel.querySelector('.live-update-text').textContent=active.text;
    panel.querySelector('.live-update-state').textContent=active.status==='writing'?'Writing…':'';
    panel.querySelector('.live-update-count').textContent=value.queued.length?`${value.queued.length} more`:'';
    panel.classList.toggle('is-writing',active.status==='writing');
    if(active.status==='complete'&&finishedId!==active.id){finishedId=active.id;announce.textContent=active.text;schedule();}
    else if(wasHidden&&active.status==='complete')schedule();
  }
  function update(state){
    latest=state;
    queue.reconcile({conversationId:state.snapshot?.conversation_id,messages:state.snapshot?.messages,
      stream:state.snapshot?.accountability?.check_in_stream,visible:visible()});
    render();
  }
  document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(latest)update(latest);if(document.visibilityState==='visible')schedule();});
  document.addEventListener('close',()=>{if(latest)update(latest);},true);
  const dialogs=new MutationObserver(()=>{if(latest)update(latest);});
  document.querySelectorAll('dialog').forEach(dialog=>dialogs.observe(dialog,{attributes:true,attributeFilter:['open']}));
  window.addEventListener('storage',event=>{if(event.key?.startsWith(prefix)&&latest)update(latest);});
  return {update};
}

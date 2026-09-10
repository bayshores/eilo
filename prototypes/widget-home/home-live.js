import {mountCalendarConnection} from './calendar-connection.js';
import {calendarAgenda,calendarTime} from './calendar-agenda.js';
import {createWorkspaceViews} from './workspace-views.js';
import { createHomeClient } from './home-client.js';
import { createActivitySession } from './activity-session.js';
import { createLiveUpdates } from './live-updates.js';
import { mountSpeechInput } from './speech-input.js';
import { mountWorkflowProgress } from './workflow-progress.js';
import { mountBriefingSources } from './briefing-sources.js';
import { mountConnectionsManager } from './connections-manager.js';
import { mountChatLibrary } from './chat-library.js';
import { mountChatSwitcher } from './chat-switcher.js';
import { localCommand, commandMatches } from './local-commands.js';
import { homeData, progressText, conversationEntries, deliveryLabel, notificationEntry } from './home-data.js';
import {checkinView} from './checkin-data.js';

const LIVE_TYPES = new Set(['today', 'goals', 'progress', 'conversation']);
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const action = (label, handler, className = 'text-button') => {
  const button = node('button', className, label); button.type = 'button'; button.addEventListener('click', handler); return button;
};

export function createLiveHome({ openDetail, refreshWidgets, dialog, onViewChange=()=>{} }) {
  let storage = null;
  try { storage = sessionStorage; } catch { /* In-page drafts still work. */ }
  const client = createHomeClient({ storage });
  let current = client.view, fingerprint = '', messageFingerprint = '', detailFingerprint = '', speech = null;
  const activity = createActivitySession(client);
  const dock = node('section', 'conversation-dock');
  dock.setAttribute('aria-label', 'Talk to eïlo');
  dock.dataset.open = 'false';
  document.querySelector('.workspace').append(dock);
  let threadOpen = false, desktopNotice = '';
  let stopDesktop = null, calendarPanel = null, briefingSourcesPanel = null, workflowPanel = null;
  let dismissedWorkflowRunId = '';
  const workflowHost = node('div', 'workflow-progress-host'); workflowHost.hidden = true;
  dock.append(workflowHost);
  dialog.addEventListener('close',()=>{calendarPanel?.destroy();calendarPanel=null;briefingSourcesPanel?.destroy();briefingSourcesPanel=null;});
  const updates = createLiveUpdates({openConversation:()=>talk(), container:dock, isConversationOpen:()=>threadOpen});
  const workspace=document.querySelector('.workspace'),board=document.querySelector('.board-scroll');
  const pages=node('div','workspace-page');pages.hidden=true;board.after(pages);
  const header=document.querySelector('.home-header h1');header.tabIndex=-1;
  let currentPage='home';
  let connectionsPanel=null, libraryPanel=null, quickChats=null, connectionsRevision=null, commandsHidden=false;
  const views=createWorkspaceViews({container:pages,onDiscuss:text=>talk(text),onConnections:()=>openDetail('connections'),onActivity:()=>showPage('activity'),onManage:(operations,revision,context)=>client.controlTasks(operations,revision,context),onRecord:(action,id,revision,context)=>client.controlRecord(action,id,revision,context),canManage:()=>client.canManage(),onReply:message=>talk(`About your check-in “${message.text}”: `),
    onCheckinToggle:enabled=>client.activityControl(enabled?'enable_check_ins':'pause_check_ins',crypto.randomUUID()),
    onActivitySetup:()=>openDetail('browser-setup')});
  const connectionsHost=node('div','connections-page'),libraryHost=node('div','library-page');
  connectionsHost.hidden=true;libraryHost.hidden=true;pages.append(connectionsHost,libraryHost);
  function ensureConnections() {
    if(!connectionsPanel) connectionsPanel=mountConnectionsManager(connectionsHost,{
      mountCalendar:(host,options)=>{
        const connection=node('div'),sharing=node('div');host.append(connection,sharing);
        const calendar=mountCalendarConnection(connection,options);
        const consent=mountBriefingSources(sharing,{...options,section:'calendar'});
        return {destroy(){calendar.destroy();consent.destroy();}};
      },mountBriefingSources:(host,options)=>mountBriefingSources(host,{...options,section:'gmail'}),
      openGoogleAuthorization,openBriefingAuthorization,
      onActivitySetup:()=>openDetail('browser-setup'),
      onChanged:next=>{connectionsRevision=next.revision;client.refresh();},
    });
    else connectionsPanel.refresh({quiet:true});
  }
  function ensureLibrary() {
    if(!libraryPanel) libraryPanel=mountChatLibrary(libraryHost,{
      canManage:()=>client.canManage(),
      onChanged:next=>client.acceptWorkspace(next),
      onActivate:()=>{messageFingerprint='';showPage('home');talk();},
    });
    libraryPanel.update(current.snapshot);libraryPanel.show();
  }
  function showPage(page,{goalFilter,connectionsTab,activityTab,push=true,focus=true}={}) {
    if(!['home','goals','activity','connections','chats','projects'].includes(page))return;
    onViewChange(page);if(dialog.open)dialog.close();setThreadOpen(false);
    currentPage=page;workspace.dataset.page=page;
    board.hidden=page!=='home';pages.hidden=page==='home';views.show(page,{goalFilter,activityTab});
    connectionsHost.hidden=page!=='connections';libraryHost.hidden=!['chats','projects'].includes(page);
    if(page==='connections'){ensureConnections();connectionsPanel.show({tab:connectionsTab||'all'});}
    if(['chats','projects'].includes(page))ensureLibrary();
    document.querySelector('.home-header').hidden=['connections','chats','projects'].includes(page);
    header.textContent={home:'Home',goals:'Goals',activity:'Activity',connections:'Connections',chats:'Chats',projects:'Projects'}[page];document.title=`eïlo — ${header.textContent}`;document.querySelector('.app-window').setAttribute('aria-label',`eïlo ${header.textContent}`);
    document.querySelector('.home-header p').hidden=page!=='home';
    for(const item of document.querySelectorAll('.nav-item')){
      const active=item.dataset.detail===(page==='projects'?'chats':page);item.classList.toggle('active',active);
      if(active)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');
    }
    for(const selector of ['.edit-toggle','.add-toggle','.save-state','.overflow-toggle']){
      const item=document.querySelector(selector);
      if(page!=='home')item.hidden=true;else if(selector==='.edit-toggle')item.hidden=false;
    }
    if(push){const next=location.pathname+location.search+(page==='home'?'':'#'+page);if(location.pathname+location.search+location.hash!==next)history.pushState(null,'',next);}
    if(focus){const target=['connections','chats','projects'].includes(page)?pages.querySelector(page==='connections'?'.connections-manager h1':'.chat-library h1'):header;if(target){target.tabIndex=-1;target.focus({preventScroll:true});}}
  }
  function restorePage(){const page=location.hash.slice(1);showPage(['goals','activity','connections','chats','projects'].includes(page)?page:'home',{push:false,focus:false});}

  async function runCommand(text) {
    const command=localCommand(text);
    if(!command){desktopNotice='Unknown shortcut. Type / to see available commands.';renderConversation(dock);return;}
    if(command.command==='/new'&&!client.canManage()){desktopNotice='Wait for this reply before starting a new chat.';renderConversation(dock);return;}
    const previousDraft=current.draft;client.setDraft('');commandsHidden=true;desktopNotice='';
    try {
      if(command.page)showPage(command.page,{connectionsTab:command.command==='/mcp'?'mcps':'all'});
      else {await client.controlCatalog('new_chat');messageFingerprint='';showPage('home');talk();}
    }catch(error){client.setDraft(previousDraft);desktopNotice=error.message;}
    renderConversation(dock);
  }
  function renderCommands() {
    const host=dock.querySelector('.local-commands');if(!host)return;
    const items=commandMatches(current.draft);host.hidden=commandsHidden||!items.length;
    const signature=JSON.stringify(items);if(host.dataset.signature===signature)return;
    host.dataset.signature=signature;host.replaceChildren();
    for(const item of items){const choice=action('',()=>runCommand(item.command),'local-command');choice.append(node('strong','',item.command),node('span','',item.label));host.append(choice);}
  }

  function setThreadOpen(open) {
    threadOpen = open;
    dock.dataset.open = String(open);
    const thread = dock.querySelector('.conversation-thread');
    const toggle = dock.querySelector('.dock-history');
    if (thread) thread.hidden = !open;
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.querySelector('span').textContent = open ? 'Hide replies' : 'Show replies';
      toggle.setAttribute('aria-label',open?'Hide replies':'Show replies');toggle.title=open?'Hide replies':'Show replies';
    }
    if (open) {
      const log = dock.querySelector('.live-messages');
      if (log) requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
    }
    if (current.snapshot) updates.update(current);
  }
  const data = () => homeData(current.snapshot);
  function talk(text) {
    if (text && !current.draft) client.setDraft(text);
    if (dialog.open) dialog.close();
    setThreadOpen(true);
    dock.querySelector('.live-input')?.focus();
  }
  const openGoogleAuthorization = async url => {
    if(window.eiloDesktop?.openGoogleAuthorization) return window.eiloDesktop.openGoogleAuthorization(url);
    const target=new URL(url);
    if(target.origin!=='https://accounts.google.com'||target.pathname!=='/o/oauth2/v2/auth')return false;
    return !!window.open(url,'_blank','noopener,noreferrer');
  };
  const openBriefingAuthorization = async url => {
    if(window.eiloDesktop?.openBriefingAuthorization) return window.eiloDesktop.openBriefingAuthorization(url);
    return openGoogleAuthorization(url);
  };
  const openBriefingSource = async (run, source) => {
    const url = new URL(source.url);
    if(url.protocol!=='https:'||!['https://mail.google.com','https://calendar.google.com'].includes(url.origin)) return true;
    if(window.eiloDesktop?.openBriefingSource) return window.eiloDesktop.openBriefingSource(run.id,source.id);
    return false;
  };
  const clearWorkflow = () => { workflowPanel?.destroy(); workflowPanel=null; workflowHost.hidden=true; };
  const cancelWorkflow = async run => {
    try {
      const response = await fetch('/api/workflow/cancel',{method:'POST',headers:{'Content-Type':'application/json','X-Eilo-Client':'local-chat'},body:JSON.stringify({request_id:run.id})});
      if(!response.ok) throw new Error('Briefing cancellation could not be confirmed.');
      await client.refresh();
    } catch(error) { desktopNotice=error.message||'Briefing cancellation could not be confirmed.'; renderConversation(dock); }
  };
  function renderWorkflow(run) {
    if(!run || dismissedWorkflowRunId===run.id) { clearWorkflow(); return; }
    if(!workflowPanel) workflowPanel=mountWorkflowProgress(workflowHost,{
      onCancel:cancelWorkflow,
      onConnect:()=>openDetail('connections'),
      onOpenSource:openBriefingSource,
      onDismiss:finished=>{ if(['completed','partial','failed','cancelled','interrupted'].includes(finished.status)) { dismissedWorkflowRunId=finished.id; clearWorkflow(); } },
    });
    workflowHost.hidden=false;workflowPanel.update(run);
  }
  function empty(container, heading, description) {
    container.append(node('h2', '', heading), node('p', 'live-empty', description));
    container.append(action('Talk to eïlo', () => talk(), 'button live-bottom'));
  }
  function taskRow(task, { due = false, focus = false } = {}) {
    const row = node('div', 'live-task');
    if (due) row.append(node('span', 'live-due', task.due_text || 'Flexible'));
    const copy = node('div', 'live-task-copy');
    copy.append(node('strong', '', task.title));
    const parts = [focus ? 'Current focus' : task.status === 'completed' ? 'Completed' : task.status === 'cancelled' ? 'Cancelled' : '', progressText(task)];
    if (!due && task.due_text) parts.push(task.due_text);
    const label = parts.filter(Boolean).join(' · ');
    if (label) copy.append(node('span', 'live-task-meta', label));
    row.append(copy); return row;
  }
  function miniMessage(entry) {
    const row = node('div', `live-snippet live-snippet-${entry.role}${entry.preview?' live-writing-preview':''}`);
    if(entry.preview)row.setAttribute('aria-live','off');
    if (entry.id) row.dataset.messageId = entry.id;
    row.append(node('span', 'live-speaker', entry.role === 'user' ? 'You' : entry.origin === 'check_in' ? 'eïlo check-in' : 'eïlo'));
    row.append(node('p', '', entry.text));
    if (entry.delivery) row.append(node('span', 'live-delivery', deliveryLabel(entry.delivery)));
    return row;
  }
  function renderBody(widget, container) {
    if (!LIVE_TYPES.has(widget.type)) return false;
    container.replaceChildren(); container.classList.add('live-content');
    const { snapshot, connection } = current;
    const value = data();
    if (!value.supported) {
      empty(container, widget.type === 'conversation' ? 'eïlo' : { today: 'Today', goals: 'Your goals', progress: 'Progress' }[widget.type], connection === 'loading' ? 'Connecting to your workspace…' : 'The local workspace is unavailable. Your saved information is kept.');
      return true;
    }
    if (widget.type === 'today') {
      const calendar=snapshot.integrations?.google_calendar,agenda=calendarAgenda(calendar);
      if (agenda.length) {
        container.append(node('h2','','Today'),node('p','widget-subtitle',calendar.state==='paused'?'Calendar sync paused':calendar.error?'Calendar · last synced view':'From your calendars'));
        const list=node('div','live-agenda');
        agenda.slice(0,3).forEach(event=>{
          const row=node('div','live-task calendar-agenda-row');
          row.append(node('span','live-task-time',calendarTime(event)),node('strong','',event.title));
          row.title=event.calendar_name;list.append(row);
        });
        container.append(list,action('View day',()=>openDetail('calendar-day'),'text-button live-bottom'));
        return true;
      }
      if (!value.open.length) { empty(container, 'Today', 'Tell eïlo what you have coming up. Your commitments will appear here.'); return true; }
      container.append(node('h2', '', 'Today'), node('p', 'widget-subtitle', value.onBreak ? 'On a break' : 'Open commitments'));
      const list = node('div', 'live-agenda');
      value.open.slice(0, 3).forEach(task => list.append(taskRow(task, { due: true })));
      container.append(list, action(value.open.length > 3 ? `View all ${value.open.length}` : 'See commitments', () => openDetail('today'), 'text-button live-bottom'));
    } else if (widget.type === 'goals') {
      if (!value.open.length) { empty(container, 'Your goals', 'A place for the things you want to move forward. Start with a conversation.'); return true; }
      container.append(node('h2', '', 'Your goals'));
      container.append(node('p', 'widget-subtitle', value.onBreak ? 'On a break' : 'Saved commitments'));
      const group = node('div', 'live-goals');
      const shown = value.focus ? [value.focus, ...value.open.filter(task => task !== value.focus)].slice(0, 2) : value.open.slice(0, 2);
      shown.forEach(task => group.append(taskRow(task, { focus: task === value.focus })));
      container.append(group, action(`See ${value.open.length === 1 ? 'goal' : `all ${value.open.length} goals`}`, () => openDetail('goals'), 'text-button live-bottom'));
    } else if (widget.type === 'progress') {
      const observed=snapshot.accountability?.observed_activity;
      const session=observed?.active_session||observed?.recent_sessions?.at(-1);
      if(session){
        container.append(node('h2','','Progress'));
        const duration=node('div','practice-count'),minutes=Math.floor(session.observed_seconds/60);
        duration.append(node('strong','',String(minutes||Math.floor(session.observed_seconds))),node('span','',minutes?(minutes===1?'minute observed':'minutes observed'):(Math.floor(session.observed_seconds)===1?'second observed':'seconds observed')));
        container.append(duration,node('p','live-progress-copy',new URL(session.origin).hostname),node('p','live-progress-copy',`${value.completed.length} commitment${value.completed.length===1?'':'s'} completed`),action('See activity',()=>openDetail('activity'),'text-button live-bottom'));
        return true;
      }
      container.append(node('h2', '', 'Progress'));
      const count = node('div', 'practice-count');
      count.append(node('strong', '', String(value.completed.length)), node('span', '', value.completed.length === 1 ? 'commitment completed' : 'commitments completed'));
      container.append(count);
      const tracked = value.open.filter(task => progressText(task));
      if (tracked.length) {
        const task = tracked.find(task => task.id === value.focus?.id) || tracked[0];
        const copy = node('div', 'live-progress-copy');
        copy.append(node('strong', '', progressText(task)), node('p', '', task.title));
        const meter = node('progress', 'live-meter'); meter.max = task.target_count; meter.value = task.completed_count; meter.setAttribute('aria-label', `${task.title}: ${progressText(task)}`);
        container.append(copy, meter);
      } else container.append(node('p', 'live-progress-copy', 'Progress you share with eïlo is saved with your commitments.'));
      container.append(action('See progress', () => openDetail('progress'), 'text-button live-bottom'));
    } else {
      container.append(node('h2', '', 'eïlo'));
      const entries = conversationEntries(snapshot, current.localPending);
      const snippet = node('div', 'live-snippets');
      entries.slice(-2).forEach(entry => snippet.append(miniMessage(entry)));
      if (!entries.length) snippet.append(node('p', 'live-empty', 'What would you like to make progress on?'));
      container.append(snippet, action(snapshot.status === 'busy' ? 'View conversation' : 'Message eïlo', () => talk(), 'button live-bottom'));
    }
    return true;
  }
  function renderConversation(body) {
    if (!body.querySelector('.live-chat')) {
      messageFingerprint = '';
      const chat = node('div', 'live-chat');
      const thread = node('div', 'conversation-thread'); thread.id = 'eilo-conversation-thread'; thread.hidden = !threadOpen;
      const log = node('div', 'live-messages'); log.setAttribute('role', 'log'); log.setAttribute('aria-label', 'Conversation'); log.setAttribute('aria-live', 'polite'); log.tabIndex = 0;
      const close=action('×',()=>setThreadOpen(false),'conversation-close');close.setAttribute('aria-label','Close conversation');
      close.addEventListener('click',()=>input.focus());
      thread.append(log,close);
      const form = node('form', 'live-composer');
      const label = node('label', 'sr-only', 'Message eïlo'); label.htmlFor = 'live-message-input';
      const input = node('textarea', 'live-input'); input.id = label.htmlFor; input.placeholder = 'Tell eïlo what’s on your mind…'; input.maxLength = 12000; input.rows = 1;
      const fitInput = () => { input.style.height = 'auto'; input.style.height = Math.min(100, Math.max(28, input.scrollHeight)) + 'px'; };
      input.addEventListener('input', () => { commandsHidden=false;fitInput();client.setDraft(input.value); });
      input.addEventListener('keydown', event => {
        if(event.key==='ArrowDown'&&!commands.hidden){event.preventDefault();commands.querySelector('button')?.focus();}
        if(event.key==='Escape'&&!commands.hidden){event.preventDefault();commandsHidden=true;renderCommands();}
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
      });
      const footer = node('div', 'live-composer-footer');
      footer.append(node('span', 'live-chat-status'));
      const send = node('button', 'button primary live-send', 'Send'); send.type = 'submit'; footer.append(send);
      const commands=node('div','local-commands');commands.hidden=true;commands.setAttribute('role','group');commands.setAttribute('aria-label','Chat shortcuts');
      commands.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();commandsHidden=true;renderCommands();input.focus();}});
      form.append(commands,label, input, footer);
      form.addEventListener('submit', event => { event.preventDefault();if(current.draft.trim().startsWith('/')){void runCommand(current.draft);return;} if (!client.canSend()) return; setThreadOpen(true); client.send(); });
      const status = node('p', 'live-chat-error'); status.setAttribute('role', 'status'); status.hidden = true;
      const controls = node('div', 'live-recovery');
      controls.append(action('Check connection', () => client.refresh(), 'button live-retry'), action('Recover saved reply', () => client.recover(), 'button live-recover'), action('Return to draft', () => client.returnToDraft(), 'button live-return-draft'));
      chat.append(thread, form, status, controls); body.append(chat);
      speech=mountSpeechInput(form,client);
      const toggle = action('', () => setThreadOpen(!threadOpen), 'dock-history');
      toggle.setAttribute('aria-controls', thread.id); toggle.setAttribute('aria-expanded', String(threadOpen));
      toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10h8M8 14h5M21 11a9 9 0 0 1-9 9 10 10 0 0 1-4-1l-5 2 2-5a9 9 0 1 1 16-5Z"/></svg><span class="sr-only">Show replies</span>';
      toggle.setAttribute('aria-label','Show replies');toggle.title='Show replies';
      form.querySelector('.speech-actions').prepend(toggle);
      quickChats=mountChatSwitcher(form.querySelector('.speech-actions'),{
        canManage:()=>client.canManage(),onBrowse:()=>showPage('chats'),
        onSwitch:async chatId=>{await client.controlCatalog('switch_chat',{chat_id:chatId});messageFingerprint='';talk();},
        onNew:async()=>{await client.controlCatalog('new_chat');messageFingerprint='';talk();},
      });
      body.addEventListener('keydown', event => {
        if (event.key === 'Escape' && threadOpen && !event.defaultPrevented) {
          event.preventDefault(); event.stopPropagation(); setThreadOpen(false); input.focus();
        }
      });
    }
    const entries = conversationEntries(current.snapshot, current.localPending);
    const liveReply=current.snapshot?.reply_stream;
    const liveCheckIn=current.snapshot?.accountability?.check_in_stream;
    const streamEntry=liveReply?.status==='writing'&&liveReply.text?{id:'preview-'+liveReply.id,role:'assistant',text:liveReply.text,preview:true}
      :liveCheckIn?.status==='writing'&&liveCheckIn.text?{id:'preview-event-'+liveCheckIn.id,role:'assistant',text:liveCheckIn.text,origin:'check_in',preview:true}:null;
    const log = body.querySelector('.live-messages');
    const nextFingerprint = JSON.stringify(entries);
    if (messageFingerprint !== nextFingerprint) {
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 70;
      const oldScroll = log.scrollTop;
      log.replaceChildren();
      if (!entries.length) log.append(node('p', 'live-empty', 'Tell eïlo what matters to you. You can add commitments, share progress or correct something in your own words.'));
      entries.forEach(entry => log.append(miniMessage(entry)));
      if (!messageFingerprint || atBottom) log.scrollTop = log.scrollHeight; else log.scrollTop = oldScroll;
      messageFingerprint = nextFingerprint;
    }
    const priorPreview=log.querySelector('.live-writing-preview');
    if(streamEntry){
      const atBottom=log.scrollHeight-log.scrollTop-log.clientHeight<70;
      if(priorPreview)priorPreview.querySelector('p').textContent=streamEntry.text;
      else log.append(miniMessage(streamEntry));
      if(atBottom)log.scrollTop=log.scrollHeight;
    }else priorPreview?.remove();
    const input = body.querySelector('.live-input');
    if (input.value !== current.draft) { input.value = current.draft; input.style.height = 'auto'; input.style.height = Math.min(100, Math.max(28, input.scrollHeight)) + 'px'; }
    const command=localCommand(current.draft);
    body.querySelector('.live-send').disabled=command?command.command==='/new'&&!client.canManage():!client.canSend();
    body.querySelector('.live-send').textContent=command?'Open':'Send';
    renderCommands();
    quickChats?.update(current.snapshot);
    const busy = current.snapshot?.status === 'busy';
    body.querySelector('.live-chat-status').classList.toggle('is-idle',!busy&&!current.sending&&current.connection==='connected');
    body.querySelector('.live-chat-status').textContent = current.sending ? 'Sending…' : busy ? 'eïlo is replying…' : current.connection === 'loading' ? 'Connecting…' : current.connection === 'offline' ? 'Reconnecting…' : 'Enter to send · Shift + Enter for a new line';
    const unconfirmed = current.localPending?.status === 'unconfirmed';
    const status = body.querySelector('.live-chat-error');
    status.textContent = desktopNotice || current.error || (unconfirmed ? 'Delivery could not be confirmed. Check the conversation before sending again.' : current.snapshot?.error || ''); status.hidden = !status.textContent;
    body.querySelector('.live-retry').hidden = current.connection === 'connected' && !unconfirmed;
    body.querySelector('.live-retry').disabled = current.sending;
    body.querySelector('.live-recover').hidden = !current.snapshot?.recovery_pending;
    body.querySelector('.live-recover').disabled = busy || current.sending || current.connection !== 'connected';
    body.querySelector('.live-return-draft').hidden = !unconfirmed;
    body.querySelector('.live-return-draft').disabled = busy || current.sending || current.connection !== 'connected';
  }
  function renderDetail(type, title, body) {
    if (!['today', 'goals', 'progress', 'activity', 'browser-setup','calendar-day'].includes(type)) return false;
    title.textContent = ({ today: 'Your commitments', goals: 'Your goals', progress: 'Your progress', conversation: 'eïlo', activity: 'Conversation updates', connections: 'Connections & privacy' })[type];
    if(type==='browser-setup' && body.querySelector('.chrome-connection-body')) {
      title.textContent='Browser activity';
      renderChromeConnection(body.querySelector('.chrome-connection-body'));
      return true;
    }
    calendarPanel?.destroy();calendarPanel=null;briefingSourcesPanel?.destroy();briefingSourcesPanel=null;
    body.replaceChildren();
    const value = data();
    if (!value.supported) { body.append(node('p', '', 'Waiting for your local workspace.'), action('Check connection', () => client.refresh(), 'button')); return true; }
    if (type === 'browser-setup') {
      title.textContent='Browser activity';
      const chromeBody=node('div','chrome-connection-body');body.append(chromeBody);renderChromeConnection(chromeBody);
    } else if (type === 'calendar-day') {
      title.textContent='Your day';
      const calendar=current.snapshot.integrations?.google_calendar,events=calendarAgenda(calendar);
      body.append(node('p','muted',calendar?.state==='paused'?'Calendar sync is paused. These are your last synced events.':'Upcoming events from your selected calendars.'));
      const list=node('div','calendar-day-list');
      events.forEach(event=>{const row=node('div','calendar-day-event');row.append(node('span','',calendarTime(event)),node('strong','',event.title),node('small','muted',event.calendar_name));list.append(row);});
      if(!events.length)list.append(node('p','','No more calendar events today.'));
      body.append(list,action('Calendar connection',()=>openDetail('connections'),'button'));
    } else if (type === 'activity') {
      title.textContent='Observed activity';
      const journal=current.snapshot.accountability?.observed_activity,sessions=journal?.recent_sessions||[];
      body.append(node('p','muted','A record of approved browser activity. Observed time does not establish attention or task completion.'));
      if(!sessions.length)body.append(node('p','live-empty','No activity recorded yet. Connect an approved source to let eïlo build this view automatically.'),action('Connections & privacy',()=>openDetail('connections'),'button'));
      const list=node('div','observed-sessions');
      [...sessions].reverse().slice(0,20).forEach(session=>{
        const item=node('div','observed-session'),minutes=Math.floor(session.observed_seconds/60),duration=minutes?`${minutes} min observed`:`${Math.floor(session.observed_seconds)} sec observed`;
        item.append(node('strong','',new URL(session.origin).hostname),node('p','',`${duration} · ${new Date(session.start*1000).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}${session.end===null?' · ongoing':''}`));
        if(session.related_task_revision===current.snapshot.tasks.revision){const names=(session.related_task_ids||[]).map(id=>value.tasks.find(task=>task.id===id)?.title).filter(Boolean);if(names.length)item.append(node('p','',`May relate to ${names.join(', ')}`));}
        list.append(item);
      });
      body.append(list,action('Open conversation',()=>talk(),'button live-bottom'));
    } else {
      const tasks = type === 'today' ? value.open : type === 'progress' ? value.tasks.filter(task => task.status === 'completed' || (task.status === 'open' && progressText(task))) : value.tasks;
      body.append(node('p', 'muted', value.onBreak ? 'You are on a break. Your commitments are kept.' : type === 'progress' ? 'Saved progress across your commitments.' : 'Tell eïlo when something changes. It keeps this view in sync.'));
      const list = node('div', 'live-detail-tasks'); tasks.forEach(task => list.append(taskRow(task, { focus: task.id === value.focus?.id })));
      if (!tasks.length) list.append(node('p', 'live-empty', type === 'progress' ? 'No progress recorded yet.' : 'No saved commitments here yet.'));
      body.append(list, action('Talk to eïlo', () => talk(), 'button live-bottom'));
    }
    return true;
  }
  function renderChromeConnection(body) {
    if(!body)return;
    const source=current.snapshot.accountability?.activity||{},sharing=source.state||'unknown';
    const signature=JSON.stringify([sharing,source.helper_available,activity.capable()]);
    if(body.dataset.signature===signature)return;body.dataset.signature=signature;body.replaceChildren();
    body.append(node('p','',`Chrome activity is ${sharing}.`),node('p','muted','Share approved active-site names and titles with eïlo. It can remember observed sessions and use that context for check-ins. Page visits do not count as completed tasks.'));
    body.append(node('p','muted','Available sites: LeetCode, NeetCode and Python documentation. Choose grants in the eïlo Chrome extension. The activity summary retains normalized site names and observed sessions for seven days; page titles are excluded from that summary. Admitted model observations remain in the local conversation runtime.'));
    const actions=node('div','connection-actions'),feedback=node('p','connection-feedback');feedback.setAttribute('role','status');
    const run=async(actionName)=>{try{feedback.textContent='';await activity.control(actionName);}catch(error){feedback.textContent=error.message;}};
    if(activity.capable()){
      const enable=action('Connect Chrome activity',()=>run('enable'),'button primary');enable.disabled=sharing==='active'||!source.helper_available;actions.append(enable);
    }else{
      body.append(node('p','muted','Open the connection page in Chrome and leave it open while sharing. You can keep using Home in this browser.'));
      actions.append(action('Copy Chrome connection link',async()=>{try{await navigator.clipboard.writeText(location.origin+'/activity-connect');feedback.textContent='Copied. Open that address in Chrome, then enable activity there.';}catch{feedback.textContent=location.origin+'/activity-connect';}},'button'));
    }
    if(sharing==='active')actions.append(action('Pause sharing',()=>run('pause'),'button'));
    if(sharing!=='off')actions.append(action('Turn off',()=>run('off'),'button'));
    const setup=node('a','text-button','Extension setup');setup.href='/activity-setup.html';actions.append(setup);body.append(actions,feedback);
    body.append(node('p','muted','Sharing stops when its connection page closes or loses its lease. Microphone recording is separate and starts only when you use Speak.'));
  }
  function start() {
    document.title = 'eïlo — Home';
    document.querySelector('.app-window').setAttribute('aria-label', 'eïlo Home');
    document.querySelector('.account-name span').textContent = 'Local profile';
    for(const item of document.querySelectorAll('.nav-item')){
      if(['today','progress'].includes(item.dataset.detail)){item.remove();continue;}
      const name={home:'Home',goals:'Goals',activity:'Activity'}[item.dataset.detail];
      item.setAttribute('aria-label',name);item.title=name;item.append(node('span','nav-label',name));
    }
    for(const [page,label,icon] of [['chats','Chats','chat'],['connections','Connect','sliders']]){
      const item=action('',()=>showPage(page),'nav-item');item.dataset.detail=page;item.setAttribute('aria-label',page==='chats'?'Chats and projects':'Connections');item.title=page==='chats'?'Chats and projects':'Connections';
      item.innerHTML=`<svg aria-hidden="true"><use href="#${icon}"/></svg>`;item.append(node('span','nav-label',label));document.querySelector('.nav-items').append(item);
    }
    renderConversation(dock);
    // A different modal must never hide an active microphone control.
    const modalCapture = new MutationObserver(() => {
      if (document.querySelector('dialog[open]')) speech?.cancel();
    });
    document.querySelectorAll('dialog').forEach(element => modalCapture.observe(element, {attributes:true, attributeFilter:['open']}));
    const headline = document.querySelector('.home-header p'); headline.setAttribute('role', 'status');
    const context=node('div','home-context');headline.before(context);context.append(headline);
    const activityButton=action('Check-in status',()=>showPage('activity',{activityTab:'overview'}),'activity-chip agent-status-chip');context.append(activityButton);
    client.subscribe(next => {
      current = next; activity.update(next); updates.update(next); views.update(next);
      libraryPanel?.update(next.snapshot);
      if(currentPage==='connections'&&next.snapshot?.connections_revision!==connectionsRevision){connectionsRevision=next.snapshot?.connections_revision;connectionsPanel?.refresh({quiet:true});}
      const checkins=checkinView(next);activityButton.textContent=checkins.chip;activityButton.dataset.tone=checkins.tone;activityButton.setAttribute('aria-label',`${checkins.chip}. Open check-in status`);activityButton.title=checkins.description;
      const value = data();
      headline.textContent = next.connection === 'loading' ? 'Connecting to your workspace…'
        : next.connection === 'offline' ? 'Reconnecting · saved state shown'
        : next.snapshot?.recovery_pending ? 'A saved reply needs recovery'
        : next.snapshot?.status === 'error' ? 'Conversation needs attention'
        : value.onBreak ? 'On a break'
        : `${value.open.length} open commitment${value.open.length === 1 ? '' : 's'}`;
      renderWorkflow(next.snapshot?.workflow_run ?? null);
      const nextFingerprint = JSON.stringify([next.snapshot?.tasks,next.snapshot?.messages,next.snapshot?.pending_message,next.snapshot?.integrations?.google_calendar,next.snapshot?.accountability?.observed_activity,next.snapshot?.accountability?.activity?.state,next.snapshot?.workflow_run,next.localPending,next.connection]);
      if (nextFingerprint !== fingerprint) { fingerprint = nextFingerprint; refreshWidgets(); }
      renderConversation(dock);
      if (dialog.open && ['today', 'goals', 'progress', 'activity', 'browser-setup','calendar-day'].includes(dialog.dataset.detail) && detailFingerprint!==nextFingerprint) {
        detailFingerprint=nextFingerprint;
        const body = dialog.querySelector('.detail-body'), top = dialog.scrollTop;
        renderDetail(dialog.dataset.detail, dialog.querySelector('#detail-title'), body); dialog.scrollTop = top;
      }
    });
    restorePage();window.addEventListener('popstate',restorePage);window.addEventListener('hashchange',restorePage);
    const connectDesktop = () => { stopDesktop = window.eiloDesktop?.onOpenCheckIn(async target => {
      await client.refresh();
      const entry = notificationEntry(current.snapshot, target);
      desktopNotice = entry ? '' : 'This check-in is no longer in the current conversation.';
      if (dialog.open) dialog.close();
      setThreadOpen(true); renderConversation(dock);
      requestAnimationFrame(() => {
        const row = entry && [...dock.querySelectorAll('.live-snippet')].find(item => item.dataset.messageId === entry.id);
        if (row) { row.tabIndex = -1; row.focus({preventScroll:true}); row.scrollIntoView({block:'nearest',behavior:'instant'}); }
      });
    }); };
    connectDesktop();
    client.start();
    window.addEventListener('pagehide', () => { calendarPanel?.destroy();calendarPanel=null;briefingSourcesPanel?.destroy();briefingSourcesPanel=null;clearWorkflow();speech?.cancel(); client.stop(); stopDesktop?.(); });
    window.addEventListener('pageshow', event => { if (event.persisted) { connectDesktop(); client.start(); } });
  }
  return { renderBody, renderDetail, start, showPage, focusConversation:talk, ownsConversationFocus:()=>dock.contains(document.activeElement) };
}

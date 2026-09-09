import { CATALOG, MODES, createDefaultState, normalizeState, projectLayout, updateLayout } from './layout.js';
import { SAMPLE } from './fixtures.js';
import { createHoldGesture } from './hold.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const KEY = 'eilo:widget-prototype:layout:v1';
const CONTENT_KEY = 'eilo:widget-prototype:content:v1';
const PREFS_KEY = 'eilo:widget-prototype:preferences:v1';
const TITLES = { today:'Today', goals:'Connected goals', progress:'Progress', conversation:'Conversation', clock:'Clock', notes:'Notes' };
const DEFAULT_SIZE = { today:'medium',goals:'large',progress:'small',conversation:'medium',clock:'small',notes:'small' };
const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const board = $('.board');
const scroller = $('.board-scroll');
const rail = $('.nav-rail');
const gallery = $('.gallery');
const detail = $('.detail-dialog');
const elements = new Map();
let storageAvailable = true, storageMessage = '';
function readStorage(key, fallback) {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; }
  catch { storageMessage = 'Saved preferences could not be read. This preview is using a fresh layout.'; return fallback; }
}
let state = normalizeState(readStorage(KEY, createDefaultState()));
const storedContent = readStorage(CONTENT_KEY, {});
const content = { notes: typeof storedContent?.notes === 'string' ? storedContent.notes.slice(0,10000) : '' };
const storedPrefs = readStorage(PREFS_KEY, {});
const prefs = { name: typeof storedPrefs?.name === 'string' && storedPrefs.name.trim() ? storedPrefs.name.slice(0,40) : 'Sean', pin: storedPrefs?.pin === true, reducedMotion: storedPrefs?.reducedMotion === true };
let editing = false, mode = 'wide', rowHeight = 118, cellWidth = 60, gap = 20, rowBudget = 4;
let selectedType = 'progress', selectedSize = 'small';
let drag = null, keyboardMove = null, undoState = null, menuId = null, heldPress = null, resizeDrag = null;
let toastTimer, railTimer, geometryFrame, lastGeometry = '', idCount = 0, noteTimer, railTransitionTimer;
let railHovered = false, railOpen = true, accountOpen = false, galleryReturnFocus = null, detailReturnFocus = null;
const icon = name => `<svg aria-hidden="true"><use href="#${name}"/></svg>`;
function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); storageAvailable = true; return true; }
  catch { storageAvailable = false; storageMessage = 'Your browser cannot save this layout. Changes will last until this page is reloaded.'; showStorageWarning(); return false; }
}
function showStorageWarning() {
  $('.storage-warning').hidden = !storageMessage;
  $('.storage-warning').textContent = storageMessage;
}
function saveLayout() {
  const ok = writeStorage(KEY, state);
  $('.save-state').textContent = editing ? ok ? 'Saved' : 'Not saved' : '';
}
function announce(message) { $('#announcement').textContent = message; }
function toast(message, undo = false) {
  clearTimeout(toastTimer);
  $('.toast-message').textContent = message;
  $('.toast').hidden = false;
  $('.toast-undo').hidden = !undo;
  const dismiss = () => {
    if ($('.toast').contains(document.activeElement)) { toastTimer = setTimeout(dismiss, 3000); return; }
    $('.toast').hidden = true;
  };
  toastTimer = setTimeout(dismiss, 7000);
  announce(message);
}
$('.toast-undo').addEventListener('click', () => {
  if (!undoState) return;
  state = undoState; undoState = null; saveLayout(); renderBoard();
  toast('Layout change undone.'); $('.edit-toggle').focus();
});
function commit(action, message) {
  if (action.type === 'move') { const item = projectLayout(state,mode).find(item => item.id === action.id); if(item) action={...action,y:Math.max(0,Math.min(rowBudget-item.h,action.y))}; }
  const next = action.type === 'resizeTo' ? resizeToHome(state,action.id,action.w,action.h) : updateLayout(state, { ...action, mode });
  if (next === state) return false;
  undoState = state; state = next; saveLayout(); renderBoard();
  if (message) toast(message, true);
  return true;
}
function resizeToHome(base,id,w,h) {
  let next=updateLayout(base,{type:'resizeTo',id,w,h:Math.max(2,Math.min(rowBudget,h)),mode});
  const item=projectLayout(next,mode).find(item=>item.id===id);
  if(item && item.y+item.h>rowBudget) next=updateLayout(next,{type:'move',id,x:item.x,y:Math.max(0,rowBudget-item.h),mode});
  return next;
}
function placeOnHome(base,id) {
  const item=projectLayout(base,mode).find(item=>item.id===id); if(!item)return base;
  const next=item.h>rowBudget ? resizeToHome(base,id,item.w,rowBudget) : base;
  return updateLayout(next,{type:'move',id,x:0,y:0,mode});
}
function overflowWidgets() { return projectLayout(state,mode).filter(item=>item.y+item.h>rowBudget); }
function weekMarkup() {
  return `<div class="week-grid" aria-label="Three recorded practice days in this sample week">${SAMPLE.week.map((done,i) => `<span class="week-day" aria-label="${DAYS[i]}: ${done ? 'practice recorded' : 'no practice recorded'}"><span class="day-mark ${done ? 'complete' : ''}" aria-hidden="true"></span><span aria-hidden="true">${DAYS[i][0]}</span></span>`).join('')}</div>`;
}
function renderBody(widget, container, preview = false) {
  const type = widget.type;
  container.innerHTML = '';
  if (type === 'today') {
    container.innerHTML = `<h2>Today</h2><p class="widget-subtitle">${SAMPLE.day}</p><div class="agenda-items"></div>`;
    const list = container.querySelector('.agenda-items');
    const shown = SAMPLE.agenda;
    shown.forEach(item => { const row = document.createElement('div'); row.className = 'agenda-row'; const time = document.createElement('span'); time.className = 'agenda-time'; time.textContent = item.time.replace('Before 6 PM','Before\n6 PM'); const title = document.createElement('span'); title.className = 'agenda-label'; title.textContent = item.title; row.append(time,title); list.append(row); });
  } else if (type === 'goals') {
    container.innerHTML = `<div class="goal-heading"><h2>Internship search</h2><button class="text-button open-goal">Open goal ${icon('external')}</button></div><p class="widget-subtitle">Preparing your application</p><div class="goal-steps"><div class="goal-step current"><span class="goal-dot" aria-hidden="true"></span><div><strong>Review résumé</strong><p>Up next</p></div></div><svg class="goal-connector" viewBox="0 0 50 25" aria-hidden="true"><path d="M2 18Q24 -1 47 17m-8-1 8 1-3-7"/></svg><div class="goal-step"><span class="goal-dot" aria-hidden="true"></span><div><strong>Application draft</strong><p>After résumé review</p></div></div></div>`;
    container.querySelector('.open-goal').addEventListener('click', () => showDetail('goals'));
  } else if (type === 'progress') {
    container.innerHTML = `<h2>This week</h2><div class="practice-count"><strong>${SAMPLE.week.filter(Boolean).length}</strong><span>practice days</span></div>${weekMarkup()}`;
  } else if (type === 'conversation') {
    container.innerHTML = '<h2 class="conversation-title">eïlo</h2><p class="sample-message"></p><div class="composer-preview"><input placeholder="Message eïlo" aria-label="Conversation appearance only; agent is not connected in this prototype" disabled><p class="chat-preview-note">Conversation preview</p></div>';
    container.querySelector('.sample-message').textContent = SAMPLE.message;
  } else if (type === 'clock') {
    container.innerHTML = '<h2>Local time</h2><p class="clock-time"></p><p class="clock-day"></p>';
    updateClock(container);
  } else if (type === 'notes') {
    container.innerHTML = '<h2>Notes</h2><textarea class="note-input" placeholder="A thought for later…" aria-label="Personal note for this prototype" maxlength="10000"></textarea>';
    const input = container.querySelector('textarea'); input.value = content.notes;
    if (!preview) input.addEventListener('input', () => {
      content.notes = input.value;
      $$('.note-input').filter(other => other !== input && !other.closest('.widget-preview')).forEach(other => { other.value = content.notes; });
      clearTimeout(noteTimer); noteTimer = setTimeout(() => writeStorage(CONTENT_KEY,content),250);
    });
  }
  container.querySelectorAll('svg').forEach(svg => svg.setAttribute('aria-hidden','true'));
}
function updateClock(root = document) {
  const now = new Date();
  root.querySelectorAll('.clock-time').forEach(node => { node.textContent = now.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }); });
  root.querySelectorAll('.clock-day').forEach(node => { node.textContent = now.toLocaleDateString([], { weekday:'long', month:'long', day:'numeric' }); });
  $('.desktop-time').textContent = now.toLocaleDateString([], { weekday:'short',month:'short',day:'numeric' }) + '  ' + now.toLocaleTimeString([], { hour:'numeric',minute:'2-digit' });
}
function createWidget(widget) {
  const element = document.createElement('article'); element.className = 'widget'; element.dataset.widgetId = widget.id;
  const tools = document.createElement('div'); tools.className = 'widget-tools';
  const remove = document.createElement('button'); remove.className = 'remove-widget'; remove.innerHTML = icon('minus'); remove.setAttribute('aria-label',`Remove ${TITLES[widget.type]} widget`); remove.title = `Remove ${TITLES[widget.type]} widget`;
  const grip = document.createElement('button'); grip.className = 'move-widget'; grip.innerHTML = icon('grip'); grip.setAttribute('aria-label',`Move ${TITLES[widget.type]} widget`); grip.setAttribute('aria-describedby','move-help'); grip.title = 'Drag to move, or press Space and use arrow keys';
  const options = document.createElement('button'); options.className = 'widget-options'; options.innerHTML = icon('more'); options.setAttribute('aria-label',`${TITLES[widget.type]} widget options`); options.setAttribute('aria-expanded','false'); options.title = 'Size and position';
  tools.append(remove,grip,options);
  const body = document.createElement('div'); body.className = 'widget-content'; element.append(tools,body);
  const resize = document.createElement('button'); resize.className = 'resize-widget'; resize.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19 19 6M13 19l6-6"/></svg>'; resize.setAttribute('aria-label',`Resize ${TITLES[widget.type]} widget`); resize.title = 'Drag to resize, or use arrow keys'; resize.setAttribute('aria-describedby','resize-help'); element.append(resize);
  resize.addEventListener('pointerdown', event => startResize(event,widget.id));
  resize.addEventListener('keydown', event => resizeWithKeys(event,widget.id));
  remove.addEventListener('click', () => removeWidget(widget.id));
  options.addEventListener('click', () => toggleWidgetMenu(widget.id,options));
  grip.addEventListener('pointerdown', event => startPointerMove(event,widget.id));
  grip.addEventListener('keydown', event => handleMoveKeys(event,widget.id));
  grip.addEventListener('blur', () => { if (keyboardMove?.id === widget.id) finishKeyboardMove(true); });
  element.addEventListener('pointerdown', event => startHeldPress(event,widget.id));
  element.addEventListener('contextmenu', event => { if (heldPress || drag) event.preventDefault(); });
  element.addEventListener('keydown', event => { if (editing && event.key === 'Escape' && !keyboardMove && !drag && !resizeDrag) { closeWidgetMenu(); setEditing(false); } });
  return element;
}
function updateGeometry() {
  const width = board.clientWidth;
  const expandedWidth = width + $('.rail-zone').getBoundingClientRect().width - parseFloat(getComputedStyle($('.workspace')).getPropertyValue('--rail-space'));
  mode = expandedWidth >= 800 ? 'wide' : expandedWidth >= 640 ? 'compact' : 'stacked';
  gap = mode === 'stacked' ? 16 : 20;
  rowBudget = mode === 'stacked' ? 2*Math.max(1,Math.floor((scroller.clientHeight+gap)/(244+2*gap))) : scroller.clientHeight >= 500 ? 4 : 2;
  rowHeight = Math.max(1,Math.floor((scroller.clientHeight-(rowBudget-1)*gap-6)/rowBudget));
  cellWidth = (width - (MODES[mode] - 1) * gap) / MODES[mode];
}
function renderBoard() {
  updateGeometry();
  const layout = projectLayout(state,mode), ids = new Set(layout.map(item => item.id));
  for (const [id,element] of elements) if (!ids.has(id)) { element.remove(); elements.delete(id); }
  for (const widget of layout) {
    let element = elements.get(widget.id);
    if (!element) { element = createWidget(widget); elements.set(widget.id,element); board.append(element); }
    const signature = [widget.type,widget.size,widget.w,widget.h].join(':');
    if (element.dataset.signature !== signature) {
      element.dataset.signature = signature; renderBody(widget,element.querySelector('.widget-content'));
      const heading = element.querySelector('h2'); if (heading) { heading.id = 'widget-title-' + (++idCount); element.setAttribute('aria-labelledby',heading.id); }
    }
    element.dataset.type = widget.type; element.dataset.size = widget.size;
    element.dataset.x = widget.x; element.dataset.y = widget.y; element.dataset.w = widget.w; element.dataset.h = widget.h;
    element.hidden = widget.y + widget.h > rowBudget;
    element.style.setProperty('--left',widget.x * (cellWidth + gap) + 'px'); element.style.setProperty('--top',widget.y * (rowHeight + gap) + 'px');
    element.style.setProperty('--width',widget.w * cellWidth + (widget.w - 1) * gap + 'px'); element.style.setProperty('--height',widget.h * rowHeight + (widget.h - 1) * gap + 'px');
    element.querySelector('.widget-tools').inert = !editing;
  }
  const visible = layout.filter(item=>item.y+item.h<=rowBudget), overflow=layout.length-visible.length;
  board.style.height = rowBudget*rowHeight+(rowBudget-1)*gap+'px';
  board.hidden = visible.length === 0;
  $('.empty-home').hidden = visible.length !== 0;
  $('.overflow-toggle').hidden = overflow === 0;
  $('.overflow-toggle').textContent = `More widgets · ${overflow}`;
  $('.app-window').classList.toggle('editing',editing);
  if (menuId && !ids.has(menuId)) closeWidgetMenu();
}
function removeWidget(id) {
  const widget = state.widgets.find(item => item.id === id); if (!widget) return;
  closeWidgetMenu(); commit({type:'remove',id},`${TITLES[widget.type]} removed from Home. Its contents are kept.`); $('.edit-toggle').focus();
}
function setEditing(value) {
  cancelHeldPress();
  if (resizeDrag) finishResize(false);
  if (drag) finishPointerMove(false);
  if (keyboardMove) finishKeyboardMove(false);
  editing = value; closeWidgetMenu();
  $('.add-toggle').hidden = !editing;
  $('.edit-toggle').innerHTML = editing ? 'Done' : icon('pencil') + '<span>Edit home</span>';
  if (!editing && gallery.open) gallery.close();
  saveLayout(); renderBoard();
  announce(editing ? 'Editing Home. Move widgets using their drag handles or keyboard controls.' : 'Home layout saved. Editing finished.');
}
$('.edit-toggle').addEventListener('click', () => setEditing(!editing));
$('.add-toggle').addEventListener('click',openGallery);
$('.empty-add').addEventListener('click', () => { setEditing(true); openGallery(); });
$('.overflow-toggle').addEventListener('click',() => showDetail('overflow'));

function positionGallery() {
  const bounds = $('.app-window').getBoundingClientRect();
  const narrow = innerWidth <= 700;
  const width = Math.min(570,innerWidth - 24);
  gallery.style.width = width + 'px';
  gallery.style.left = Math.max(12, Math.min(innerWidth - width - 12,bounds.right - width - 18)) + 'px';
  const top = narrow ? 18 : Math.max(18,Math.min(bounds.top + 130,innerHeight - 400));
  gallery.style.top = top + 'px'; gallery.style.maxHeight = Math.max(280,Math.min(bounds.bottom - top - 20,innerHeight - top - 18)) + 'px';
}
function renderGallery() {
  const query = $('#widget-search').value.trim().toLowerCase();
  const types = Object.keys(CATALOG).filter(type => TITLES[type].toLowerCase().includes(query));
  if (!types.includes(selectedType)) selectedType = types[0] || null;
  const list = $('.widget-categories'); list.innerHTML = '';
  for (const type of types) { const button = document.createElement('button'); button.textContent = TITLES[type]; button.dataset.widgetType = type; button.setAttribute('aria-pressed',String(type === selectedType)); button.addEventListener('click', () => { selectedType = type; renderGallery(); list.querySelector(`[data-widget-type="${type}"]`).focus(); }); list.append(button); }
  $('.gallery-selection').hidden = !selectedType; $('.no-results').hidden = types.length > 0;
  if (!selectedType) return;
  selectedSize = DEFAULT_SIZE[selectedType];
  $('.gallery-type-title').textContent = TITLES[selectedType];
  const preview = $('.widget-preview'); preview.dataset.type = selectedType; preview.innerHTML = '<div class="widget-content"></div>';
  renderBody({type:selectedType,size:selectedSize},preview.firstElementChild,true);
  $('.confirm-add').disabled = state.widgets.length >= 24;
  $('.confirm-add').textContent = state.widgets.length >= 24 ? '24-widget limit reached' : 'Add widget';
}
function openGallery() {
  if (gallery.open) return;
  if (!editing) setEditing(true);
  closeWidgetMenu(); closeAccount(); galleryReturnFocus = document.activeElement;
  $('#widget-search').value = ''; selectedType ||= 'progress'; renderGallery(); positionGallery(); gallery.showModal(); $('#widget-search').focus();
}
$('.gallery-close').addEventListener('click', () => gallery.close());
gallery.addEventListener('close', () => { if (galleryReturnFocus?.isConnected && !galleryReturnFocus.closest('[hidden]')) galleryReturnFocus.focus(); });
$('#widget-search').addEventListener('input',renderGallery);
$('.confirm-add').addEventListener('click', () => {
  if (!selectedType || state.widgets.length >= 24) return;
  const type = selectedType, id = type + '-' + crypto.randomUUID();
  const before=state;
  if (commit({type:'add',widgetType:type,size:selectedSize,id})) {
    if (elements.get(id)?.hidden) { state=placeOnHome(state,id); saveLayout();renderBoard(); }
    undoState=before; toast(`${TITLES[type]} added to Home.`,true);
    const element = elements.get(id); galleryReturnFocus = element?.querySelector('.move-widget');
    gallery.close(); element?.scrollIntoView({block:'nearest',behavior:'instant'});
  }
});

function closeWidgetMenu() {
  if (menuId) elements.get(menuId)?.querySelector('.widget-options').setAttribute('aria-expanded','false');
  menuId = null; $('.widget-menu').hidden = true;
}
function toggleWidgetMenu(id, trigger) {
  if (menuId === id) { closeWidgetMenu(); return; }
  closeWidgetMenu(); const widget = state.widgets.find(item => item.id === id); if (!widget) return;
  menuId = id; trigger.setAttribute('aria-expanded','true');
  const menu = $('.widget-menu'); menu.innerHTML = '<h3>Widget</h3>';
  const resizeAction = document.createElement('button'); resizeAction.textContent='Resize with arrow keys'; resizeAction.addEventListener('click',() => { closeWidgetMenu(); elements.get(id)?.querySelector('.resize-widget').focus(); announce('Use arrow keys to resize this widget.'); }); menu.append(resizeAction);
  const heading = document.createElement('h3'); heading.textContent = 'Move'; menu.append(heading);
  const directions = document.createElement('div'); directions.className = 'menu-move';
  for (const [name,dx,dy] of [['left',-1,0],['up',0,-1],['down',0,1],['right',1,0]]) { const button = document.createElement('button'); button.innerHTML = icon('arrow-'+name); button.setAttribute('aria-label',`Move ${TITLES[widget.type]} ${name}`); button.addEventListener('click', () => { const item = projectLayout(state,mode).find(item => item.id === id); closeWidgetMenu(); commit({type:'move',id,x:item.x+dx,y:item.y+dy},`${TITLES[widget.type]} moved ${name}.`); elements.get(id)?.querySelector('.widget-options').focus(); }); directions.append(button); } menu.append(directions);
  const remove = document.createElement('button'); remove.className = 'menu-remove'; remove.textContent = 'Remove from Home'; remove.addEventListener('click', () => removeWidget(id)); menu.append(remove);
  menu.hidden = false; const bounds = trigger.getBoundingClientRect(); menu.style.left = Math.max(10, Math.min(bounds.right - menu.offsetWidth,innerWidth - menu.offsetWidth - 10)) + 'px'; menu.style.top = Math.max(10,Math.min(bounds.bottom + 7,innerHeight - menu.offsetHeight - 10)) + 'px'; menu.querySelector('button').focus();
}
$('.widget-menu').addEventListener('keydown',event => {
  const buttons = [...$('.widget-menu').querySelectorAll('button')];
  if (event.key === 'Escape') { event.preventDefault(); const id = menuId; closeWidgetMenu(); elements.get(id)?.querySelector('.widget-options').focus(); }
  else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) { event.preventDefault(); let next = buttons.indexOf(document.activeElement); next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length-1 : (next + (event.key === 'ArrowDown' ? 1 : buttons.length-1)) % buttons.length; buttons[next].focus(); }
});

function handleMoveKeys(event,id) {
  if (!editing) return;
  if ([' ','Enter'].includes(event.key)) {
    event.preventDefault();
    if (keyboardMove?.id === id) { finishKeyboardMove(true); return; }
    if (keyboardMove) finishKeyboardMove(true);
    closeWidgetMenu(); keyboardMove = {id,before:structuredClone(state)}; elements.get(id).classList.add('keyboard-moving'); event.currentTarget.setAttribute('aria-pressed','true'); announce('Moving widget. Use arrow keys, Enter to place, or Escape to cancel.');
  } else if (keyboardMove?.id === id && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finishKeyboardMove(false); }
  else if (keyboardMove?.id === id && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
    event.preventDefault(); const item = projectLayout(state,mode).find(widget => widget.id === id);
    const x = item.x + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0), y = Math.max(0,Math.min(rowBudget-item.h,item.y + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)));
    state = updateLayout(state,{type:'move',id,x,y,mode}); renderBoard(); const placed = projectLayout(state,mode).find(widget => widget.id === id); announce(`Column ${placed.x+1}, row ${placed.y+1}.`);
  }
}
function finishKeyboardMove(keep) {
  if (!keyboardMove) return;
  const {id,before} = keyboardMove; keyboardMove = null;
  if (!keep) state = before; else undoState = before;
  elements.get(id)?.classList.remove('keyboard-moving'); elements.get(id)?.querySelector('.move-widget').removeAttribute('aria-pressed');
  saveLayout(); renderBoard(); toast(keep ? 'Widget moved.' : 'Move cancelled.',keep);
}
function startPointerMove(event,id) {
  if (!editing || event.button !== 0) return;
  closeWidgetMenu(); if (keyboardMove) finishKeyboardMove(true);
  const element = elements.get(id), rect = element.getBoundingClientRect();
  drag = {id,handle:event.currentTarget,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,offsetX:event.clientX-rect.left,offsetY:event.clientY-rect.top,started:false,before:structuredClone(state),ghost:null,placeholder:null,target:null,clientX:event.clientX,clientY:event.clientY};
  event.currentTarget.setPointerCapture(event.pointerId);
}
function cancelHeldPress() {
  holdGesture.cancel();
}
const holdGesture=createHoldGesture({
  onPending(candidate) { if(heldPress)elements.get(heldPress.id)?.classList.remove('holding-widget'); heldPress=candidate; if(candidate)elements.get(candidate.id)?.classList.add('holding-widget'); },
  onActivate(press) {
    const element=elements.get(press.id);if(!element?.isConnected)return;
    setEditing(true); window.getSelection()?.removeAllRanges();
    startPointerMove({button:0,currentTarget:element,pointerId:press.pointerId,clientX:press.x,clientY:press.y},press.id);
    element.classList.add('hold-ready'); setTimeout(()=>element.classList.remove('hold-ready'),300);
    announce('Ready to rearrange. Drag the widget or its bottom corner.');
  }
});
function startHeldPress(event,id) {
  if (event.button !== 0 || !event.isPrimary || event.target.closest('button,input,textarea,a,select,[contenteditable]')) return;
  if (editing) { startPointerMove(event,id); return; }
  cancelHeldPress();
  holdGesture.start({id,pointerId:event.pointerId,x:event.clientX,y:event.clientY});
}
function startResize(event,id) {
  if (event.button !== 0 || !event.isPrimary) return;
  event.preventDefault(); event.stopPropagation(); cancelHeldPress(); closeWidgetMenu();
  if (drag) finishPointerMove(false); if (keyboardMove) finishKeyboardMove(true);
  const item = projectLayout(state,mode).find(widget => widget.id === id);
  resizeDrag = {id,pointerId:event.pointerId,handle:event.currentTarget,startX:event.clientX,startY:event.clientY,item,before:structuredClone(state),changed:false,stepX:cellWidth+gap,stepY:rowHeight+gap,mode};
  event.currentTarget.setPointerCapture(event.pointerId); elements.get(id).classList.add('is-resizing');
  document.body.classList.add('resize-active');
}
function resizeWithKeys(event,id) {
  if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
  event.preventDefault(); const item = projectLayout(state,mode).find(widget => widget.id === id);
  const w = item.w + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0);
  const h = item.h + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0);
  commit({type:'resizeTo',id,w,h},'Widget resized.');
}
function finishResize(keep) {
  if (!resizeDrag) return;
  const finished = resizeDrag; resizeDrag = null;
  if (finished.handle.hasPointerCapture(finished.pointerId)) finished.handle.releasePointerCapture(finished.pointerId);
  elements.get(finished.id)?.classList.remove('is-resizing'); document.body.classList.remove('resize-active');
  if (!keep) state = finished.before;
  if (finished.changed) { if (keep) undoState=finished.before; saveLayout(); renderBoard(); toast(keep?'Widget resized.':'Resize cancelled.',keep); }
}
function dragPosition() {
  if (!drag?.started) return;
  const rect = board.getBoundingClientRect(), item = projectLayout(state,mode).find(item => item.id === drag.id);
  if (!item) return;
  const x = Math.max(0,Math.min(MODES[mode]-item.w,Math.round((drag.clientX-drag.offsetX-rect.left)/(cellWidth+gap))));
  const y = Math.max(0,Math.min(rowBudget-item.h,Math.round((drag.clientY-drag.offsetY-rect.top)/(rowHeight+gap))));
  drag.target = {x,y};
  drag.ghost.style.transform = `translate(${drag.clientX-drag.offsetX}px,${drag.clientY-drag.offsetY}px)`;
  drag.placeholder.style.left = x*(cellWidth+gap)+'px'; drag.placeholder.style.top = y*(rowHeight+gap)+'px';
}
document.addEventListener('pointermove',event => {
  holdGesture.move({pointerId:event.pointerId,x:event.clientX,y:event.clientY});
  if (resizeDrag && event.pointerId === resizeDrag.pointerId) {
    event.preventDefault(); const r = resizeDrag;
    const w = r.item.w + Math.round((event.clientX-r.startX)/r.stepX), h = r.item.h + Math.round((event.clientY-r.startY)/r.stepY);
    if (w === r.item.w && h === r.item.h && !r.changed) return;
    state = resizeToHome(r.before,r.id,w,h); r.changed=true; renderBoard(); return;
  }
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.clientX = event.clientX; drag.clientY = event.clientY;
  if (!drag.started && Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY) < 6) return;
  event.preventDefault();
  if (!drag.started) {
    drag.started = true; const element = elements.get(drag.id); const rect = element.getBoundingClientRect();
    const ghost = element.cloneNode(true); ghost.classList.add('drag-ghost'); ghost.classList.remove('keyboard-moving'); ghost.removeAttribute('aria-labelledby'); ghost.setAttribute('aria-hidden','true'); ghost.inert = true; ghost.querySelectorAll('[id]').forEach(node => node.removeAttribute('id')); ghost.style.width = rect.width+'px'; ghost.style.height = rect.height+'px'; ghost.style.removeProperty('--left'); ghost.style.removeProperty('--top'); ghost.querySelector('.widget-tools').remove(); document.body.append(ghost); drag.ghost = ghost;
    const placeholder = document.createElement('div'); placeholder.className = 'drop-preview'; placeholder.style.width = rect.width+'px'; placeholder.style.height = rect.height+'px'; placeholder.setAttribute('aria-hidden','true'); board.append(placeholder); drag.placeholder = placeholder;
    element.classList.add('is-dragging'); document.body.classList.add('drag-active');
  }
  dragPosition();
},{passive:false});
function finishPointerMove(keep) {
  if (!drag) return;
  const finished = drag; drag = null;
  finished.ghost?.remove(); finished.placeholder?.remove(); elements.get(finished.id)?.classList.remove('is-dragging'); document.body.classList.remove('drag-active');
  if (finished.handle.hasPointerCapture(finished.pointerId)) finished.handle.releasePointerCapture(finished.pointerId);
  if (finished.started && keep && finished.target) commit({type:'move',id:finished.id,...finished.target},'Widget moved.');
  else if (finished.started) announce('Move cancelled.');
}
document.addEventListener('pointerup',event => { cancelHeldPress(); if (drag && event.pointerId === drag.pointerId) finishPointerMove(true); if (resizeDrag && event.pointerId === resizeDrag.pointerId) finishResize(true); });
document.addEventListener('pointercancel',() => { cancelHeldPress(); finishPointerMove(false); finishResize(false); });
document.addEventListener('lostpointercapture',event => { if (drag && event.pointerId === drag.pointerId) finishPointerMove(false); if (resizeDrag && event.pointerId === resizeDrag.pointerId) finishResize(false); });
document.addEventListener('keydown',event => { if (event.key === 'Escape') { cancelHeldPress(); if (drag || resizeDrag) { event.preventDefault(); event.stopPropagation(); finishPointerMove(false); finishResize(false); } } },true);
document.addEventListener('touchmove',event => { if (drag?.started || resizeDrag) event.preventDefault(); },{passive:false});
scroller.addEventListener('scroll',() => { cancelHeldPress(); if (drag) dragPosition(); else closeWidgetMenu(); },{passive:true});

function setRail(open, restore = false) {
  if (railOpen !== open) { cancelHeldPress(); if (drag) finishPointerMove(false); if (resizeDrag) finishResize(false); }
  const workspace = $('.workspace'); workspace.classList.add('nav-transitioning'); clearTimeout(railTransitionTimer); railTransitionTimer = setTimeout(() => workspace.classList.remove('nav-transitioning'),280);
  workspace.classList.toggle('nav-collapsed',!open);
  clearTimeout(railTimer); railOpen = open; rail.classList.toggle('is-hidden',!open); rail.inert = !open; rail.setAttribute('aria-hidden',String(!open)); $('.nav-hint').setAttribute('aria-expanded',String(open)); $('.nav-hint').style.visibility = open ? 'hidden' : 'visible';
  if (!open) { closeAccount(); if (restore) $('.nav-hint').focus(); }
}
function scheduleRailHide() {
  clearTimeout(railTimer); if (prefs.pin) return;
  railTimer = setTimeout(() => { if (!railHovered && !rail.contains(document.activeElement) && !accountOpen) setRail(false); },500);
}
$('.rail-zone').addEventListener('pointerenter',event => { if (event.pointerType === 'mouse') { railHovered=true; setRail(true); } });
$('.rail-zone').addEventListener('pointerleave',event => { if (event.pointerType === 'mouse') { railHovered=false; scheduleRailHide(); } });
rail.addEventListener('focusin',() => clearTimeout(railTimer));
rail.addEventListener('focusout',() => setTimeout(scheduleRailHide,0));
$('.nav-hint').addEventListener('click',() => { setRail(true); $('.nav-item').focus(); });
rail.addEventListener('keydown',event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (accountOpen) { closeAccount(); $('.account-trigger').focus(); } else setRail(false,true); } });
function closeAccount() { accountOpen=false; $('#account-menu').hidden=true; $('.account-trigger').setAttribute('aria-expanded','false'); }
$('.account-trigger').addEventListener('click',() => { accountOpen=!accountOpen; $('#account-menu').hidden=!accountOpen; $('.account-trigger').setAttribute('aria-expanded',String(accountOpen)); if (accountOpen) $('#account-menu button').focus(); });
document.addEventListener('pointerdown',event => { if (!event.target.closest('.widget-menu,.widget-options')) closeWidgetMenu(); if (!event.target.closest('.account-menu,.account-trigger')) closeAccount(); });
$$('[data-detail]').forEach(button => button.addEventListener('click',() => { const type=button.dataset.detail; if(type==='home') { scroller.scrollTo({top:0,behavior:prefs.reducedMotion?'instant':'smooth'}); return; } showDetail(type); }));
$$('[data-account-action]').forEach(button => button.addEventListener('click',() => { closeAccount(); showDetail(button.dataset.accountAction); }));
function showDetail(type) {
  detailReturnFocus = document.activeElement?.closest('.account-menu') ? $('.account-trigger') : document.activeElement;
  const body = $('.detail-body'); body.innerHTML = ''; const title = $('#detail-title');
  if (type === 'overflow') {
    title.textContent='More widgets'; body.innerHTML='<p class="muted">Bring a widget onto Home. Other views stay available here when space is full.</p><div class="overflow-list"></div>';
    for(const item of overflowWidgets()) { const row=document.createElement('div');row.className='overflow-item';const name=document.createElement('strong');name.textContent=TITLES[item.type];const button=document.createElement('button');button.className='button';button.textContent='Show on Home';button.setAttribute('aria-label',`Show ${TITLES[item.type]} on Home`);button.addEventListener('click',()=>{undoState=state;state=placeOnHome(state,item.id);saveLayout();renderBoard();detail.close();toast(`${TITLES[item.type]} is on Home.`,true);});row.append(name,button);body.querySelector('.overflow-list').append(row); }
  }
  else if (type === 'today') { title.textContent='Your day'; body.innerHTML='<p class="muted">An example schedule for this prototype.</p><ul></ul>'; SAMPLE.agenda.forEach(item => { const li=document.createElement('li'); const strong=document.createElement('strong'); strong.textContent=item.title; const small=document.createElement('small'); small.textContent=item.time; li.append(strong,small); body.querySelector('ul').append(li); }); }
  else if (type === 'goals') { title.textContent=SAMPLE.goal.title; body.innerHTML='<p>Preparing your application</p><h3>Up next</h3><p>Review résumé</p><h3>After résumé review</h3><p>Application draft</p><h3>What informed this</h3><p class="muted">Sample conversation: “I want to review my résumé before starting the application.” Removing this widget does not remove the goal.</p>'; }
  else if (type === 'progress') { title.textContent='Practice this week'; body.innerHTML='<p>Three days with recorded practice in the sample week.</p><h3>Monday · Tuesday · Wednesday</h3><p class="muted">The figures in this prototype are examples. No activity source is connected.</p>'; }
  else if (type === 'activity') { title.textContent='Recent updates'; body.innerHTML='<ul><li><strong>Résumé review is up next</strong><small>From the sample conversation</small></li><li><strong>Application draft follows the review</strong><small>Relationship captured in the sample goal</small></li></ul><h3>Layout and content</h3><p class="muted">Widget changes affect this home layout only. Sample goals and history are kept separately.</p>'; }
  else if (type === 'connections') { title.textContent='Connections & privacy'; body.innerHTML='<p>This prototype has no connected accounts or activity sources.</p><p class="muted">Your layout, prototype name and optional note are stored in this browser. The sample agenda, goals and progress are fixtures.</p>'; }
  else if (type === 'settings') {
    title.textContent='Settings'; body.innerHTML='<label class="check-option"><input type="checkbox" class="pin-setting">Keep navigation open</label><label class="check-option"><input type="checkbox" class="motion-setting">Reduce motion</label><h3>Home layout</h3><button class="button restore-defaults">Restore starter layout</button><p class="muted">Your note and sample goal contents are kept.</p>';
    body.querySelector('.pin-setting').checked=prefs.pin; body.querySelector('.motion-setting').checked=prefs.reducedMotion;
    body.querySelector('.pin-setting').addEventListener('change',event => { prefs.pin=event.target.checked; writeStorage(PREFS_KEY,prefs); if(prefs.pin)setRail(true);else scheduleRailHide(); });
    body.querySelector('.motion-setting').addEventListener('change',event => { prefs.reducedMotion=event.target.checked; document.body.classList.toggle('reduce-motion',prefs.reducedMotion);writeStorage(PREFS_KEY,prefs); });
    body.querySelector('.restore-defaults').addEventListener('click',() => { undoState=state;state=createDefaultState();saveLayout();renderBoard();detail.close();toast('Starter layout restored.',true); });
  } else if (type === 'profile') {
    title.textContent='Prototype profile'; body.innerHTML='<form class="profile-form"><label class="field">Display name<input type="text" maxlength="40" autocomplete="off" required></label><button class="button primary">Save name</button></form><p class="muted">This name applies only to this prototype.</p>';
    body.querySelector('input').value=prefs.name;body.querySelector('form').addEventListener('submit',event => {event.preventDefault();const value=body.querySelector('input').value.trim();if(!value)return;prefs.name=value;writeStorage(PREFS_KEY,prefs);renderProfile();detail.close();toast('Prototype name saved.');});
  } else { title.textContent='Your home, your way'; body.innerHTML='<p>Use Edit home to add, move, resize or remove widgets. Your choices are saved in this browser.</p><h3>Keyboard movement</h3><p>Focus a widget’s move handle and press Space. Use arrow keys to move it, Enter to place it, or Escape to cancel.</p><h3>Optional customization</h3><p class="muted">You arrange the views. eïlo’s eventual connected agent maintains their contents. This prototype uses sample data and a visual conversation preview.</p>'; }
  detail.showModal();
}
function renderProfile() { $('.account-trigger').textContent=Array.from(prefs.name)[0].toUpperCase(); $('.account-name').firstChild.textContent=prefs.name; }
$('.detail-close').addEventListener('click',() => detail.close());
detail.addEventListener('close', () => {
  if (!detailReturnFocus?.isConnected) return;
  if (detailReturnFocus.closest('.nav-rail')) setRail(true);
  detailReturnFocus.focus();
});
for (const dialog of [detail,gallery]) dialog.addEventListener('click',event => { if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();} });
window.addEventListener('resize',() => { cancelHeldPress();if(drag)finishPointerMove(false);if(resizeDrag)finishResize(false);if(keyboardMove)finishKeyboardMove(false);closeWidgetMenu();if(gallery.open)positionGallery(); });
const observer=new ResizeObserver(() => {
  const signature=[scroller.clientWidth,scroller.clientHeight].join(':');if(signature===lastGeometry)return;lastGeometry=signature;
  cancelAnimationFrame(geometryFrame);geometryFrame=requestAnimationFrame(renderBoard);
});observer.observe(scroller);
window.addEventListener('blur',() => { cancelHeldPress(); finishPointerMove(false); finishResize(false); });
window.addEventListener('pagehide',() => { cancelHeldPress(); if(resizeDrag)finishResize(false);if(keyboardMove)finishKeyboardMove(false);writeStorage(CONTENT_KEY,content); });
document.body.classList.toggle('reduce-motion',prefs.reducedMotion);renderProfile();showStorageWarning();setRail(prefs.pin);renderBoard();updateClock();
setInterval(updateClock,30000);

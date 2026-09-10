import {
  CATALOG,
  MODES,
  createDefaultState,
  normalizeState,
  projectLayout,
  updateLayout,
  previewMove,
  resizeWithinHome,
  fitWithinHome,
  layoutTransferHash,
  readLayoutTransfer,
  withConversationDock,
} from './home/layout.js';
import { SAMPLE } from './preview/fixtures.js';
import { createHoldGesture } from './home/hold.js';
import {
  createHomeStorage,
  HOME_STORAGE_KEYS,
  normalizeHomeContent,
  normalizeHomePreferences,
} from './home/storage.js';
import { renderSampleWidget, updateSampleClock } from './home/sample-widgets.js';
import { createWidgetGallery } from './home/gallery.js';
// The isolated design/typography previews never load the live conversation client.
const createLiveHome =
  document.documentElement.dataset.source === 'live'
    ? (await import('./workspace/workspace.js')).createLiveHome
    : null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const { layout: KEY, content: CONTENT_KEY, preferences: PREFS_KEY } = HOME_STORAGE_KEYS;
const TITLES = {
  today: 'Today',
  goals: 'Connected goals',
  progress: 'Progress',
  conversation: 'Conversation',
  clock: 'Clock',
  notes: 'Notes',
};
const DEFAULT_SIZE = {
  today: 'medium',
  goals: 'large',
  progress: 'small',
  conversation: 'medium',
  clock: 'small',
  notes: 'small',
};
const WIDGET_HOLD_MS = 420;
const MOTION_EASE = 'cubic-bezier(.22,1,.36,1)';
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const landings = new Set();
let gestureFrame = 0;
const reducedMotion = () => prefs.reducedMotion || motionPreference.matches;
function finishLandings() {
  for (const finish of [...landings]) finish();
}
function queueGestureFrame() {
  if (gestureFrame) return;
  gestureFrame = requestAnimationFrame(() => {
    gestureFrame = 0;
    if (drag) dragPosition();
    else if (resizeDrag) resizePosition();
  });
}
function clearGestureFrame() {
  cancelAnimationFrame(gestureFrame);
  gestureFrame = 0;
}
const board = $('.board');
const scroller = $('.board-scroll');
const rail = $('.nav-rail');
const gallery = $('.gallery');
const detail = $('.detail-dialog');
const elements = new Map();
const homeStorage = createHomeStorage();
const transferred =
  document.documentElement.dataset.source === 'live' ? readLayoutTransfer(location.hash) : null;
let state = normalizeState(transferred?.layout ?? homeStorage.read(KEY, createDefaultState()));
if (createLiveHome) state = withConversationDock(state);
const content = normalizeHomeContent(homeStorage.read(CONTENT_KEY, {}));
const prefs = normalizeHomePreferences({
  ...homeStorage.read(PREFS_KEY, {}),
  ...transferred?.preferences,
});
let editing = false,
  mode = 'wide',
  rowHeight = 118,
  cellWidth = 60,
  gap = 20,
  rowBudget = 4;
let initialFitChecked = false;
let drag = null,
  keyboardMove = null,
  undoState = null,
  menuId = null,
  heldPress = null,
  resizeDrag = null;
let toastTimer,
  railTimer,
  geometryFrame,
  lastGeometry = '',
  idCount = 0,
  noteTimer,
  railTransitionTimer;
let railHovered = false,
  railOpen = true,
  accountOpen = false,
  detailReturnFocus = null;
const icon = (name) => `<svg aria-hidden="true"><use href="#${name}"/></svg>`;
const live =
  document.documentElement.dataset.source === 'live'
    ? createLiveHome({
        openDetail: showDetail,
        dialog: detail,
        onViewChange: () => {
          if (editing) setEditing(false);
          closeAccount();
          closeWidgetMenu();
          requestAnimationFrame(renderBoard);
        },
        refreshWidgets: () => {
          for (const element of elements.values()) {
            if (!['today', 'goals', 'progress', 'conversation'].includes(element.dataset.type))
              continue;
            const body = element.querySelector('.widget-content');
            const focused = body.contains(document.activeElement)
              ? document.activeElement.textContent
              : null;
            const headingId = body.querySelector('h2')?.id;
            live.renderBody({ type: element.dataset.type, size: element.dataset.size }, body);
            if (headingId && body.querySelector('h2')) body.querySelector('h2').id = headingId;
            if (focused)
              [...body.querySelectorAll('button')]
                .find((button) => button.textContent === focused)
                ?.focus();
          }
        },
      })
    : null;
function writeStorage(key, value) {
  const saved = homeStorage.write(key, value);
  if (!saved) showStorageWarning();
  return saved;
}
function showStorageWarning() {
  $('.storage-warning').hidden = !homeStorage.message;
  $('.storage-warning').textContent = homeStorage.message;
}
function saveLayout() {
  const ok = writeStorage(KEY, state);
  $('.save-state').textContent = editing ? (ok ? 'Saved' : 'Not saved') : '';
}
function announce(message) {
  $('#announcement').textContent = message;
}
function toast(message, undo = false) {
  clearTimeout(toastTimer);
  $('.toast-message').textContent = message;
  $('.toast').hidden = false;
  $('.toast-undo').hidden = !undo;
  const dismiss = () => {
    if ($('.toast').contains(document.activeElement)) {
      toastTimer = setTimeout(dismiss, 3000);
      return;
    }
    $('.toast').hidden = true;
  };
  toastTimer = setTimeout(dismiss, 7000);
  announce(message);
}
$('.toast-undo').addEventListener('click', () => {
  if (!undoState) return;
  finishLandings();
  state = undoState;
  undoState = null;
  saveLayout();
  renderBoard();
  toast('Layout change undone.');
  $('.edit-toggle').focus();
});
function commit(action, message) {
  if (action.type === 'move') {
    const item = projectLayout(state, mode).find((item) => item.id === action.id);
    if (item) action = { ...action, y: Math.max(0, Math.min(rowBudget - item.h, action.y)) };
  }
  const next =
    action.type === 'resizeTo'
      ? resizeToHome(state, action.id, action.w, action.h)
      : action.type === 'move'
        ? previewMove(state, { ...action, mode, rows: rowBudget })
        : updateLayout(state, { ...action, mode });
  if (next === state) return false;
  undoState = state;
  state = next;
  saveLayout();
  renderBoard();
  if (message) toast(message, true);
  return true;
}
function resizeToHome(base, id, w, h) {
  return resizeWithinHome(base, { id, w, h, mode, rows: rowBudget });
}
function placeOnHome(base, id) {
  const item = projectLayout(base, mode).find((item) => item.id === id);
  if (!item) return base;
  const next =
    item.h > rowBudget
      ? updateLayout(base, { type: 'resizeTo', id, w: item.w, h: rowBudget, mode })
      : base;
  return updateLayout(next, { type: 'move', id, x: 0, y: 0, mode });
}
function overflowWidgets() {
  return projectLayout(state, mode).filter((item) => item.y + item.h > rowBudget);
}
function renderBody(widget, container, preview = false) {
  if (live?.renderBody(widget, container)) return;
  renderSampleWidget(widget, container, {
    content,
    preview,
    onOpenGoals: () => showDetail('goals'),
    onNotesChange: (input) => {
      content.notes = input.value;
      $$('.note-input')
        .filter((other) => other !== input && !other.closest('.widget-preview'))
        .forEach((other) => {
          other.value = content.notes;
        });
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => writeStorage(CONTENT_KEY, content), 250);
    },
  });
}
function updateClock(root = document) {
  updateSampleClock(root);
}
function createWidget(widget) {
  const element = document.createElement('article');
  element.className = 'widget';
  element.dataset.widgetId = widget.id;
  element.setAttribute('aria-describedby', 'widget-arrange-help');
  const cue = document.createElement('span');
  cue.className = 'hold-cue';
  cue.setAttribute('aria-hidden', 'true');
  cue.style.setProperty('--hold-step', WIDGET_HOLD_MS / 6 + 'ms');
  cue.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="5" r="1.7"/><circle cx="16" cy="5" r="1.7"/><circle cx="8" cy="12" r="1.7"/><circle cx="16" cy="12" r="1.7"/><circle cx="8" cy="19" r="1.7"/><circle cx="16" cy="19" r="1.7"/></svg><span class="hold-cue-label">Hold to move</span>';
  cue
    .querySelectorAll('circle')
    .forEach((circle, index) => circle.style.setProperty('--dot', index));
  element.append(cue);
  const tools = document.createElement('div');
  tools.className = 'widget-tools';
  const remove = document.createElement('button');
  remove.className = 'remove-widget';
  remove.innerHTML = icon('minus');
  remove.setAttribute('aria-label', `Remove ${TITLES[widget.type]} widget`);
  remove.title = `Remove ${TITLES[widget.type]} widget`;
  const grip = document.createElement('button');
  grip.className = 'move-widget';
  grip.innerHTML = icon('grip');
  grip.setAttribute('aria-label', `Move ${TITLES[widget.type]} widget`);
  grip.setAttribute('aria-describedby', 'move-help');
  grip.title = 'Drag to move, or press Space and use arrow keys';
  const options = document.createElement('button');
  options.className = 'widget-options';
  options.innerHTML = icon('more');
  options.setAttribute('aria-label', `${TITLES[widget.type]} widget options`);
  options.setAttribute('aria-expanded', 'false');
  options.title = 'Size and position';
  tools.append(remove, grip, options);
  const body = document.createElement('div');
  body.className = 'widget-content';
  element.append(tools, body);
  const resize = document.createElement('button');
  resize.className = 'resize-widget';
  resize.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19 19 6M13 19l6-6"/></svg>';
  resize.setAttribute('aria-label', `Resize ${TITLES[widget.type]} widget`);
  resize.title = 'Drag to resize, or use arrow keys';
  resize.setAttribute('aria-describedby', 'resize-help');
  element.append(resize);
  resize.addEventListener('pointerdown', (event) => startResize(event, widget.id));
  resize.addEventListener('keydown', (event) => resizeWithKeys(event, widget.id));
  const limit = document.createElement('span');
  limit.className = 'resize-limit-note';
  limit.textContent = 'No more room';
  limit.hidden = true;
  limit.setAttribute('aria-hidden', 'true');
  element.append(limit);
  remove.addEventListener('click', () => removeWidget(widget.id));
  options.addEventListener('click', () => toggleWidgetMenu(widget.id, options));
  grip.addEventListener('pointerdown', (event) => startPointerMove(event, widget.id));
  grip.addEventListener('keydown', (event) => handleMoveKeys(event, widget.id));
  grip.addEventListener('blur', () => {
    if (keyboardMove?.id === widget.id) finishKeyboardMove(false);
  });
  element.addEventListener('pointerdown', (event) => startHeldPress(event, widget.id));
  element.addEventListener('contextmenu', (event) => {
    if (heldPress || drag) event.preventDefault();
  });
  element.addEventListener('keydown', (event) => {
    if (editing && event.key === 'Escape' && !keyboardMove && !drag && !resizeDrag) {
      closeWidgetMenu();
      setEditing(false);
    }
  });
  return element;
}
function updateGeometry() {
  const width = board.clientWidth;
  const expandedWidth =
    width +
    $('.rail-zone').getBoundingClientRect().width -
    parseFloat(getComputedStyle($('.workspace')).getPropertyValue('--rail-space'));
  mode = expandedWidth >= 800 ? 'wide' : expandedWidth >= 640 ? 'compact' : 'stacked';
  gap = mode === 'stacked' ? 16 : 20;
  rowBudget =
    mode === 'stacked'
      ? 2 * Math.max(1, Math.floor((scroller.clientHeight + gap) / (244 + 2 * gap)))
      : scroller.clientHeight >=
          (live
            ? document.querySelector(
                '.conversation-dock[data-open="true"], .conversation-dock .live-update:not([hidden])',
              )
              ? 300
              : 380
            : 500)
        ? 4
        : 2;
  rowHeight = Math.max(
    1,
    Math.floor((scroller.clientHeight - (rowBudget - 1) * gap - 6) / rowBudget),
  );
  cellWidth = (width - (MODES[mode] - 1) * gap) / MODES[mode];
}
function renderBoard() {
  if (scroller.hidden) return;
  updateGeometry();
  if (!initialFitChecked) {
    initialFitChecked = true;
    const repaired = fitWithinHome(state, { mode, rows: rowBudget });
    if (repaired !== state) {
      state = repaired;
      saveLayout();
    }
  }
  const layout = projectLayout(
      drag?.preview ?? resizeDrag?.preview ?? keyboardMove?.preview ?? state,
      mode,
    ),
    ids = new Set(layout.map((item) => item.id));
  for (const [id, element] of elements)
    if (!ids.has(id)) {
      element.remove();
      elements.delete(id);
    }
  for (const widget of layout) {
    let element = elements.get(widget.id);
    if (!element) {
      element = createWidget(widget);
      elements.set(widget.id, element);
      board.append(element);
    }
    const signature = [widget.type, widget.size, widget.w, widget.h].join(':');
    if (element.dataset.signature !== signature) {
      element.dataset.signature = signature;
      renderBody(widget, element.querySelector('.widget-content'));
      const heading = element.querySelector('h2');
      if (heading) {
        heading.id = 'widget-title-' + ++idCount;
        element.setAttribute('aria-labelledby', heading.id);
      }
    }
    element.dataset.type = widget.type;
    element.dataset.size = widget.size;
    element.dataset.x = widget.x;
    element.dataset.y = widget.y;
    element.dataset.w = widget.w;
    element.dataset.h = widget.h;
    element.hidden = widget.y + widget.h > rowBudget;
    element.style.setProperty('--left', widget.x * (cellWidth + gap) + 'px');
    element.style.setProperty('--top', widget.y * (rowHeight + gap) + 'px');
    element.style.setProperty('--width', widget.w * cellWidth + (widget.w - 1) * gap + 'px');
    element.style.setProperty('--height', widget.h * rowHeight + (widget.h - 1) * gap + 'px');
    element.querySelector('.widget-tools').inert = !editing;
  }
  const visible = layout.filter((item) => item.y + item.h <= rowBudget),
    overflow = layout.length - visible.length;
  board.style.height = rowBudget * rowHeight + (rowBudget - 1) * gap + 'px';
  board.hidden = visible.length === 0;
  $('.empty-home').hidden = visible.length !== 0;
  $('.overflow-toggle').hidden = overflow === 0;
  $('.overflow-toggle').textContent = `More widgets · ${overflow}`;
  $('.app-window').classList.toggle('editing', editing);
  if (menuId && !ids.has(menuId)) closeWidgetMenu();
}
function removeWidget(id) {
  const widget = state.widgets.find((item) => item.id === id);
  if (!widget) return;
  closeWidgetMenu();
  commit(
    { type: 'remove', id },
    `${TITLES[widget.type]} removed from Home. Its contents are kept.`,
  );
  $('.edit-toggle').focus();
}
function setEditing(value) {
  cancelHeldPress();
  if (resizeDrag) finishResize(false);
  if (drag) finishPointerMove(false);
  if (keyboardMove) finishKeyboardMove(false);
  finishLandings();
  editing = value;
  closeWidgetMenu();
  $('.add-toggle').hidden = !editing;
  $('.edit-toggle').innerHTML = editing ? 'Done' : icon('pencil') + '<span>Edit home</span>';
  if (!editing && gallery.open) gallery.close();
  saveLayout();
  renderBoard();
  announce(
    editing
      ? 'Editing Home. Move widgets using their drag handles or keyboard controls.'
      : 'Home layout saved. Editing finished.',
  );
}
$('.edit-toggle').addEventListener('click', () => setEditing(!editing));
$('.app-window').addEventListener('pointerdown', (event) => {
  if (
    !editing ||
    event.button !== 0 ||
    !event.isPrimary ||
    drag ||
    resizeDrag ||
    gallery.open ||
    detail.open
  )
    return;
  // Only a press that starts on Home's empty surface exits editing. Releasing
  // a widget over that surface must still finish its drag without dismissing it.
  if (
    event.target.matches(
      '.app-window,.workspace,.board-scroll,.board,.home-header,.header-actions,.rail-zone,.empty-home',
    )
  ) {
    setEditing(false);
  }
});
const galleryController = createWidgetGallery({
  dialog: gallery,
  appWindow: $('.app-window'),
  catalog: Object.fromEntries(
    Object.entries(CATALOG).filter(([type]) => !live || type !== 'conversation'),
  ),
  titles: TITLES,
  defaultSizes: DEFAULT_SIZE,
  renderPreview: (widget, container) => renderBody(widget, container, true),
  getWidgetCount: () => state.widgets.length,
  onOpening: () => {
    if (!editing) setEditing(true);
    closeWidgetMenu();
    closeAccount();
    return document.activeElement;
  },
  onAdd: (type, size) => {
    const id = `${type}-${crypto.randomUUID()}`;
    const before = state;
    if (!commit({ type: 'add', widgetType: type, size, id })) return null;
    if (elements.get(id)?.hidden) {
      state = placeOnHome(state, id);
      saveLayout();
      renderBoard();
    }
    undoState = before;
    toast(`${TITLES[type]} added to Home.`, true);
    const element = elements.get(id);
    element?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    return element?.querySelector('.move-widget') || null;
  },
});
$('.add-toggle').addEventListener('click', () => galleryController.open());
$('.empty-add').addEventListener('click', () => {
  setEditing(true);
  galleryController.open();
});
$('.overflow-toggle').addEventListener('click', () => showDetail('overflow'));

function closeWidgetMenu() {
  if (menuId)
    elements.get(menuId)?.querySelector('.widget-options').setAttribute('aria-expanded', 'false');
  menuId = null;
  $('.widget-menu').hidden = true;
}
function toggleWidgetMenu(id, trigger) {
  if (menuId === id) {
    closeWidgetMenu();
    return;
  }
  closeWidgetMenu();
  const widget = state.widgets.find((item) => item.id === id);
  if (!widget) return;
  menuId = id;
  trigger.setAttribute('aria-expanded', 'true');
  const menu = $('.widget-menu');
  menu.innerHTML = '<h3>Widget</h3>';
  const resizeAction = document.createElement('button');
  resizeAction.textContent = 'Resize with arrow keys';
  resizeAction.addEventListener('click', () => {
    closeWidgetMenu();
    elements.get(id)?.querySelector('.resize-widget').focus();
    announce('Use arrow keys to resize this widget.');
  });
  menu.append(resizeAction);
  const heading = document.createElement('h3');
  heading.textContent = 'Move';
  menu.append(heading);
  const directions = document.createElement('div');
  directions.className = 'menu-move';
  for (const [name, dx, dy] of [
    ['left', -1, 0],
    ['up', 0, -1],
    ['down', 0, 1],
    ['right', 1, 0],
  ]) {
    const button = document.createElement('button');
    button.innerHTML = icon('arrow-' + name);
    button.setAttribute('aria-label', `Move ${TITLES[widget.type]} ${name}`);
    button.addEventListener('click', () => {
      const item = projectLayout(state, mode).find((item) => item.id === id);
      closeWidgetMenu();
      commit(
        { type: 'move', id, x: item.x + dx, y: item.y + dy },
        `${TITLES[widget.type]} moved ${name}.`,
      );
      elements.get(id)?.querySelector('.widget-options').focus();
    });
    directions.append(button);
  }
  menu.append(directions);
  const remove = document.createElement('button');
  remove.className = 'menu-remove';
  remove.textContent = 'Remove from Home';
  remove.addEventListener('click', () => removeWidget(id));
  menu.append(remove);
  menu.hidden = false;
  const bounds = trigger.getBoundingClientRect();
  menu.style.left =
    Math.max(10, Math.min(bounds.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 10)) +
    'px';
  menu.style.top =
    Math.max(10, Math.min(bounds.bottom + 7, innerHeight - menu.offsetHeight - 10)) + 'px';
  menu.querySelector('button').focus();
}
$('.widget-menu').addEventListener('keydown', (event) => {
  const buttons = [...$('.widget-menu').querySelectorAll('button')];
  if (event.key === 'Escape') {
    event.preventDefault();
    const id = menuId;
    closeWidgetMenu();
    elements.get(id)?.querySelector('.widget-options').focus();
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    let next = buttons.indexOf(document.activeElement);
    next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (next + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
    buttons[next].focus();
  }
});

function handleMoveKeys(event, id) {
  if (!editing) return;
  if ([' ', 'Enter'].includes(event.key)) {
    event.preventDefault();
    if (keyboardMove?.id === id) {
      finishKeyboardMove(true);
      return;
    }
    if (keyboardMove) finishKeyboardMove(true);
    closeWidgetMenu();
    finishLandings();
    const before = structuredClone(state),
      item = projectLayout(before, mode).find((widget) => widget.id === id);
    keyboardMove = { id, before, preview: before, target: { x: item.x, y: item.y }, item };
    elements.get(id).classList.add('keyboard-moving');
    event.currentTarget.setAttribute('aria-pressed', 'true');
    announce('Moving widget. Use arrow keys, Enter to place, or Escape to cancel.');
  } else if (keyboardMove?.id === id && event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    finishKeyboardMove(false);
  } else if (
    keyboardMove?.id === id &&
    ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
  ) {
    event.preventDefault();
    const moving = keyboardMove;
    const x = Math.max(
      0,
      Math.min(
        MODES[mode] - moving.item.w,
        moving.target.x + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0),
      ),
    );
    const y = Math.max(
      0,
      Math.min(
        rowBudget - moving.item.h,
        moving.target.y + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0),
      ),
    );
    moving.target = { x, y };
    moving.preview = previewMove(moving.before, { id, x, y, mode, rows: rowBudget });
    renderBoard();
    const placed = projectLayout(moving.preview, mode).find((widget) => widget.id === id);
    announce(`Column ${placed.x + 1}, row ${placed.y + 1}.`);
  }
}
function finishKeyboardMove(keep) {
  if (!keyboardMove) return;
  const { id, before, preview } = keyboardMove;
  keyboardMove = null;
  const changed = preview !== before;
  if (keep && changed) {
    undoState = before;
    state = preview;
    saveLayout();
  }
  elements.get(id)?.classList.remove('keyboard-moving');
  elements.get(id)?.querySelector('.move-widget').removeAttribute('aria-pressed');
  renderBoard();
  if (keep && changed) toast('Widget moved.', true);
  else announce(keep ? 'Widget placed.' : 'Move cancelled.');
}
function startPointerMove(event, id) {
  if (!editing || event.button !== 0 || drag || resizeDrag) return;
  closeWidgetMenu();
  finishLandings();
  clearTimeout(railTimer);
  if (keyboardMove) finishKeyboardMove(true);
  const element = elements.get(id),
    rect = element.getBoundingClientRect();
  const before = structuredClone(state),
    item = projectLayout(before, mode).find((item) => item.id === id);
  drag = {
    id,
    handle: event.currentTarget,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    clientX: event.clientX,
    clientY: event.clientY,
    started: false,
    before,
    preview: before,
    item,
    mode,
    rows: rowBudget,
    ghost: null,
    target: { x: item.x, y: item.y },
    previews: new Map([[`${item.x},${item.y}`, before]]),
  };
  event.currentTarget.setPointerCapture(event.pointerId);
}
function liftWidget() {
  if (!drag || drag.started) return;
  drag.started = true;
  const element = elements.get(drag.id),
    rect = element.getBoundingClientRect();
  const ghost = element.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.classList.remove('keyboard-moving', 'holding-widget', 'hold-ready');
  ghost.removeAttribute('aria-labelledby');
  ghost.removeAttribute('aria-describedby');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  ghost.style.width = rect.width + 'px';
  ghost.style.height = rect.height + 'px';
  ghost.style.transform = `translate3d(${rect.left}px,${rect.top}px,0)`;
  ghost.style.removeProperty('--left');
  ghost.style.removeProperty('--top');
  // Keep the same editing styles and content geometry as the card being held.
  $('.app-window').append(ghost);
  drag.ghost = ghost;
  if (!reducedMotion())
    drag.lift = ghost.animate([{ scale: '1' }, { scale: '1.012' }], {
      duration: 180,
      easing: MOTION_EASE,
    });
  element.classList.add('is-dragging');
  document.body.classList.add('drag-active');
}
function cancelHeldPress() {
  holdGesture.cancel();
}
const holdGesture = createHoldGesture({
  delay: WIDGET_HOLD_MS,
  onPending(candidate) {
    if (heldPress) elements.get(heldPress.id)?.classList.remove('holding-widget');
    heldPress = candidate;
    if (candidate) elements.get(candidate.id)?.classList.add('holding-widget');
  },
  onActivate(press) {
    const element = elements.get(press.id);
    if (!element?.isConnected) return;
    setEditing(true);
    window.getSelection()?.removeAllRanges();
    startPointerMove(
      {
        button: 0,
        currentTarget: element,
        pointerId: press.pointerId,
        clientX: press.x,
        clientY: press.y,
      },
      press.id,
    );
    liftWidget();
    element.classList.add('hold-ready');
    setTimeout(() => element.classList.remove('hold-ready'), 300);
    announce('Ready to rearrange. Drag the widget or its bottom corner.');
  },
});
function startHeldPress(event, id) {
  if (
    event.button !== 0 ||
    !event.isPrimary ||
    event.target.closest('button,input,textarea,a,select,[contenteditable]')
  )
    return;
  if (editing) {
    startPointerMove(event, id);
    return;
  }
  cancelHeldPress();
  holdGesture.start({ id, pointerId: event.pointerId, x: event.clientX, y: event.clientY });
}
function startResize(event, id) {
  if (event.button !== 0 || !event.isPrimary) return;
  event.preventDefault();
  event.stopPropagation();
  cancelHeldPress();
  closeWidgetMenu();
  if (drag) finishPointerMove(false);
  if (keyboardMove) finishKeyboardMove(true);
  finishLandings();
  clearTimeout(railTimer);
  const item = projectLayout(state, mode).find((widget) => widget.id === id);
  const before = structuredClone(state);
  resizeDrag = {
    id,
    pointerId: event.pointerId,
    handle: event.currentTarget,
    startX: event.clientX,
    startY: event.clientY,
    clientX: event.clientX,
    clientY: event.clientY,
    item,
    before,
    preview: before,
    target: { w: item.w, h: item.h },
    stepX: cellWidth + gap,
    stepY: rowHeight + gap,
    mode,
  };
  event.currentTarget.setPointerCapture(event.pointerId);
  elements.get(id).classList.add('is-resizing');
  document.body.classList.add('resize-active');
}
function resizeWithKeys(event, id) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const item = projectLayout(state, mode).find((widget) => widget.id === id);
  const w = item.w + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0);
  const h = item.h + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0);
  if (!commit({ type: 'resizeTo', id, w, h }, 'Widget resized.'))
    announce('Size limit reached. The other widgets remain on Home.');
}
function resizePosition() {
  if (!resizeDrag) return;
  const r = resizeDrag;
  const minWidth =
    r.mode === 'wide' ? CATALOG[r.item.type].sizes.small.w : r.mode === 'compact' ? 3 : 1;
  const w = Math.max(
    minWidth,
    snapDragCell(r.item.w + (r.clientX - r.startX) / r.stepX, r.target.w, MODES[r.mode]),
  );
  const h = Math.max(
    2,
    snapDragCell(r.item.h + (r.clientY - r.startY) / r.stepY, r.target.h, rowBudget),
  );
  if (r.target.w === w && r.target.h === h) return;
  r.target = { w, h };
  r.preview = w === r.item.w && h === r.item.h ? r.before : resizeToHome(r.before, r.id, w, h);
  const actual = projectLayout(r.preview, r.mode).find((item) => item.id === r.id);
  const limited = actual.w !== w || actual.h !== h;
  elements.get(r.id).querySelector('.resize-limit-note').hidden = !limited;
  if (limited && !r.limited) announce('Size limit reached. The other widgets remain on Home.');
  r.limited = limited;
  renderBoard();
}
function finishResize(keep) {
  if (!resizeDrag) return;
  clearGestureFrame();
  if (keep) resizePosition();
  const finished = resizeDrag;
  resizeDrag = null;
  if (finished.handle.hasPointerCapture(finished.pointerId))
    finished.handle.releasePointerCapture(finished.pointerId);
  elements.get(finished.id)?.classList.remove('is-resizing');
  document.body.classList.remove('resize-active');
  const limit = elements.get(finished.id)?.querySelector('.resize-limit-note');
  if (limit) limit.hidden = true;
  const changed = finished.preview !== finished.before;
  if (keep && changed) {
    undoState = finished.before;
    state = finished.preview;
    saveLayout();
  }
  renderBoard();
  if (changed) toast(keep ? 'Widget resized.' : 'Resize cancelled.', keep);
  scheduleRailHide();
}
function snapDragCell(value, previous, limit) {
  // A small deadband keeps the layout from flipping at a cell boundary.
  const snapped = Math.abs(value - previous) < 0.66 ? previous : Math.round(value);
  return Math.max(0, Math.min(limit, snapped));
}
function dragPosition() {
  if (!drag?.started) return;
  const rect = board.getBoundingClientRect(),
    d = drag;
  const left = d.clientX - d.offsetX,
    top = d.clientY - d.offsetY;
  d.ghost.style.transform = `translate3d(${left}px,${top}px,0)`;
  const x = snapDragCell(
    (left - rect.left) / (cellWidth + gap),
    d.target.x,
    MODES[d.mode] - d.item.w,
  );
  const y = snapDragCell((top - rect.top) / (rowHeight + gap), d.target.y, d.rows - d.item.h);
  if (d.target.x === x && d.target.y === y) return;
  d.target = { x, y };
  const key = `${x},${y}`;
  if (!d.previews.has(key))
    d.previews.set(key, previewMove(d.before, { id: d.id, x, y, mode: d.mode, rows: d.rows }));
  // Always preview from the pickup snapshot; moving back restores the old arrangement.
  const next = d.previews.get(key);
  if (next === d.preview) return;
  d.preview = next;
  renderBoard();
}
document.addEventListener(
  'pointermove',
  (event) => {
    holdGesture.move({ pointerId: event.pointerId, x: event.clientX, y: event.clientY });
    if (resizeDrag && event.pointerId === resizeDrag.pointerId) {
      event.preventDefault();
      resizeDrag.clientX = event.clientX;
      resizeDrag.clientY = event.clientY;
      queueGestureFrame();
      return;
    }
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    if (!drag.started && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6)
      return;
    event.preventDefault();
    liftWidget();
    queueGestureFrame();
  },
  { passive: false },
);
function landWidget(finished) {
  const element = elements.get(finished.id),
    ghost = finished.ghost;
  if (!ghost) return;
  const item = projectLayout(state, mode).find((item) => item.id === finished.id);
  let animation = null,
    done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    animation?.cancel();
    finished.lift?.cancel();
    ghost.remove();
    element?.classList.remove('is-dragging');
    landings.delete(cleanup);
  };
  landings.add(cleanup);
  if (reducedMotion() || !item || element.hidden) {
    cleanup();
    return;
  }
  const rect = board.getBoundingClientRect(),
    scale = getComputedStyle(ghost).scale;
  finished.lift?.cancel();
  const destination = `translate3d(${rect.left + item.x * (cellWidth + gap)}px,${rect.top + item.y * (rowHeight + gap)}px,0)`;
  ghost.classList.add('is-landing');
  animation = ghost.animate(
    [
      { transform: ghost.style.transform, scale },
      { transform: destination, scale: '1' },
    ],
    { duration: 300, easing: MOTION_EASE, fill: 'forwards' },
  );
  animation.finished.then(cleanup, cleanup);
}
function finishPointerMove(keep) {
  if (!drag) return;
  clearGestureFrame();
  if (keep) dragPosition();
  const finished = drag;
  drag = null;
  document.body.classList.remove('drag-active');
  if (finished.handle.hasPointerCapture(finished.pointerId))
    finished.handle.releasePointerCapture(finished.pointerId);
  if (finished.started) {
    const changed = finished.preview !== finished.before;
    if (keep && changed) {
      undoState = finished.before;
      state = finished.preview;
      saveLayout();
    }
    renderBoard();
    landWidget(finished);
    if (keep && changed) toast('Widget moved.', true);
    else announce(keep ? 'Widget placed.' : 'Move cancelled.');
  }
  scheduleRailHide();
}
document.addEventListener('pointerup', (event) => {
  cancelHeldPress();
  if (drag && event.pointerId === drag.pointerId) {
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    finishPointerMove(true);
  }
  if (resizeDrag && event.pointerId === resizeDrag.pointerId) {
    resizeDrag.clientX = event.clientX;
    resizeDrag.clientY = event.clientY;
    finishResize(true);
  }
});
document.addEventListener('pointercancel', () => {
  cancelHeldPress();
  finishPointerMove(false);
  finishResize(false);
});
document.addEventListener('lostpointercapture', (event) => {
  if (drag && event.pointerId === drag.pointerId) finishPointerMove(false);
  if (resizeDrag && event.pointerId === resizeDrag.pointerId) finishResize(false);
});
document.addEventListener(
  'keydown',
  (event) => {
    if (event.key === 'Escape') {
      cancelHeldPress();
      if (drag || resizeDrag) {
        event.preventDefault();
        event.stopPropagation();
        finishPointerMove(false);
        finishResize(false);
      }
    }
  },
  true,
);
document.addEventListener(
  'touchmove',
  (event) => {
    if (drag?.started || resizeDrag) event.preventDefault();
  },
  { passive: false },
);
scroller.addEventListener(
  'scroll',
  () => {
    cancelHeldPress();
    if (drag) queueGestureFrame();
    else closeWidgetMenu();
  },
  { passive: true },
);

function setRail(open, restore = false) {
  if (railOpen !== open) {
    cancelHeldPress();
    if (drag) finishPointerMove(false);
    if (resizeDrag) finishResize(false);
  }
  const workspace = $('.workspace');
  if (railOpen !== open) {
    finishLandings();
    workspace.classList.add('nav-transitioning');
    clearTimeout(railTransitionTimer);
    railTransitionTimer = setTimeout(() => workspace.classList.remove('nav-transitioning'), 340);
  }
  workspace.classList.toggle('nav-collapsed', !open);
  clearTimeout(railTimer);
  railOpen = open;
  rail.classList.toggle('is-hidden', !open);
  rail.inert = !open;
  rail.setAttribute('aria-hidden', String(!open));
  $('.nav-hint').setAttribute('aria-expanded', String(open));
  $('.nav-hint').style.visibility = open ? 'hidden' : 'visible';
  if (!open) {
    closeAccount();
    if (restore) $('.nav-hint').focus();
  }
}
function scheduleRailHide() {
  clearTimeout(railTimer);
  if (prefs.pin || drag || resizeDrag) return;
  railTimer = setTimeout(() => {
    if (
      !drag &&
      !resizeDrag &&
      !railHovered &&
      !rail.contains(document.activeElement) &&
      !accountOpen
    )
      setRail(false);
  }, 500);
}
$('.rail-zone').addEventListener('pointerenter', (event) => {
  if (event.pointerType === 'mouse') {
    railHovered = true;
    if (!drag && !resizeDrag) setRail(true);
  }
});
$('.rail-zone').addEventListener('pointerleave', (event) => {
  if (event.pointerType === 'mouse') {
    railHovered = false;
    scheduleRailHide();
  }
});
rail.addEventListener('focusin', () => clearTimeout(railTimer));
rail.addEventListener('focusout', () => setTimeout(scheduleRailHide, 0));
$('.nav-hint').addEventListener('click', () => {
  setRail(true);
  $('.nav-item').focus();
});
rail.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    if (accountOpen) {
      closeAccount();
      $('.account-trigger').focus();
    } else setRail(false, true);
  }
});
function closeAccount() {
  accountOpen = false;
  $('#account-menu').hidden = true;
  $('.account-trigger').setAttribute('aria-expanded', 'false');
}
$('.account-trigger').addEventListener('click', () => {
  accountOpen = !accountOpen;
  $('#account-menu').hidden = !accountOpen;
  $('.account-trigger').setAttribute('aria-expanded', String(accountOpen));
  if (accountOpen) $('#account-menu button').focus();
});
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.widget-menu,.widget-options')) closeWidgetMenu();
  if (!event.target.closest('.account-menu,.account-trigger')) closeAccount();
});
$$('[data-detail]').forEach((button) =>
  button.addEventListener('click', () => {
    const type = button.dataset.detail;
    if (live) {
      live.showPage(type);
      return;
    }
    if (type === 'home') {
      scroller.scrollTo({ top: 0, behavior: prefs.reducedMotion ? 'instant' : 'smooth' });
      return;
    }
    showDetail(type);
  }),
);
$$('[data-account-action]').forEach((button) =>
  button.addEventListener('click', () => {
    closeAccount();
    showDetail(button.dataset.accountAction);
  }),
);
function showDetail(type) {
  if (live && type === 'conversation') {
    live.focusConversation();
    return;
  }
  if (
    live &&
    ['home', 'goals', 'today', 'progress', 'activity', 'connections', 'chats', 'projects'].includes(
      type,
    )
  ) {
    live.showPage(type === 'today' || type === 'progress' ? 'goals' : type, {
      goalFilter:
        type === 'today' || type === 'goals' ? 'open' : type === 'progress' ? 'all' : undefined,
    });
    return;
  }
  detailReturnFocus = document.activeElement?.closest('.account-menu')
    ? $('.account-trigger')
    : document.activeElement;
  const body = $('.detail-body');
  body.innerHTML = '';
  const title = $('#detail-title');
  detail.dataset.detail = type;
  detail.classList.remove('live-conversation-dialog');
  if (live?.renderDetail(type, title, body)) {
    detail.showModal();
    return;
  }
  if (type === 'overflow') {
    title.textContent = 'More widgets';
    body.innerHTML =
      '<p class="muted">Bring a widget onto Home. Other views stay available here when space is full.</p><div class="overflow-list"></div>';
    for (const item of overflowWidgets()) {
      const row = document.createElement('div');
      row.className = 'overflow-item';
      const name = document.createElement('strong');
      name.textContent = TITLES[item.type];
      const button = document.createElement('button');
      button.className = 'button';
      button.textContent = 'Show on Home';
      button.setAttribute('aria-label', `Show ${TITLES[item.type]} on Home`);
      button.addEventListener('click', () => {
        undoState = state;
        state = placeOnHome(state, item.id);
        saveLayout();
        renderBoard();
        detail.close();
        toast(`${TITLES[item.type]} is on Home.`, true);
      });
      row.append(name, button);
      body.querySelector('.overflow-list').append(row);
    }
  } else if (type === 'today') {
    title.textContent = 'Your day';
    body.innerHTML = '<p class="muted">An example schedule for this prototype.</p><ul></ul>';
    SAMPLE.agenda.forEach((item) => {
      const li = document.createElement('li');
      const strong = document.createElement('strong');
      strong.textContent = item.title;
      const small = document.createElement('small');
      small.textContent = item.time;
      li.append(strong, small);
      body.querySelector('ul').append(li);
    });
  } else if (type === 'goals') {
    title.textContent = SAMPLE.goal.title;
    body.innerHTML =
      '<p>Preparing your application</p><h3>Up next</h3><p>Review résumé</p><h3>After résumé review</h3><p>Application draft</p><h3>What informed this</h3><p class="muted">Sample conversation: “I want to review my résumé before starting the application.” Removing this widget does not remove the goal.</p>';
  } else if (type === 'progress') {
    title.textContent = 'Practice this week';
    body.innerHTML =
      '<p>Three days with recorded practice in the sample week.</p><h3>Monday · Tuesday · Wednesday</h3><p class="muted">The figures in this prototype are examples. No activity source is connected.</p>';
  } else if (type === 'activity') {
    title.textContent = 'Recent updates';
    body.innerHTML =
      '<ul><li><strong>Résumé review is up next</strong><small>From the sample conversation</small></li><li><strong>Application draft follows the review</strong><small>Relationship captured in the sample goal</small></li></ul><h3>Layout and content</h3><p class="muted">Widget changes affect this home layout only. Sample goals and history are kept separately.</p>';
  } else if (type === 'connections') {
    title.textContent = 'Connections & privacy';
    body.innerHTML =
      '<p>This prototype has no connected accounts or activity sources.</p><p class="muted">Your layout, prototype name and optional note are stored in this browser. The sample agenda, goals and progress are fixtures.</p>';
  } else if (type === 'settings') {
    title.textContent = 'Settings';
    body.innerHTML =
      '<label class="check-option"><input type="checkbox" class="pin-setting">Keep navigation open</label><label class="check-option"><input type="checkbox" class="motion-setting">Reduce motion</label><h3>Home layout</h3><button class="button restore-defaults">Restore starter layout</button><p class="muted">Your note and saved contents are kept.</p>';
    body.querySelector('.pin-setting').checked = prefs.pin;
    body.querySelector('.motion-setting').checked = prefs.reducedMotion;
    body.querySelector('.pin-setting').addEventListener('change', (event) => {
      prefs.pin = event.target.checked;
      writeStorage(PREFS_KEY, prefs);
      if (prefs.pin) setRail(true);
      else scheduleRailHide();
    });
    body.querySelector('.motion-setting').addEventListener('change', (event) => {
      prefs.reducedMotion = event.target.checked;
      document.body.classList.toggle('reduce-motion', prefs.reducedMotion);
      finishLandings();
      writeStorage(PREFS_KEY, prefs);
    });
    body.querySelector('.restore-defaults').addEventListener('click', () => {
      undoState = state;
      state = createDefaultState();
      saveLayout();
      renderBoard();
      detail.close();
      toast('Starter layout restored.', true);
    });
    if (!live) {
      const link = document.createElement('a');
      link.className = 'button';
      link.textContent = 'Use this layout in eïlo';
      link.href = 'http://127.0.0.1:8765/home/' + layoutTransferHash(state, prefs);
      body.append(link);
    }
  } else if (type === 'profile') {
    title.textContent = live ? 'Local profile' : 'Prototype profile';
    body.innerHTML =
      '<form class="profile-form"><label class="field">Display name<input type="text" maxlength="40" autocomplete="off" required></label><button class="button primary">Save name</button></form><p class="muted">This display name is saved in this browser. It does not change your sign-in account.</p>';
    body.querySelector('input').value = prefs.name;
    body.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const value = body.querySelector('input').value.trim();
      if (!value) return;
      prefs.name = value;
      writeStorage(PREFS_KEY, prefs);
      renderProfile();
      detail.close();
      toast('Display name saved.');
    });
  } else {
    title.textContent = 'Your home, your way';
    body.innerHTML = `<p>Use Edit home to add, move, resize or remove widgets. Your choices are saved in this browser.</p><h3>Keyboard movement</h3><p>Focus a widget’s move handle and press Space. Use arrow keys to move it, Enter to place it, or Escape to cancel.</p><h3>Optional customization</h3><p class="muted">You arrange the views. ${live ? 'Describe commitments and changes in your conversation. eïlo updates the saved information shown on Home.' : 'This prototype uses sample data and a visual conversation preview.'}</p>`;
  }
  detail.showModal();
}
function renderProfile() {
  $('.account-trigger').textContent = Array.from(prefs.name)[0].toUpperCase();
  $('.account-name').firstChild.textContent = prefs.name;
}
$('.detail-close').addEventListener('click', () => detail.close());
detail.addEventListener('close', () => {
  if (live?.ownsConversationFocus()) return;
  if (!detailReturnFocus?.isConnected) return;
  if (detailReturnFocus.closest('.nav-rail')) setRail(true);
  detailReturnFocus.focus();
});
for (const dialog of [detail, gallery])
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    }
  });
window.addEventListener('resize', () => {
  cancelHeldPress();
  if (drag) finishPointerMove(false);
  if (resizeDrag) finishResize(false);
  if (keyboardMove) finishKeyboardMove(false);
  finishLandings();
  closeWidgetMenu();
  if (gallery.open) galleryController.position();
});
const observer = new ResizeObserver(() => {
  const signature = [scroller.clientWidth, scroller.clientHeight].join(':');
  if (signature === lastGeometry) return;
  lastGeometry = signature;
  cancelAnimationFrame(geometryFrame);
  geometryFrame = requestAnimationFrame(renderBoard);
});
observer.observe(scroller);
window.addEventListener('blur', () => {
  cancelHeldPress();
  finishPointerMove(false);
  finishResize(false);
});
window.addEventListener('pagehide', () => {
  cancelHeldPress();
  if (drag) finishPointerMove(false);
  finishLandings();
  if (resizeDrag) finishResize(false);
  if (keyboardMove) finishKeyboardMove(false);
  writeStorage(CONTENT_KEY, content);
});
motionPreference.addEventListener('change', () => {
  finishLandings();
  if (reducedMotion()) drag?.lift?.cancel();
});
document.body.classList.toggle('reduce-motion', prefs.reducedMotion);
renderProfile();
showStorageWarning();
setRail(prefs.pin);
renderBoard();
updateClock();
setInterval(updateClock, 30000);
if (transferred) {
  writeStorage(KEY, state);
  writeStorage(PREFS_KEY, prefs);
  history.replaceState(null, '', location.pathname + location.search);
}
live?.start();

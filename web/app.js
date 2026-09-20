import { createInlineDialog } from './workspace/inline-dialog.js';
import './styles/focus.js';
import {
  CATALOG,
  MODES,
  createDefaultState,
  applyOnboardingLayout,
  normalizeState,
  tidyHomeLayout,
  withUniqueSourceWidgets,
  paginateHomeLayout,
  projectLayout,
  updateLayout,
  previewMove,
  previewWidgetAddition,
  resizeWithinHome,
  layoutTransferHash,
  readLayoutTransfer,
  withConversationDock,
  withTrackingWidgets,
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
import { contextWidgetId, syncContextWidgets } from './home/context-layout.js';
import { isLiveWidget } from './home/live-widgets.js';
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
  tracking: 'Tracking',
  usage: 'Browser usage',
  context: 'Work context',
};
const DEFAULT_SIZE = {
  today: 'medium',
  goals: 'large',
  progress: 'small',
  conversation: 'medium',
  clock: 'small',
  notes: 'small',
  tracking: 'small',
  usage: 'medium',
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
const openInlineDetail = createInlineDialog(detail);
const elements = new Map();
const homeStorage = createHomeStorage();
const transferred =
  document.documentElement.dataset.source === 'live' ? readLayoutTransfer(location.hash) : null;
const savedLayout = homeStorage.read(KEY, null);
let state = normalizeState(transferred?.layout ?? savedLayout ?? createDefaultState());
if (createLiveHome)
  state = withUniqueSourceWidgets(withTrackingWidgets(withConversationDock(state)));
const content = normalizeHomeContent(homeStorage.read(CONTENT_KEY, {}));
const prefs = normalizeHomePreferences({
  ...homeStorage.read(PREFS_KEY, {}),
  ...transferred?.preferences,
});
// Migrate the old window-sized board once; future custom placement stays untouched.
if (createLiveHome && prefs.homeLayoutVersion < 2) {
  if (savedLayout && !transferred) {
    homeStorage.write(KEY + ':before-scroll', homeStorage.read(KEY, state));
    state.widgets = state.widgets.map((widget) =>
      ['today', 'goals', 'progress', 'tracking', 'usage'].includes(widget.type)
        ? {
            ...widget,
            size: widget.type === 'usage' ? 'medium' : 'small',
            footprints: {
              wide: { w: widget.type === 'usage' ? 8 : 4, h: 2 },
              compact: { w: widget.type === 'usage' ? 6 : 3, h: 2 },
              stacked: { w: 1, h: 2 },
            },
          }
        : widget,
    );
    for (const layoutMode of Object.keys(MODES)) state = tidyHomeLayout(state, layoutMode);
  }
  prefs.homeLayoutVersion = 2;
  homeStorage.write(KEY, state);
  homeStorage.write(PREFS_KEY, prefs);
}

let editing = false,
  mode = 'wide',
  rowHeight = 118,
  cellWidth = 60,
  gap = 20,
  rowBudget = 4;
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
let navPointer = null;
let railHovered = false,
  railOpen = true,
  accountOpen = false,
  detailReturnFocus = null;
let adaptivePreviewMode =
  document.documentElement.dataset.source === 'sample' &&
  new URLSearchParams(location.search).get('adaptive-preview') === '1';
let adaptiveHome = null;
let homePage = 0;
let placement = null;
let contextInput = null;
let contextRenderVersion = 0;
const widgetTitle = (widget) => adaptiveHome?.component(widget)?.title || TITLES[widget.type];
const icon = (name) => `<svg aria-hidden="true"><use href="#${name}"/></svg>`;
const live =
  document.documentElement.dataset.source === 'live'
    ? createLiveHome({
        openDetail: showDetail,
        onSettingsSection: (id) => adaptiveHome?.selectSettings(id),
        dialog: detail,
        getSoundEnabled: () => prefs.soundEffects,
        getPreferences: () => prefs,
        setDailyGuidance: (enabled) => {
          prefs.dailyGuidance = enabled === true;
          writeStorage(PREFS_KEY, prefs);
          live?.refreshPreferences();
        },
        setSoundEnabled: (enabled) => {
          prefs.soundEffects = enabled === true;
          const saved = writeStorage(PREFS_KEY, prefs);
          live?.refreshPreferences();
          return saved;
        },
        applyWorkspace: (setup) => {
          const next = applyOnboardingLayout(state, setup);
          if (next === state) return true;
          if (editing) setEditing(false);
          state = next;
          homePage = 0;
          const saved = writeStorage(KEY, state);
          requestAnimationFrame(renderBoard);
          return saved;
        },
        onViewChange: () => {
          adaptiveHome?.hideSettings();
          if (editing) setEditing(false);
          closeAccount();
          closeWidgetMenu();
          if (!prefs.pin && matchMedia('(max-width: 700px)').matches) setRail(false);
          requestAnimationFrame(renderBoard);
        },
        refreshWidgets: () => {
          for (const element of elements.values()) {
            if (!isLiveWidget(element.dataset.type)) continue;
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
  if (key === PREFS_KEY) window.dispatchEvent(new Event('eilo-preferences-changed'));
  if (!saved) showStorageWarning();
  return saved;
}
function showStorageWarning() {
  $('.storage-warning').hidden = !homeStorage.message;
  $('.storage-warning').textContent = homeStorage.message;
}
function saveLayout() {
  if (placement) return;
  const restored = new Set(state.widgets.map((widget) => widget.componentId).filter(Boolean));
  const dismissed = prefs.dismissedContextWidgets.filter((id) => !restored.has(id));
  if (dismissed.length !== prefs.dismissedContextWidgets.length) {
    prefs.dismissedContextWidgets = dismissed;
    writeStorage(PREFS_KEY, prefs);
  }
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
  if (placement || !undoState) return;
  finishLandings();
  state = undoState;
  undoState = null;
  saveLayout();
  renderBoard();
  toast('Layout change undone.');
  $('.edit-toggle').focus();
});
function homePages(base = state, layoutMode = mode) {
  return live ? paginateHomeLayout(base, layoutMode, rowBudget) : [projectLayout(base, layoutMode)];
}
function projectHomeLayout(base, layoutMode = mode) {
  const pages = homePages(base, layoutMode);
  return pages[Math.min(homePage, Math.max(0, pages.length - 1))] || [];
}
function changeHomePage(base, transform) {
  if (!live) return transform(base);
  const pages = homePages(base);
  const index = Math.min(homePage, Math.max(0, pages.length - 1));
  const page = pages[index] || [];
  const ids = new Set(page.map((item) => item.id));
  const local = {
    version: 1,
    widgets: base.widgets
      .filter((widget) => ids.has(widget.id))
      .map((widget) => {
        const item = page.find((item) => item.id === widget.id);
        return {
          ...widget,
          footprints: { ...widget.footprints, [mode]: { w: item.w, h: item.h } },
        };
      }),
    positions: { [mode]: page.map(({ id, x, y }) => ({ id, x, y })) },
  };
  const changed = transform(local);
  if (changed === local) return base;
  const positions = pages.flatMap((items, pageIndex) =>
    (pageIndex === index ? projectLayout(changed, mode) : items).map(({ id, x, y }) => ({
      id,
      x,
      y: y + pageIndex * rowBudget,
    })),
  );
  return {
    ...base,
    widgets: base.widgets.map((widget) => {
      const before = local.widgets.find((item) => item.id === widget.id);
      const after = changed.widgets.find((item) => item.id === widget.id);
      return before && after && JSON.stringify(before) !== JSON.stringify(after)
        ? { ...widget, ...after, footprints: { ...widget.footprints, ...after.footprints } }
        : widget;
    }),
    positions: { ...base.positions, [mode]: positions },
  };
}
function previewHomeMove(base, action) {
  if (placement?.id === action.id) return placementPreview(base, action);
  return changeHomePage(base, (local) => previewMove(local, action));
}
function commit(action, message) {
  if (action.type === 'move') {
    const item = projectHomeLayout(state, mode).find((item) => item.id === action.id);
    if (item) action = { ...action, y: Math.max(0, Math.min(rowBudget - item.h, action.y)) };
  }
  const next =
    action.type === 'resizeTo'
      ? resizeToHome(state, action.id, action.w, action.h)
      : action.type === 'move'
        ? previewHomeMove(state, { ...action, mode, rows: rowBudget })
        : updateLayout(state, { ...action, mode });
  if (next === state) return false;
  undoState = state;
  state = next;
  saveLayout();
  renderBoard();
  if (message && !placement) toast(message, true);
  return true;
}
function resizeToHome(base, id, w, h) {
  if (placement?.id === id) return placementPreview(base, { id, w, h });
  return changeHomePage(base, (local) =>
    resizeWithinHome(local, { id, w, h, mode, rows: rowBudget }),
  );
}
function placeOnHome(base, id) {
  const item = projectHomeLayout(base, mode).find((item) => item.id === id);
  if (!item) return base;
  const next =
    item.h > rowBudget
      ? updateLayout(base, { type: 'resizeTo', id, w: item.w, h: rowBudget, mode })
      : base;
  return updateLayout(next, { type: 'move', id, x: 0, y: 0, mode });
}
function overflowWidgets() {
  return projectHomeLayout(state, mode).filter((item) => item.y + item.h > rowBudget);
}
function renderBody(widget, container, preview = false) {
  if (widget.type === 'context') {
    if (!adaptiveHome?.renderWidget(widget, container, preview)) {
      const heading = document.createElement('h2');
      heading.textContent = 'Work context';
      const text = document.createElement('p');
      text.className = 'live-empty';
      text.textContent = 'Waiting for current context…';
      container.replaceChildren(heading, text);
    }
    return;
  }
  if (live?.renderBody(widget, container)) return;
  renderSampleWidget(widget, container, {
    content,
    preview,
    onOpenGoals: () => showDetail('goals'),
    onNotesChange: (input) => {
      content.notes = input.value;
      $$('.widget[data-type="notes"] .note-input')
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
  element.className = 'widget home-widget';
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
  remove.setAttribute('aria-label', `Remove ${widgetTitle(widget)} widget`);
  remove.title = `Remove ${widgetTitle(widget)} widget`;
  const grip = document.createElement('button');
  grip.className = 'move-widget';
  grip.innerHTML = icon('grip');
  grip.setAttribute('aria-label', `Move ${widgetTitle(widget)} widget`);
  grip.setAttribute('aria-describedby', 'move-help');
  grip.title = 'Drag to move, or press Space and use arrow keys';
  const options = document.createElement('button');
  options.className = 'widget-options';
  options.innerHTML = icon('more');
  options.setAttribute('aria-label', `${widgetTitle(widget)} widget options`);
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
  resize.setAttribute('aria-label', `Resize ${widgetTitle(widget)} widget`);
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
  // A hidden Home keeps its last valid geometry until it is visible again.
  const containerStyle = getComputedStyle(scroller);
  const width =
    scroller.clientWidth -
    (parseFloat(containerStyle.paddingLeft) || 0) -
    (parseFloat(containerStyle.paddingRight) || 0);
  if (width <= 0 || scroller.clientHeight <= 0) return false;
  mode = width >= 960 ? 'wide' : width >= 640 ? 'compact' : 'stacked';
  gap = mode === 'stacked' ? 16 : 20;
  rowBudget = placement?.rows ?? (mode !== 'stacked' && scroller.clientHeight >= 490 ? 4 : 2);
  rowHeight = Math.min(
    132,
    Math.max(1, Math.floor((scroller.clientHeight - (rowBudget - 1) * gap - 4) / rowBudget)),
  );
  cellWidth = (width - (MODES[mode] - 1) * gap) / MODES[mode];
  return true;
}
function renderBoard() {
  if (adaptivePreviewMode) return;
  if (scroller.hidden) return;
  if (!updateGeometry()) return;
  const pages = homePages(drag?.preview ?? resizeDrag?.preview ?? keyboardMove?.preview ?? state);
  homePage = Math.min(homePage, Math.max(0, pages.length - 1));
  const layout = projectHomeLayout(
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
    const signature = [
      widget.type,
      widget.size,
      widget.w,
      widget.h,
      widget.type === 'context' ? contextRenderVersion : '',
    ].join(':');
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
    for (const [selector, label] of [
      ['.remove-widget', `Remove ${widgetTitle(widget)} widget`],
      ['.move-widget', `Move ${widgetTitle(widget)} widget`],
      ['.widget-options', `${widgetTitle(widget)} widget options`],
      ['.resize-widget', `Resize ${widgetTitle(widget)} widget`],
    ])
      element.querySelector(selector).setAttribute('aria-label', label);
    element.hidden = false;
    element.style.setProperty('--left', widget.x * (cellWidth + gap) + 'px');
    element.style.setProperty('--top', widget.y * (rowHeight + gap) + 'px');
    element.style.setProperty('--width', widget.w * cellWidth + (widget.w - 1) * gap + 'px');
    element.style.setProperty('--height', widget.h * rowHeight + (widget.h - 1) * gap + 'px');
    element.querySelector('.widget-tools').inert = !editing;
  }
  const rows = Math.max(0, ...layout.map((item) => item.y + item.h));
  board.style.height = Math.max(0, rows * rowHeight + (rows - 1) * gap) + 'px';
  if (live) {
    pageLabel.textContent = `Page ${homePage + 1} of ${pages.length}`;
    pager.hidden = pages.length <= 1;
    if (pageDots.children.length !== pages.length) {
      pageDots.replaceChildren();
      for (let index = 0; index < pages.length; index++) {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'home-page-dot';
        dot.setAttribute('aria-label', `Page ${index + 1}`);
        dot.addEventListener('click', () => turnWidgetPage(index - homePage));
        pageDots.append(dot);
      }
    }
    for (const [index, dot] of [...pageDots.children].entries())
      dot.setAttribute('aria-current', index === homePage ? 'page' : 'false');
    previousPage.disabled = homePage === 0;
    nextPage.disabled = homePage >= pages.length - 1;
  }
  board.hidden = layout.length === 0;
  $('.empty-home').hidden = layout.length !== 0;
  $('.overflow-toggle').hidden = true;
  $('.add-toggle').hidden = false;
  renderPlacement(layout);
  if (menuId && !ids.has(menuId)) closeWidgetMenu();
}
function removeWidget(id) {
  if (placement) return;
  const widget = state.widgets.find((item) => item.id === id);
  if (!widget) return;
  closeWidgetMenu();
  const removed = commit(
    { type: 'remove', id },
    `${widgetTitle(widget)} removed from Home. Its contents are kept.`,
  );
  if (removed && widget.componentId) {
    prefs.dismissedContextWidgets = [
      ...new Set([...prefs.dismissedContextWidgets, widget.componentId]),
    ].slice(-128);
    writeStorage(PREFS_KEY, prefs);
  }
  $('.edit-toggle').focus();
}
function setEditing(value) {
  if (!value && placement) finishPlacement(false);
  cancelHeldPress();
  if (resizeDrag) finishResize(false);
  if (drag) finishPointerMove(false);
  if (keyboardMove) finishKeyboardMove(false);
  finishLandings();
  editing = value;
  $('.app-window').classList.toggle('editing', editing);
  if (!editing) queueMicrotask(() => adaptiveHome?.flush());
  closeWidgetMenu();
  $('.add-toggle').hidden = false;
  document.querySelector('.tidy-home')?.toggleAttribute('hidden', !editing);
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
$('.edit-toggle').addEventListener('pointerdown', () => {
  if (placement && keyboardMove) finishKeyboardMove(true);
});
$('.edit-toggle').addEventListener('click', () => {
  if (placement) finishPlacement(true);
  else setEditing(!editing);
});
$('.app-window').addEventListener('pointerdown', (event) => {
  if (
    !editing ||
    placement ||
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
const widgetCatalog = Object.fromEntries(
  Object.entries(CATALOG).filter(
    ([type]) => type !== 'context' && (!live || type !== 'conversation'),
  ),
);
const galleryController = createWidgetGallery({
  dialog: gallery,
  appWindow: $('.app-window'),
  catalog: widgetCatalog,
  titles: TITLES,
  defaultSizes: DEFAULT_SIZE,
  renderPreview: (widget, container) => {
    const component = adaptiveHome
      ?.components()
      .find((item) => contextWidgetId(item.id) === widget.type);
    renderBody(
      component ? { ...widget, type: 'context', componentId: component.id } : widget,
      container,
      true,
    );
  },
  getWidgetCount: () => state.widgets.length,
  onOpening: () => {
    if (!editing) setEditing(true);
    closeWidgetMenu();
    closeAccount();
    updateContextGallery();
    return document.activeElement;
  },
  onAdd: (type, size) => {
    if (
      live &&
      ['today', 'goals', 'progress', 'tracking', 'usage'].includes(type) &&
      state.widgets.some((widget) => widget.type === type)
    ) {
      toast(`${TITLES[type]} is already on Home.`);
      return null;
    }
    const component = adaptiveHome?.components().find((item) => contextWidgetId(item.id) === type);
    const id = component ? contextWidgetId(component.id) : `${type}-${crypto.randomUUID()}`;
    $('.toast').hidden = true;
    clearTimeout(toastTimer);
    placement = {
      before: state,
      undo: undoState,
      id,
      page: homePage,
      rows: rowBudget,
      widget: {
        id,
        type: component ? 'context' : type,
        size,
        ...(component ? { componentId: component.id } : {}),
      },
    };
    state = previewWidgetAddition(placement.before, placement.widget, {
      mode,
      rows: rowBudget,
      page: homePage,
    });
    renderBoard();
    announce('Move or resize the widget, then choose Place. Escape cancels.');
    return elements.get(id)?.querySelector('.move-widget') || null;
  },
});
$('.add-toggle').addEventListener('click', () => galleryController.open());
$('.empty-add').addEventListener('click', () => {
  setEditing(true);
  galleryController.open();
});
const pager = document.createElement('nav');
pager.className = 'home-pagination';
pager.setAttribute('aria-label', 'Home widget pages');
pager.hidden = !live;
const pageLabel = document.createElement('span');
pageLabel.className = 'sr-only';
pageLabel.setAttribute('role', 'status');
const pageActions = document.createElement('div');
pageActions.className = 'home-page-actions';
const pageDots = document.createElement('div');
pageDots.className = 'home-page-dots';
const previousPage = document.createElement('button');
previousPage.className = 'home-page-arrow';
previousPage.innerHTML = icon('arrow-left');
previousPage.setAttribute('aria-label', 'Previous widgets');
const nextPage = document.createElement('button');
nextPage.className = 'home-page-arrow';
nextPage.innerHTML = icon('arrow-right');
nextPage.setAttribute('aria-label', 'Next widgets');
function turnWidgetPage(step) {
  if (placement) return;
  cancelHeldPress();
  if (keyboardMove) finishKeyboardMove(false);
  closeWidgetMenu();
  finishLandings();
  homePage = Math.max(0, homePage + step);
  renderBoard();
}
previousPage.addEventListener('click', () => turnWidgetPage(-1));
nextPage.addEventListener('click', () => turnWidgetPage(1));
pageActions.append(previousPage, pageDots, nextPage);
pager.append(pageLabel, pageActions);
scroller.after(pager);
const tidyButton = document.createElement('button');
tidyButton.className = 'button tidy-home';
tidyButton.textContent = 'Tidy layout';
tidyButton.hidden = true;
tidyButton.addEventListener('click', () => {
  undoState = state;
  state = tidyHomeLayout(state, mode);
  saveLayout();
  renderBoard();
  toast('Widgets aligned. Sizes and contents kept.', true);
});
$('.edit-toggle').before(tidyButton);
$('.overflow-toggle').addEventListener('click', () => showDetail('overflow'));

const placementCancel = document.createElement('button');
placementCancel.className = 'button placement-cancel';
placementCancel.textContent = 'Cancel';
placementCancel.hidden = true;
placementCancel.addEventListener('click', () => finishPlacement(false));
$('.edit-toggle').before(placementCancel);
const placementImpact = document.createElement('p');
placementImpact.className = 'placement-impact';
placementImpact.setAttribute('role', 'status');
placementImpact.hidden = true;
$('.home-header').append(placementImpact);

function placementPreview(base, action) {
  const item = projectHomeLayout(base, mode).find((item) => item.id === placement.id);
  return previewWidgetAddition(placement.before, placement.widget, {
    mode,
    rows: rowBudget,
    page: placement.page,
    x: action.x ?? item.x,
    y: action.y ?? item.y,
    w: action.w ?? item.w,
    h: action.h ?? item.h,
  });
}
function renderPlacement(layout) {
  $('.app-window').classList.toggle('placing-widget', Boolean(placement));
  placementCancel.hidden = !placement;
  placementImpact.hidden = !placement;
  $('.add-toggle').disabled = Boolean(placement);
  tidyButton.disabled = Boolean(placement);
  for (const button of pageDots.querySelectorAll('button')) button.disabled = Boolean(placement);
  if (placement) {
    previousPage.disabled = true;
    nextPage.disabled = true;
  }
  for (const [id, element] of elements) {
    element.inert = Boolean(placement && id !== placement.id);
    element.querySelector('.widget-content').inert = Boolean(placement);
    element.classList.toggle('placement-candidate', placement?.id === id);
  }
  if (!placement) return;
  $('.edit-toggle').textContent = 'Place';
  $('.save-state').textContent = '';
  const ids = new Set(layout.map((item) => item.id));
  const moved =
    homePages(placement.before)[placement.page]?.filter((item) => !ids.has(item.id)) || [];
  const message = moved.length
    ? 'Moves to another page: ' + moved.map(widgetTitle).join(', ')
    : 'All widgets fit';
  if (placementImpact.textContent !== message) placementImpact.textContent = message;
}
function finishPlacement(keep) {
  if (!placement) return;
  if (drag) finishPointerMove(keep);
  if (resizeDrag) finishResize(keep);
  if (keyboardMove) finishKeyboardMove(keep);
  const pending = placement;
  placement = null;
  if (keep) undoState = pending.before;
  else {
    state = pending.before;
    undoState = pending.undo;
    homePage = pending.page;
  }
  setEditing(false);
  if (keep) toast('Widget placed.', true);
  else announce('Placement cancelled.');
  $('.add-toggle').focus();
}

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
  menu.replaceChildren();
  scroller.append(menu);
  const title = document.createElement('h2');
  title.textContent = widgetTitle(widget) + ' options';
  const close = document.createElement('button');
  close.textContent = 'Close';
  close.setAttribute('aria-label', 'Close widget options');
  close.addEventListener('click', () => {
    closeWidgetMenu();
    elements.get(id)?.querySelector('.widget-options').focus();
  });
  const header = document.createElement('div');
  header.className = 'inline-options-heading';
  header.append(title, close);
  menu.append(header);
  const resizeAction = document.createElement('button');
  resizeAction.textContent = 'Resize with arrow keys';
  resizeAction.addEventListener('click', () => {
    closeWidgetMenu();
    elements.get(id)?.querySelector('.resize-widget').focus();
    announce('Use arrow keys to resize this widget.');
  });
  menu.append(resizeAction);
  if (widget.componentId) {
    const pinAction = document.createElement('button');
    const pinned = contextInput?.pins.includes(widget.componentId);
    pinAction.textContent = pinned ? 'Let eïlo replace this widget' : 'Keep on Home';
    pinAction.addEventListener('click', async () => {
      pinAction.disabled = true;
      await adaptiveHome.setPinned(widget.componentId, !pinned);
      closeWidgetMenu();
    });
    menu.append(pinAction);
  }
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
    button.setAttribute('aria-label', `Move ${widgetTitle(widget)} ${name}`);
    button.addEventListener('click', () => {
      const item = projectHomeLayout(state, mode).find((item) => item.id === id);
      closeWidgetMenu();
      commit(
        { type: 'move', id, x: item.x + dx, y: item.y + dy },
        `${widgetTitle(widget)} moved ${name}.`,
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
  scroller.scrollTop = 0;
  menu.querySelector('button').focus();
}
$('.widget-menu').addEventListener('keydown', (event) => {
  const buttons = [...$('.widget-menu').querySelectorAll('button')];
  if (event.key === 'Escape') {
    event.preventDefault();
    const id = menuId;
    event.stopPropagation();
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
      item = projectHomeLayout(before, mode).find((widget) => widget.id === id);
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
    moving.preview = previewHomeMove(moving.before, { id, x, y, mode, rows: rowBudget });
    renderBoard();
    const placed = projectHomeLayout(moving.preview, mode).find((widget) => widget.id === id);
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
  if (keep && changed && !placement) toast('Widget moved.', true);
  else announce(keep ? (placement ? 'Position previewed.' : 'Widget placed.') : 'Move cancelled.');
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
    item = projectHomeLayout(before, mode).find((item) => item.id === id);
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
  const item = projectHomeLayout(state, mode).find((widget) => widget.id === id);
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
  const item = projectHomeLayout(state, mode).find((widget) => widget.id === id);
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
  const actual = projectHomeLayout(r.preview, r.mode).find((item) => item.id === r.id);
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
  if (changed && !placement) toast(keep ? 'Widget resized.' : 'Resize cancelled.', keep);
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
    d.previews.set(key, previewHomeMove(d.before, { id: d.id, x, y, mode: d.mode, rows: d.rows }));
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
  const item = projectHomeLayout(state, mode).find((item) => item.id === finished.id);
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
    if (keep && changed && !placement) toast('Widget moved.', true);
    else
      announce(keep ? (placement ? 'Position previewed.' : 'Widget placed.') : 'Move cancelled.');
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
      if (placement && !drag && !resizeDrag && !keyboardMove) {
        event.preventDefault();
        event.stopPropagation();
        finishPlacement(false);
        return;
      }
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
function pointerNearRail() {
  if (!navPointer) return false;
  const bounds = rail.getBoundingClientRect();
  return (
    navPointer.x <= 24 ||
    (railOpen &&
      navPointer.x >= bounds.left - 20 &&
      navPointer.x <= bounds.right + 20 &&
      navPointer.y >= bounds.top - 24 &&
      navPointer.y <= bounds.bottom + 24)
  );
}
function scheduleRailHide() {
  clearTimeout(railTimer);
  if (prefs.pin || drag || resizeDrag) return;
  railTimer = setTimeout(() => {
    if (
      !drag &&
      !resizeDrag &&
      !railHovered &&
      !pointerNearRail() &&
      (!rail.contains(document.activeElement) || document.body.dataset.focusOrigin === 'pointer') &&
      !accountOpen
    )
      setRail(false);
  }, 1400);
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
document.addEventListener(
  'pointermove',
  (event) => {
    if (event.pointerType !== 'mouse' || drag || resizeDrag) return;
    navPointer = { x: event.clientX, y: event.clientY };
    if (pointerNearRail()) {
      railHovered = true;
      clearTimeout(railTimer);
      if (!railOpen) setRail(true);
    } else if (railHovered) {
      railHovered = false;
      scheduleRailHide();
    }
  },
  { passive: true },
);
document.addEventListener('pointerleave', () => {
  navPointer = null;
  railHovered = false;
  scheduleRailHide();
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
  const host = document.querySelector('.workspace-page:not([hidden])') || scroller;
  host.append($('#account-menu'));
  host.scrollTop = 0;
  $('#account-menu').hidden = !accountOpen;
  $('.account-trigger').setAttribute('aria-expanded', String(accountOpen));
  if (accountOpen) $('#account-menu button').focus();
});
const accountClose = document.createElement('button');
accountClose.textContent = 'Close';
accountClose.setAttribute('aria-label', 'Close account options');
accountClose.addEventListener('click', () => {
  closeAccount();
  $('.account-trigger').focus();
});
$('#account-menu').prepend(accountClose);
$('#account-menu').addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  closeAccount();
  $('.account-trigger').focus();
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
  if (live && type === 'browser-setup') {
    live.showPage('connections', { connectionId: 'activity' });
    return;
  }
  if (live && ['settings', 'profile', 'help'].includes(type)) {
    live.showPage('settings', { settingsSection: 'general' });
    return;
  }
  if (live && type === 'conversation') {
    live.focusConversation();
    return;
  }
  if (
    live &&
    [
      'home',
      'goals',
      'today',
      'progress',
      'activity',
      'connections',
      'settings',
      'chats',
      'projects',
    ].includes(type)
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
    openInlineDetail();
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
      name.textContent = widgetTitle(item);
      const button = document.createElement('button');
      button.className = 'button';
      button.textContent = 'Show on Home';
      button.setAttribute('aria-label', `Show ${widgetTitle(item)} on Home`);
      button.addEventListener('click', () => {
        undoState = state;
        state = placeOnHome(state, item.id);
        saveLayout();
        renderBoard();
        detail.close();
        toast(`${widgetTitle(item)} is on Home.`, true);
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
      '<label class="check-option"><input type="checkbox" class="pin-setting">Keep navigation open</label><label class="check-option"><input type="checkbox" class="pin-setting">Keep sidebar open</label><label class="check-option"><input type="checkbox" class="motion-setting">Reduce motion</label><h3>Home layout</h3><button class="button restore-defaults">Restore starter layout</button><p class="muted">Your note and saved contents are kept.</p>';
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
      '<form class="profile-form"><label class="field">Your name<input type="text" maxlength="40" placeholder="Your name" autocomplete="given-name" required></label><button class="button primary">Save name</button></form><p class="muted">This display name is saved in this browser. It does not change your sign-in account.</p>';
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
    body.innerHTML = `<p>Choose Edit home, then change one widget.</p><details><summary>Keyboard controls</summary><p>Focus a widget’s move handle and press Space. Use arrow keys to move it, Enter to place it, or Escape to cancel.</p></details><details><summary>About Home</summary><p class="muted">Your layout is saved in this browser. ${live ? 'Describe commitments and changes in your conversation to update the information shown here.' : 'This prototype uses sample data and a visual conversation preview.'}</p></details>`;
  }
  openInlineDetail();
}
function renderProfile() {
  $('.account-trigger').textContent = Array.from(prefs.name)[0]?.toUpperCase() || 'ë';
  $('.account-name').firstChild.textContent = prefs.name || 'Add your name';
}
$('.detail-close').addEventListener('click', () => detail.close());
detail.addEventListener('close', () => {
  if (live?.ownsConversationFocus()) return;
  if (!detailReturnFocus?.isConnected || detailReturnFocus.closest('[hidden]')) return;
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
function createGeneralSettings() {
  const section = document.createElement('section');
  section.className = 'general-settings';
  section.innerHTML = `<h2>General</h2><form class="profile-form"><label class="field">Your name<input type="text" maxlength="40" placeholder="Your name" autocomplete="given-name" required></label><button class="button">Save name</button><p class="settings-feedback" role="status"></p></form><label class="check-option"><input type="checkbox" class="pin-setting">Keep sidebar open</label><label class="check-option"><input type="checkbox" class="motion-setting">Reduce motion</label><label class="field speech-preference">Microphone mode</label><h3>Check-ins & alerts</h3><button class="button settings-checkins">Manage check-ins</button><details><summary>Keyboard controls</summary><p>In Edit home, focus a move handle and press Space. Use arrow keys to move, Enter to place, or Escape to cancel. Use arrow keys on a resize handle to change its size.</p></details>`;
  const soundOption = document.createElement('label');
  soundOption.className = 'check-option';
  const soundInput = document.createElement('input');
  soundInput.type = 'checkbox';
  soundInput.checked = prefs.soundEffects;
  soundOption.append(soundInput, document.createTextNode('Interface sounds'));
  soundInput.addEventListener('change', () => {
    prefs.soundEffects = soundInput.checked;
    writeStorage(PREFS_KEY, prefs);
    live.refreshPreferences();
  });
  const soundControls = document.createElement('div');
  soundControls.className = 'sound-settings-controls';
  const volume = document.createElement('input');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '1';
  volume.step = '0.05';
  volume.value = String(prefs.soundVolume);
  volume.setAttribute('aria-label', 'Interface sound volume');
  volume.addEventListener('input', () => {
    prefs.soundVolume = Number(volume.value);
    writeStorage(PREFS_KEY, prefs);
    live.refreshPreferences();
  });
  const testSound = document.createElement('button');
  testSound.type = 'button';
  testSound.className = 'button';
  testSound.textContent = 'Play test sound';
  const soundStatus = document.createElement('span');
  soundStatus.setAttribute('role', 'status');
  testSound.addEventListener('click', () => {
    soundStatus.textContent =
      prefs.soundEffects && prefs.soundVolume > 0
        ? ''
        : 'Turn on interface sounds and raise the volume to test.';
    void live.sound.playTest().then((played) => {
      if (played) soundStatus.textContent = 'Test sound played.';
      else if (prefs.soundEffects && prefs.soundVolume > 0)
        soundStatus.textContent =
          'Sound is unavailable right now. Try again when the microphone is off.';
    });
  });
  soundControls.append(volume, testSound, soundStatus);
  const guidance = document.createElement('label');
  guidance.className = 'check-option';
  const guidanceInput = document.createElement('input');
  guidanceInput.type = 'checkbox';
  guidanceInput.checked = prefs.dailyGuidance;
  guidance.append(guidanceInput, document.createTextNode('Show a daily return point'));
  guidanceInput.addEventListener('change', () => {
    prefs.dailyGuidance = guidanceInput.checked;
    writeStorage(PREFS_KEY, prefs);
    live.refreshPreferences();
  });
  section
    .querySelector('.motion-setting')
    .parentElement.after(soundOption, soundControls, guidance);
  window.addEventListener('eilo-preferences-changed', () => {
    soundInput.checked = prefs.soundEffects;
    volume.value = String(prefs.soundVolume);
    guidanceInput.checked = prefs.dailyGuidance;
  });
  const speechMode = document.querySelector('.speech-method select');
  if (speechMode) {
    section.querySelector('.speech-preference').append(speechMode);
    document.querySelector('.speech-mode-caret')?.remove();
  }
  section.querySelector('.profile-form input').value = prefs.name;
  const namePrompt = document.createElement('button');
  namePrompt.type = 'button';
  namePrompt.className = 'button settings-name-prompt';
  namePrompt.textContent = 'Add your name';
  namePrompt.hidden = Boolean(prefs.name);
  namePrompt.addEventListener('click', () => {
    live.showPage('settings', { settingsSection: 'general' });
    section.querySelector('.profile-form input').focus();
  });
  $('.header-actions').append(namePrompt);
  section.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    const value = section.querySelector('.profile-form input').value.trim();
    if (!value) return;
    prefs.name = value;
    const saved = writeStorage(PREFS_KEY, prefs);
    namePrompt.hidden = saved;
    renderProfile();
    section.querySelector('.settings-feedback').textContent = saved
      ? 'Name saved.'
      : 'Could not save the name in this browser.';
  });
  section.querySelector('.pin-setting').checked = prefs.pin;
  section.querySelector('.pin-setting').addEventListener('change', (event) => {
    prefs.pin = event.target.checked;
    writeStorage(PREFS_KEY, prefs);
    if (prefs.pin) setRail(true);
    else scheduleRailHide();
  });
  section.querySelector('.motion-setting').checked = prefs.reducedMotion;
  section.querySelector('.motion-setting').addEventListener('change', (event) => {
    prefs.reducedMotion = event.target.checked;
    document.body.classList.toggle('reduce-motion', prefs.reducedMotion);
    finishLandings();
    writeStorage(PREFS_KEY, prefs);
  });
  section
    .querySelector('.settings-checkins')
    .addEventListener('click', () => live.showPage('activity', { activityTab: 'overview' }));
  const profile = document.createElement('details');
  const profileTitle = document.createElement('summary');
  profileTitle.textContent = 'Your name';
  profile.append(profileTitle, section.querySelector('.profile-form'));
  section.append(profile);
  namePrompt.addEventListener('click', () => {
    profile.open = true;
    section.querySelector('.profile-form input').focus();
  });
  const group = (title, elements) => {
    const container = document.createElement('section');
    container.className = 'settings-group';
    const heading = document.createElement('h3');
    heading.textContent = title;
    container.append(heading, ...elements);
    return container;
  };
  const keyboard = section.querySelector('details');
  section.querySelector('h2').remove();
  section.querySelector('h3').remove();
  guidance.lastChild.textContent = 'Daily welcome-back briefing';
  section.append(
    group('Appearance', [
      section.querySelector('.pin-setting').parentElement,
      section.querySelector('.motion-setting').parentElement,
    ]),
    group('Conversation', [
      guidance,
      section.querySelector('.speech-preference'),
      section.querySelector('.settings-checkins'),
    ]),
    group('Sound', [soundOption, soundControls]),
    group('Personal & shortcuts', [profile, keyboard]),
  );
  section.querySelector('.pin-setting').parentElement.remove();
  return section;
}
function updateContextGallery() {
  if (live)
    for (const type of ['today', 'goals', 'progress', 'tracking', 'usage']) {
      if (state.widgets.some((widget) => widget.type === type)) delete widgetCatalog[type];
      else widgetCatalog[type] = CATALOG[type];
    }
  for (const key of Object.keys(widgetCatalog))
    if (key.startsWith('context-')) delete widgetCatalog[key];
  for (const component of adaptiveHome?.components() || []) {
    const id = contextWidgetId(component.id);
    if (state.widgets.some((widget) => widget.id === id)) continue;
    widgetCatalog[id] = CATALOG.context;
    TITLES[id] = component.title;
    DEFAULT_SIZE[id] = component.emphasis === 'primary' ? 'medium' : 'small';
  }
}
function syncAutomaticWidgets(input) {
  contextInput = input;
  if (!adaptiveHome) return;
  const next = syncContextWidgets(state, {
    ...input,
    dismissed: prefs.dismissedContextWidgets,
  });
  if (next !== state) {
    state = next;
    saveLayout();
  }
  contextRenderVersion++;
  updateContextGallery();
  renderBoard();
}
if (live) {
  const { mountAdaptiveHome } = await import('./adaptive/controller.js');
  adaptiveHome = mountAdaptiveHome({
    client: live.client,
    settingsHost: live.settingsHost,
    onRestoreHome: () => {
      undoState = state;
      state = withTrackingWidgets(withConversationDock(createDefaultState()));
      saveLayout();
      live.showPage('home');
      renderBoard();
      toast('Starter layout restored. Notes and saved contents are kept.', true);
    },
    settingsSections: [
      { id: 'general', label: 'General', element: createGeneralSettings() },
      ...live.settingsSections,
    ],
    onSettingsSection: (id) => live.settingsSectionSelected(id),
    onOpenSettings: (id) => live.showPage('settings', { settingsSection: id }),
    isBusy: () => Boolean(editing || drag || resizeDrag || keyboardMove || menuId || heldPress),
    onComposition: syncAutomaticWidgets,
    onError: (message) => toast(message),
    onOpenConnections: (source) =>
      source === 'browser' ? showDetail('browser-setup') : live.showPage('connections'),
    onOpenActivity: () => live.showPage('activity'),
    onTalk: () => live.focusConversation(),
  });
  // Context settings have one visible destination in the navigation.
  if (contextInput) syncAutomaticWidgets(contextInput);
  if (!live.settingsHost.hidden)
    adaptiveHome.selectSettings(location.hash === '#connections' ? 'connections' : 'general');
  window.addEventListener('pagehide', () => adaptiveHome?.destroy(), { once: true });
}
if (adaptivePreviewMode) {
  const previewHost = $('.adaptive-preview-host');
  let previewController = null;
  board.hidden = true;
  $('.empty-home').hidden = true;
  $('.storage-warning').hidden = true;
  $('.edit-toggle').hidden = true;
  $('.add-toggle').hidden = true;
  $('.overflow-toggle').hidden = true;
  $('.save-state').hidden = true;
  previewHost.hidden = false;
  import('./adaptive/preview.js')
    .then(({ mountAdaptivePreview }) => {
      previewController = mountAdaptivePreview({
        host: previewHost,
        onExit: () => {
          adaptivePreviewMode = false;
          previewController?.destroy();
          previewHost.hidden = true;
          $('.edit-toggle').hidden = false;
          $('.save-state').hidden = false;
          history.replaceState(null, '', location.pathname + location.hash);
          renderBoard();
        },
      });
    })
    .catch((error) => {
      console.error('Adaptive preview failed to load:', error);
      adaptivePreviewMode = false;
      previewHost.hidden = true;
      $('.edit-toggle').hidden = false;
      $('.save-state').hidden = false;
      renderBoard();
    });
}

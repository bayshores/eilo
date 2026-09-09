/** Pure, storage-friendly layout metadata for the eilo widget prototype. */
export const CATALOG = Object.freeze({
  today: { title: 'Today', sizes: { small: { w: 3, h: 2 }, medium: { w: 4, h: 3 }, large: { w: 4, h: 4 } } },
  goals: { title: 'Goals', sizes: { small: { w: 4, h: 2 }, medium: { w: 6, h: 2 }, large: { w: 8, h: 2 } } },
  progress: { title: 'Progress', sizes: { small: { w: 3, h: 2 }, medium: { w: 4, h: 2 }, large: { w: 6, h: 2 } } },
  conversation: { title: 'Conversation', sizes: { small: { w: 4, h: 2 }, medium: { w: 5, h: 2 }, large: { w: 8, h: 3 } } },
  clock: { title: 'Clock', sizes: { small: { w: 3, h: 2 }, medium: { w: 4, h: 2 }, large: { w: 6, h: 2 } } },
  notes: { title: 'Notes', sizes: { small: { w: 3, h: 2 }, medium: { w: 4, h: 2 }, large: { w: 6, h: 3 } } },
});

export const MODES = Object.freeze({ wide: 12, compact: 6, stacked: 1 });
const DEFAULT_WIDGETS = Object.freeze([
  { id: 'today-1', type: 'today', size: 'large' },
  { id: 'goals-1', type: 'goals', size: 'large' },
  { id: 'progress-1', type: 'progress', size: 'small' },
  { id: 'conversation-1', type: 'conversation', size: 'medium' },
]);
const DEFAULT_WIDE = Object.freeze([
  { id: 'today-1', x: 0, y: 0 }, { id: 'goals-1', x: 4, y: 0 },
  { id: 'progress-1', x: 4, y: 2 }, { id: 'conversation-1', x: 7, y: 2 },
]);
// 24 stacked eight-row widgets need 192 rows.
const ROW_LIMIT = 192;
const ANCHOR_LIMIT = 80;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validMode = mode => Object.hasOwn(MODES, mode) ? mode : 'wide';
const validWidget = widget => isObject(widget) && typeof widget.id === 'string' && widget.id.trim() &&
  Object.hasOwn(CATALOG, widget.type) && Object.hasOwn(CATALOG[widget.type].sizes, widget.size);
const integer = value => Number.isFinite(value) ? Math.max(0, Math.min(ROW_LIMIT, Math.floor(value))) : null;
const anchor = value => Number.isFinite(value) ? Math.max(0, Math.min(ANCHOR_LIMIT, Math.floor(value))) : null;
function normalizedFootprint(type, mode, value) {
  if (!isObject(value) || !Number.isFinite(value.w) || !Number.isFinite(value.h)) return null;
  const h = Math.max(2, Math.min(8, Math.floor(value.h)));
  const w = mode === 'stacked' ? 1 : Math.max(mode === 'wide' ? CATALOG[type].sizes.small.w : 3,
    Math.min(MODES[mode], Math.floor(value.w)));
  return { w, h };
}
function normalizedFootprints(type, source) {
  if (!isObject(source)) return undefined;
  const footprints = Object.fromEntries(Object.keys(MODES).flatMap(mode => {
    const value = normalizedFootprint(type, mode, source[mode]);
    return value ? [[mode, value]] : [];
  }));
  return Object.keys(footprints).length ? footprints : undefined;
}

export function createDefaultState() {
  return { version: 1, widgets: DEFAULT_WIDGETS.map(widget => ({ ...widget })), positions: { wide: DEFAULT_WIDE.map(position => ({ ...position })) } };
}

export function normalizeState(rawObject) {
  if (!isObject(rawObject) || rawObject.version !== 1 || !Array.isArray(rawObject.widgets)) return createDefaultState();
  const ids = new Set();
  const widgets = rawObject.widgets.filter(validWidget).filter(widget => !ids.has(widget.id) && ids.add(widget.id)).slice(0, 24)
    .map(({ id, type, size, footprints }) => {
      const clean = { id, type, size }, normalized = normalizedFootprints(type, footprints);
      return normalized ? { ...clean, footprints: normalized } : clean;
    });
  const known = new Set(widgets.map(widget => widget.id));
  const positions = {};
  if (isObject(rawObject.positions)) for (const mode of Object.keys(MODES)) {
    const source = rawObject.positions[mode];
    if (!Array.isArray(source)) continue;
    const seen = new Set();
    positions[mode] = source.flatMap(position => {
      if (!isObject(position) || !known.has(position.id) || seen.has(position.id)) return [];
      const x = integer(position.x), y = Number.isFinite(position.y) && position.y > ROW_LIMIT ? ANCHOR_LIMIT : integer(position.y);
      if (x === null || y === null) return [];
      seen.add(position.id); return [{ id: position.id, x, y }];
    });
  }
  return { version: 1, widgets, positions };
}

function dimensions(widget, mode) {
  const custom = normalizedFootprint(widget.type, mode, widget.footprints?.[mode]);
  if (custom) return custom;
  const base = CATALOG[widget.type].sizes[widget.size];
  // Intermediate windows use half/full-width widgets, avoiding unusable
  // two-column gaps beside cards that retained their desktop column count.
  const width = mode === 'stacked' ? 1 : mode === 'compact' ? (widget.type === 'goals' ? 3 : base.w >= 6 ? 6 : 3) : base.w;
  return { w: width, h: mode !== 'wide' && widget.type === 'today' ? 2 : base.h };
}
function overlaps(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
function fit(item, placed, columns, start = 0) {
  for (let y = Math.max(0, start); y <= ROW_LIMIT - item.h; y++) for (let x = 0; x <= columns - item.w; x++) {
    const candidate = { ...item, x, y };
    if (!placed.some(other => overlaps(candidate, other))) return candidate;
  }
  // A high saved anchor can consume the tail of the bounded grid. Reuse free
  // rows before it rather than returning an overlapping sentinel placement.
  for (let y = 0; y < Math.min(ROW_LIMIT - item.h + 1, Math.max(0, start)); y++) for (let x = 0; x <= columns - item.w; x++) {
    const candidate = { ...item, x, y };
    if (!placed.some(other => overlaps(candidate, other))) return candidate;
  }
  // Unreachable with the 24-widget cap and ROW_LIMIT, retained as a safe total function.
  return { ...item, x: 0, y: ROW_LIMIT - item.h };
}
function clamped(item, x, y, columns) {
  return { ...item, x: Math.max(0, Math.min(columns - item.w, integer(x) ?? 0)), y: Math.min(ROW_LIMIT - item.h, integer(y) ?? 0) };
}

export function projectLayout(state, mode = 'wide') {
  const safe = normalizeState(state), selectedMode = validMode(mode), columns = MODES[selectedMode];
  const saved = new Map((safe.positions[selectedMode] || []).map(position => [position.id, position]));
  const placed = [];
  for (const widget of safe.widgets) {
    const item = { id: widget.id, type: widget.type, size: widget.size, ...dimensions(widget, selectedMode) };
    const preferred = saved.get(widget.id);
    const candidate = preferred ? clamped(item, preferred.x, preferred.y, columns) : null;
    placed.push(candidate && !placed.some(other => overlaps(candidate, other)) ? candidate : fit(item, placed, columns, preferred?.y || 0));
  }
  return placed;
}

function savedPositions(layout) { return layout.map(({ id, x, y }) => ({ id, x, y })); }
function cloneState(state) { return { version: 1, widgets: state.widgets.map(widget => ({ ...widget, ...(widget.footprints ? { footprints: Object.fromEntries(Object.entries(widget.footprints).map(([mode, footprint]) => [mode, { ...footprint }])) } : {}) })), positions: Object.fromEntries(Object.entries(state.positions).map(([mode, list]) => [mode, list.map(position => ({ ...position }))])) }; }
function settle(state, mode, targetId, x, y) {
  const columns = MODES[mode], current = projectLayout(state, mode), target = current.find(item => item.id === targetId);
  if (!target) return current;
  const anchored = clamped(target, x, y, columns), placed = [anchored];
  for (const item of current) if (item.id !== targetId) {
    const preferred = clamped(item, item.x, item.y, columns);
    placed.push(!placed.some(other => overlaps(preferred, other)) ? preferred : fit(item, placed, columns, item.y));
  }
  return placed;
}
function reconcileSavedModes(state) {
  for (const mode of Object.keys(state.positions)) state.positions[mode] = savedPositions(projectLayout(state, mode));
  return state;
}

export function updateLayout(state, action) {
  const safe = normalizeState(state);
  if (!isObject(action) || typeof action.type !== 'string') return state;
  if (action.type === 'add') {
    const id = action.id, mode = validMode(action.mode);
    if (typeof id !== 'string' || !id.trim() || safe.widgets.length >= 24 || safe.widgets.some(widget => widget.id === id) ||
      !Object.hasOwn(CATALOG, action.widgetType) || !Object.hasOwn(CATALOG[action.widgetType].sizes, action.size)) return state;
    const next = cloneState(safe); next.widgets.push({ id, type: action.widgetType, size: action.size });
    const layout = projectLayout(next, mode); next.positions[mode] = savedPositions(layout); return reconcileSavedModes(next);
  }
  const index = safe.widgets.findIndex(widget => widget.id === action.id);
  if (index < 0) return state;
  if (action.type === 'remove') {
    const next = cloneState(safe); next.widgets.splice(index, 1);
    for (const mode of Object.keys(next.positions)) next.positions[mode] = next.positions[mode].filter(position => position.id !== action.id);
    return next;
  }
  const mode = validMode(action.mode);
  if (action.type === 'resize') {
    const widget = safe.widgets[index];
    if (!Object.hasOwn(CATALOG[widget.type].sizes, action.size)) return state;
    const next = cloneState(safe); next.widgets[index].size = action.size; delete next.widgets[index].footprints;
    const prior = projectLayout(safe, mode).find(item => item.id === action.id);
    next.positions[mode] = savedPositions(settle(next, mode, action.id, prior.x, prior.y));
    return reconcileSavedModes(next);
  }
  if (action.type === 'resizeTo') {
    if (!Number.isFinite(action.w) || !Number.isFinite(action.h)) return state;
    const widget = safe.widgets[index], footprint = normalizedFootprint(widget.type, mode, action);
    if (!footprint) return state;
    const next = cloneState(safe), prior = projectLayout(safe, mode).find(item => item.id === action.id);
    next.widgets[index].footprints = { ...(next.widgets[index].footprints || {}), [mode]: footprint };
    next.positions[mode] = savedPositions(settle(next, mode, action.id, prior.x, prior.y));
    return reconcileSavedModes(next);
  }
  if (action.type === 'move') {
    if (integer(action.x) === null || anchor(action.y) === null) return state;
    const next = cloneState(safe); next.positions[mode] = savedPositions(settle(next, mode, action.id, action.x, anchor(action.y)));
    return next;
  }
  return state;
}

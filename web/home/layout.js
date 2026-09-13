/** Pure, storage-friendly layout metadata for the eilo widget prototype. */
const catalog = {
  today: {
    title: 'Today',
    sizes: { small: { w: 3, h: 2 }, medium: { w: 4, h: 3 }, large: { w: 4, h: 4 } },
  },
  goals: {
    title: 'Goals',
    sizes: { small: { w: 4, h: 2 }, medium: { w: 6, h: 2 }, large: { w: 8, h: 2 } },
  },
  progress: {
    title: 'Progress',
    sizes: { small: { w: 3, h: 2 }, medium: { w: 4, h: 2 }, large: { w: 6, h: 2 } },
  },
  conversation: {
    title: 'Conversation',
    sizes: { small: { w: 4, h: 2 }, medium: { w: 5, h: 2 }, large: { w: 8, h: 3 } },
  },
  clock: {
    title: 'Clock',
    sizes: { small: { w: 3, h: 2 }, medium: { w: 4, h: 2 }, large: { w: 6, h: 2 } },
  },
  notes: {
    title: 'Notes',
    sizes: { small: { w: 3, h: 2 }, medium: { w: 4, h: 2 }, large: { w: 6, h: 3 } },
  },
  tracking: {
    title: 'Tracking',
    sizes: { small: { w: 4, h: 2 }, medium: { w: 4, h: 3 }, large: { w: 6, h: 3 } },
  },
  usage: {
    title: 'Browser usage',
    sizes: { small: { w: 4, h: 2 }, medium: { w: 8, h: 2 }, large: { w: 8, h: 3 } },
  },
};
// Context cards are generated from the bounded adaptive composition, not offered
// as a generic manual widget. Keeping it out of enumeration preserves that split.
Object.defineProperty(catalog, 'context', {
  value: Object.freeze({
    title: 'Work context',
    sizes: { small: { w: 4, h: 2 }, medium: { w: 6, h: 2 }, large: { w: 8, h: 3 } },
  }),
});
export const CATALOG = Object.freeze(catalog);

export const MODES = Object.freeze({ wide: 12, compact: 6, stacked: 1 });
const DEFAULT_WIDGETS = Object.freeze([
  { id: 'today-1', type: 'today', size: 'large' },
  { id: 'goals-1', type: 'goals', size: 'large' },
  { id: 'progress-1', type: 'progress', size: 'small' },
  { id: 'conversation-1', type: 'conversation', size: 'medium' },
]);
const DEFAULT_WIDE = Object.freeze([
  { id: 'today-1', x: 0, y: 0 },
  { id: 'goals-1', x: 4, y: 0 },
  { id: 'progress-1', x: 4, y: 2 },
  { id: 'conversation-1', x: 7, y: 2 },
]);
const LEGACY_TRACKING_DEFAULT = Object.freeze({
  version: 1,
  widgets: Object.freeze([
    Object.freeze({
      id: 'today-1',
      type: 'today',
      size: 'small',
      footprints: { wide: { w: 4, h: 2 } },
    }),
    Object.freeze({ id: 'goals-1', type: 'goals', size: 'small' }),
    Object.freeze({ id: 'tracking-1', type: 'tracking', size: 'small' }),
    Object.freeze({
      id: 'progress-1',
      type: 'progress',
      size: 'small',
      footprints: { wide: { w: 4, h: 2 } },
    }),
    Object.freeze({ id: 'usage-1', type: 'usage', size: 'medium' }),
  ]),
  positions: Object.freeze({
    wide: Object.freeze([
      Object.freeze({ id: 'today-1', x: 0, y: 0 }),
      Object.freeze({ id: 'goals-1', x: 4, y: 0 }),
      Object.freeze({ id: 'tracking-1', x: 8, y: 0 }),
      Object.freeze({ id: 'progress-1', x: 0, y: 2 }),
      Object.freeze({ id: 'usage-1', x: 4, y: 2 }),
    ]),
  }),
});
const UNIQUE_SOURCE_WIDGET_TYPES = new Set(['today', 'goals', 'progress', 'tracking', 'usage']);
// 24 stacked eight-row widgets need 192 rows.
const ROW_LIMIT = 192;
const ANCHOR_LIMIT = 80;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validMode = (mode) => (Object.hasOwn(MODES, mode) ? mode : 'wide');
export const validContextComponentId = (value) =>
  typeof value === 'string' && value.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value);
const validWidget = (widget) =>
  isObject(widget) &&
  typeof widget.id === 'string' &&
  widget.id.trim() &&
  Object.hasOwn(CATALOG, widget.type) &&
  Object.hasOwn(CATALOG[widget.type].sizes, widget.size) &&
  (widget.type !== 'context' || validContextComponentId(widget.componentId));
const integer = (value) =>
  Number.isFinite(value) ? Math.max(0, Math.min(ROW_LIMIT, Math.floor(value))) : null;
const anchor = (value) =>
  Number.isFinite(value) ? Math.max(0, Math.min(ANCHOR_LIMIT, Math.floor(value))) : null;
function normalizedFootprint(type, mode, value) {
  if (!isObject(value) || !Number.isFinite(value.w) || !Number.isFinite(value.h)) return null;
  const h = Math.max(2, Math.min(8, Math.floor(value.h)));
  const w =
    mode === 'stacked'
      ? 1
      : Math.max(
          mode === 'wide' ? CATALOG[type].sizes.small.w : 3,
          Math.min(MODES[mode], Math.floor(value.w)),
        );
  return { w, h };
}
function normalizedFootprints(type, source) {
  if (!isObject(source)) return undefined;
  const footprints = Object.fromEntries(
    Object.keys(MODES).flatMap((mode) => {
      const value = normalizedFootprint(type, mode, source[mode]);
      return value ? [[mode, value]] : [];
    }),
  );
  return Object.keys(footprints).length ? footprints : undefined;
}

export function createDefaultState() {
  return {
    version: 1,
    widgets: DEFAULT_WIDGETS.map((widget) => ({ ...widget })),
    positions: { wide: DEFAULT_WIDE.map((position) => ({ ...position })) },
  };
}

/** Keep the approval receipt with geometry so a retry cannot reset later edits. */
export function applyOnboardingLayout(current, setup) {
  if (
    setup?.status !== 'complete' ||
    !/^[A-Za-z0-9_-]{12,80}$/.test(setup.acceptance_id || '') ||
    current.onboardingId === setup.acceptance_id
  )
    return current;
  const allowed = new Set(['goals', 'progress', 'notes', 'today', 'clock']);
  if (
    !Array.isArray(setup.widgets) ||
    !setup.widgets.includes('goals') ||
    setup.widgets.length > 3 ||
    setup.widgets.some((type) => !allowed.has(type))
  )
    return current;
  const widgets = [...new Set(setup.widgets)].map((type) => ({
    id: 'setup-' + type,
    type,
    size: type === 'goals' ? 'large' : 'medium',
    footprints: {
      wide: { w: setup.widgets.length === 1 ? 8 : 6, h: 3 },
      compact: { w: 6, h: 3 },
      stacked: { w: 1, h: 3 },
    },
  }));
  return normalizeState({
    version: 1,
    onboardingId: setup.acceptance_id,
    widgets,
    positions: {
      wide: widgets.map((widget, index) => ({
        id: widget.id,
        x: (index % 2) * 6,
        y: Math.floor(index / 2) * 3,
      })),
    },
  });
}

function isUntouchedDefault(state) {
  return (
    state.widgets.length === DEFAULT_WIDGETS.length &&
    state.widgets.every(
      (widget, index) =>
        widget.id === DEFAULT_WIDGETS[index].id &&
        widget.type === DEFAULT_WIDGETS[index].type &&
        widget.size === DEFAULT_WIDGETS[index].size &&
        !widget.footprints,
    ) &&
    Object.keys(state.positions).length === 1 &&
    Array.isArray(state.positions.wide) &&
    state.positions.wide.length === DEFAULT_WIDE.length &&
    state.positions.wide.every(
      (position, index) =>
        position.id === DEFAULT_WIDE[index].id &&
        position.x === DEFAULT_WIDE[index].x &&
        position.y === DEFAULT_WIDE[index].y,
    )
  );
}

/** Convert view-only Conversation widgets into the single bottom dock presentation. */
export function withConversationDock(rawState) {
  const normalized = normalizeState(rawState);
  const defaultLayout = isUntouchedDefault(normalized);
  const next = cloneState(normalized);
  const removed = new Set(
    next.widgets.filter((widget) => widget.type === 'conversation').map((widget) => widget.id),
  );
  next.widgets = next.widgets.filter((widget) => !removed.has(widget.id));
  for (const mode of Object.keys(next.positions))
    next.positions[mode] = next.positions[mode].filter((position) => !removed.has(position.id));
  if (defaultLayout) {
    const progress = next.widgets.find((widget) => widget.id === 'progress-1');
    if (progress) {
      progress.footprints = { ...(progress.footprints || {}), wide: { w: 8, h: 2 } };
      next.positions.wide = next.positions.wide.map((position) =>
        position.id === progress.id ? { ...position, x: 4, y: 2 } : position,
      );
    }
  }
  return next;
}

/** Add the requested source widgets to a fresh/untouched Home, preserving custom layouts. */
export function withTrackingWidgets(rawState) {
  const next = normalizeState(rawState);
  const untouched = normalizeState(withConversationDock(createDefaultState()));
  const legacy = normalizeState(LEGACY_TRACKING_DEFAULT);
  if (
    JSON.stringify(next) !== JSON.stringify(untouched) &&
    JSON.stringify(next) !== JSON.stringify(legacy)
  )
    return next;
  next.widgets = [
    { id: 'today-1', type: 'today', size: 'small', footprints: { wide: { w: 12, h: 2 } } },
    { id: 'goals-1', type: 'goals', size: 'small' },
    { id: 'tracking-1', type: 'tracking', size: 'small' },
    { id: 'progress-1', type: 'progress', size: 'small', footprints: { wide: { w: 4, h: 2 } } },
    { id: 'usage-1', type: 'usage', size: 'medium' },
  ];
  next.positions.wide = [
    { id: 'today-1', x: 0, y: 0 },
    { id: 'goals-1', x: 0, y: 2 },
    { id: 'tracking-1', x: 4, y: 2 },
    { id: 'progress-1', x: 8, y: 2 },
    { id: 'usage-1', x: 0, y: 4 },
  ];
  return next;
}

/**
 * Live source widgets render one shared backend view per type. Keep their first
 * saved instance and geometry, while leaving intentionally repeatable personal
 * and contextual widgets alone.
 */
export function withUniqueSourceWidgets(rawState) {
  const normalized = normalizeState(rawState);
  const seen = new Set();
  const removed = new Set();
  for (const widget of normalized.widgets)
    if (UNIQUE_SOURCE_WIDGET_TYPES.has(widget.type)) {
      if (seen.has(widget.type)) removed.add(widget.id);
      else seen.add(widget.type);
    }
  if (!removed.size) return rawState;
  const next = cloneState(normalized);
  next.widgets = next.widgets.filter((widget) => !removed.has(widget.id));
  for (const mode of Object.keys(next.positions))
    next.positions[mode] = next.positions[mode].filter((position) => !removed.has(position.id));
  return next;
}

export function normalizeState(rawObject) {
  if (!isObject(rawObject) || rawObject.version !== 1 || !Array.isArray(rawObject.widgets))
    return createDefaultState();
  const ids = new Set();
  const widgets = rawObject.widgets
    .filter(validWidget)
    .filter((widget) => !ids.has(widget.id) && ids.add(widget.id))
    .slice(0, 24)
    .map(({ id, type, size, footprints, componentId }) => {
      const clean = {
          id,
          type,
          size,
          ...(type === 'context' ? { componentId } : {}),
        },
        normalized = normalizedFootprints(type, footprints);
      return normalized ? { ...clean, footprints: normalized } : clean;
    });
  const known = new Set(widgets.map((widget) => widget.id));
  const positions = {};
  if (isObject(rawObject.positions))
    for (const mode of Object.keys(MODES)) {
      const source = rawObject.positions[mode];
      if (!Array.isArray(source)) continue;
      const seen = new Set();
      positions[mode] = source.flatMap((position) => {
        if (!isObject(position) || !known.has(position.id) || seen.has(position.id)) return [];
        const x = integer(position.x),
          y =
            Number.isFinite(position.y) && position.y > ROW_LIMIT
              ? ANCHOR_LIMIT
              : integer(position.y);
        if (x === null || y === null) return [];
        seen.add(position.id);
        return [{ id: position.id, x, y }];
      });
    }
  return {
    version: 1,
    widgets,
    positions,
    ...(typeof rawObject.onboardingId === 'string' &&
    /^[A-Za-z0-9_-]{12,80}$/.test(rawObject.onboardingId)
      ? { onboardingId: rawObject.onboardingId }
      : {}),
  };
}

function dimensions(widget, mode) {
  const custom = normalizedFootprint(widget.type, mode, widget.footprints?.[mode]);
  if (custom) return custom;
  const base = CATALOG[widget.type].sizes[widget.size];
  // Intermediate windows use half/full-width widgets, avoiding unusable
  // two-column gaps beside cards that retained their desktop column count.
  const width =
    mode === 'stacked'
      ? 1
      : mode === 'compact'
        ? widget.type === 'goals'
          ? 3
          : base.w >= 6
            ? 6
            : 3
        : base.w;
  return { w: width, h: mode !== 'wide' && widget.type === 'today' ? 2 : base.h };
}
function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function fit(item, placed, columns, start = 0) {
  for (let y = Math.max(0, start); y <= ROW_LIMIT - item.h; y++)
    for (let x = 0; x <= columns - item.w; x++) {
      const candidate = { ...item, x, y };
      if (!placed.some((other) => overlaps(candidate, other))) return candidate;
    }
  // A high saved anchor can consume the tail of the bounded grid. Reuse free
  // rows before it rather than returning an overlapping sentinel placement.
  for (let y = 0; y < Math.min(ROW_LIMIT - item.h + 1, Math.max(0, start)); y++)
    for (let x = 0; x <= columns - item.w; x++) {
      const candidate = { ...item, x, y };
      if (!placed.some((other) => overlaps(candidate, other))) return candidate;
    }
  // Unreachable with the 24-widget cap and ROW_LIMIT, retained as a safe total function.
  return { ...item, x: 0, y: ROW_LIMIT - item.h };
}
function clamped(item, x, y, columns) {
  return {
    ...item,
    x: Math.max(0, Math.min(columns - item.w, integer(x) ?? 0)),
    y: Math.min(ROW_LIMIT - item.h, integer(y) ?? 0),
  };
}

export function projectLayout(state, mode = 'wide') {
  const safe = normalizeState(state),
    selectedMode = validMode(mode),
    columns = MODES[selectedMode];
  const saved = new Map(
    (safe.positions[selectedMode] || []).map((position) => [position.id, position]),
  );
  const placed = [];
  for (const widget of safe.widgets) {
    const item = {
      id: widget.id,
      type: widget.type,
      size: widget.size,
      ...(widget.type === 'context' ? { componentId: widget.componentId } : {}),
      ...dimensions(widget, selectedMode),
    };
    const preferred = saved.get(widget.id);
    const candidate = preferred ? clamped(item, preferred.x, preferred.y, columns) : null;
    placed.push(
      candidate && !placed.some((other) => overlaps(candidate, other))
        ? candidate
        : fit(item, placed, columns, preferred?.y || 0),
    );
  }
  return placed;
}

/**
 * Explicitly pack the current mode from the top left without changing widget
 * sizes, content, or any other responsive mode.  Existing geometry remains
 * untouched until the caller chooses this action.
 */
export function tidyHomeLayout(state, mode = 'wide') {
  const safe = normalizeState(state);
  const selectedMode = validMode(mode);
  const layout = projectLayout(safe, selectedMode);
  const visualOrder = [...layout].sort((left, right) => left.y - right.y || left.x - right.x);
  const placed = [];
  for (const item of visualOrder) placed.push(fit(item, placed, MODES[selectedMode]));
  const positions = new Map(placed.map(({ id, x, y }) => [id, { id, x, y }]));
  const nextPositions = layout.map(({ id }) => positions.get(id));
  const currentPositions = safe.positions[selectedMode] || [];
  if (samePositions(currentPositions, nextPositions)) return state;
  const next = cloneState(safe);
  next.positions[selectedMode] = nextPositions;
  return next;
}

function samePositions(left, right) {
  return (
    left.length === right.length &&
    left.every(
      (position, index) =>
        position.id === right[index].id &&
        position.x === right[index].x &&
        position.y === right[index].y,
    )
  );
}

/**
 * Produce display-only Home pages. Saved positions and footprints stay intact;
 * cards taller than a page are shortened only in this returned projection.
 */
export function paginateHomeLayout(state, mode = 'wide', rows = 4) {
  const selectedMode = validMode(mode);
  const pageRows = Number.isInteger(rows) && rows >= 1 && rows <= ROW_LIMIT ? rows : 4;
  const columns = MODES[selectedMode];
  const ordered = [...projectLayout(state, selectedMode)].sort(
    (left, right) => left.y - right.y || left.x - right.x,
  );
  const pages = [];
  let page = [];
  for (const source of ordered) {
    const item = { ...source, h: Math.min(source.h, pageRows) };
    let placed = fitWithinPage(item, page, columns, pageRows, source.x, source.y % pageRows);
    if (!placed && page.length) {
      pages.push(page);
      page = [];
      placed = fitWithinPage(item, page, columns, pageRows, source.x, source.y % pageRows);
    }
    if (placed) page.push(placed);
  }
  if (page.length) pages.push(page);
  return pages;
}

function fitWithinPage(item, placed, columns, rows, preferredX, preferredY) {
  const preferred = { ...item, x: preferredX, y: preferredY };
  if (
    preferred.x >= 0 &&
    preferred.y >= 0 &&
    preferred.x + preferred.w <= columns &&
    preferred.y + preferred.h <= rows &&
    !placed.some((other) => overlaps(preferred, other))
  )
    return preferred;
  for (let y = 0; y <= rows - item.h; y++)
    for (let x = 0; x <= columns - item.w; x++) {
      const candidate = { ...item, x, y };
      if (!placed.some((other) => overlaps(candidate, other))) return candidate;
    }
  return null;
}

function previewSlots(item, columns, rows, preferredX, preferredY) {
  const slots = [];
  for (let y = 0; y <= rows - item.h; y++)
    for (let x = 0; x <= columns - item.w; x++) {
      const distance = Math.abs(x - preferredX) + Math.abs(y - preferredY);
      slots.push({ x, y, distance });
    }
  slots.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
  return slots;
}
function previewSlot(item, placed, columns, rows, preferredX, preferredY) {
  const slots = previewSlots(item, columns, rows, preferredX, preferredY);
  for (const slot of slots) {
    const candidate = { ...item, x: slot.x, y: slot.y };
    if (!placed.some((other) => overlaps(candidate, other))) return candidate;
  }
  return null;
}

function constrainedPeers(peers) {
  return [...peers].sort(
    (a, b) => b.w * b.h - a.w * a.h || b.w - a.w || b.h - a.h || a.id.localeCompare(b.id),
  );
}

/**
 * Computes transient drag reflow for one responsive mode. The caller supplies
 * the unmodified state for every pointer update; this never commits metadata.
 */
export function previewMove(state, { id, x, y, mode = 'wide', rows = 4 } = {}) {
  if (
    !Object.hasOwn(MODES, mode) ||
    typeof id !== 'string' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isInteger(rows) ||
    rows < 1 ||
    rows > ROW_LIMIT
  )
    return state;
  const layout = projectLayout(state, mode),
    target = layout.find((item) => item.id === id);
  if (!target || target.y + target.h > rows || target.h > rows) return state;
  const columns = MODES[mode];
  const desiredX = Math.max(0, Math.min(columns - target.w, Math.floor(x)));
  const desiredY = Math.max(0, Math.min(rows - target.h, Math.floor(y)));
  if (target.x === desiredX && target.y === desiredY) return state;
  const visible = layout.filter((item) => item.y + item.h <= rows);
  // Cards beyond Home remain in More, but cards crossing its lower edge still
  // occupy real grid space and must not be overwritten by a drag preview.
  const reserved = layout.filter((item) => item.id !== id && item.y + item.h > rows);
  const peers = visible.filter((item) => item.id !== id);
  const candidates = [];
  for (let candidateY = 0; candidateY <= rows - target.h; candidateY++) {
    for (let candidateX = 0; candidateX <= columns - target.w; candidateX++) {
      candidates.push({
        x: candidateX,
        y: candidateY,
        distance: Math.abs(candidateX - desiredX) + Math.abs(candidateY - desiredY),
        collisions: peers.filter((peer) =>
          overlaps({ ...target, x: candidateX, y: candidateY }, peer),
        ).length,
      });
    }
  }
  candidates.sort(
    (a, b) => a.distance - b.distance || a.collisions - b.collisions || a.y - b.y || a.x - b.x,
  );
  let packed = null;
  // This shared cap makes the exact-target fallback safe for repeated pointer
  // updates. It is a bounded search for a feasible arrangement, not optimal packing.
  let searchVisits = 0;
  const SEARCH_LIMIT = 5000;
  for (const candidate of candidates) {
    const dragged = { ...target, x: candidate.x, y: candidate.y };
    if (reserved.some((item) => overlaps(dragged, item))) continue;
    const placed = [...reserved, dragged];
    const displaced = [];
    // Keep every peer whose current rectangle is still clear. This avoids an
    // earlier displaced card stealing a later untouched card's exact anchor.
    for (const peer of peers) {
      if (!placed.some((item) => overlaps(peer, item))) placed.push(peer);
      else displaced.push(peer);
    }
    let failed = false;
    for (const peer of constrainedPeers(displaced)) {
      const slot = previewSlot(peer, placed, columns, rows, peer.x, peer.y);
      if (!slot) {
        failed = true;
        break;
      }
      placed.push(slot);
    }
    if (!failed) {
      packed = placed;
      break;
    }
    // A constrained displaced card can require a slot held by an otherwise
    // untouched peer. Retry deterministically with all peers movable.
    const retry = [...reserved, dragged];
    failed = false;
    for (const peer of constrainedPeers(peers)) {
      const slot = previewSlot(peer, retry, columns, rows, peer.x, peer.y);
      if (!slot) {
        failed = true;
        break;
      }
      retry.push(slot);
    }
    if (!failed) {
      packed = retry;
      break;
    }
    // Greedy nearest-slot placement can reject a feasible dense layout because
    // a large peer needs a slot currently held by another peer. Backtrack only
    // within this candidate target before considering a farther snap location.
    const ordered = constrainedPeers(peers);
    const search = (placed) => {
      if (ordered.length === placed.length - reserved.length - 1) return placed;
      if (searchVisits >= SEARCH_LIMIT) return null;
      const peer = ordered[placed.length - reserved.length - 1];
      for (const slot of previewSlots(peer, columns, rows, peer.x, peer.y)) {
        if (searchVisits++ >= SEARCH_LIMIT) return null;
        const next = { ...peer, x: slot.x, y: slot.y };
        if (placed.some((item) => overlaps(next, item))) continue;
        const result = search([...placed, next]);
        if (result) return result;
      }
      return null;
    };
    const solved = search([...reserved, dragged]);
    if (solved) {
      packed = solved;
      break;
    }
  }
  if (!packed) return state;
  const packedById = new Map(packed.map((item) => [item.id, item]));
  if (
    visible.every((item) => {
      const next = packedById.get(item.id);
      return next && next.x === item.x && next.y === item.y;
    })
  )
    return state;
  const positions = new Map(layout.map((item) => [item.id, { id: item.id, x: item.x, y: item.y }]));
  for (const item of packed) positions.set(item.id, { id: item.id, x: item.x, y: item.y });
  const next = cloneState(normalizeState(state));
  next.positions[mode] = layout.map((item) => positions.get(item.id));
  return next;
}

function savedPositions(layout) {
  return layout.map(({ id, x, y }) => ({ id, x, y }));
}

function minimumWidth(item, mode) {
  return mode === 'stacked' ? 1 : mode === 'compact' ? 3 : CATALOG[item.type].sizes.small.w;
}
function insideHome(item, columns, rows) {
  return item.x >= 0 && item.y >= 0 && item.x + item.w <= columns && item.y + item.h <= rows;
}
function compactChoices(item, columns, rows, mode) {
  const choices = [];
  for (let h = Math.min(item.h, rows); h >= 2; h--) {
    for (let w = Math.min(item.w, columns); w >= minimumWidth(item, mode); w--) {
      for (let y = 0; y <= rows - h; y++)
        for (let x = 0; x <= columns - w; x++) {
          const loss = item.w * item.h - w * h;
          const distance = Math.abs(x - item.x) + Math.abs(y - item.y);
          choices.push({ ...item, x, y, w, h, score: loss * 3 + distance });
        }
    }
  }
  choices.sort(
    (a, b) =>
      a.score - b.score ||
      Math.abs(a.y - item.y) - Math.abs(b.y - item.y) ||
      a.y - b.y ||
      a.x - b.x,
  );
  return choices;
}
function packWithinHome(peers, fixed, columns, rows, mode, budget) {
  const required = peers.reduce((sum, item) => sum + minimumWidth(item, mode) * 2, 0);
  if (required + fixed.reduce((sum, item) => sum + item.w * item.h, 0) > columns * rows)
    return null;
  const ordered = constrainedPeers(peers);
  const choices = ordered.map((item) => compactChoices(item, columns, rows, mode));
  function place(index, placed) {
    if (index === ordered.length) return placed;
    for (const item of choices[index]) {
      if (--budget.remaining < 0) return null;
      if (placed.some((other) => overlaps(item, other))) continue;
      const solved = place(index + 1, [...placed, item]);
      if (solved) return solved;
    }
    return null;
  }
  return place(0, fixed);
}
function keepPlacement(state, mode, layout, packed, rows) {
  const map = new Map(packed.map((item) => [item.id, item]));
  const placed = [...packed];
  // Existing drawer items keep their metadata. If a formerly off-screen anchor
  // crosses a new visible rectangle, keep that drawer item below Home.
  for (const item of layout)
    if (!map.has(item.id)) {
      const next = placed.some((other) => overlaps(item, other))
        ? fit(item, placed, MODES[mode], rows)
        : item;
      placed.push(next);
      map.set(item.id, next);
    }
  if (
    layout.every((item) => {
      const next = map.get(item.id);
      return next.x === item.x && next.y === item.y && next.w === item.w && next.h === item.h;
    })
  )
    return state;
  const next = cloneState(normalizeState(state));
  for (const widget of next.widgets) {
    const prior = layout.find((item) => item.id === widget.id),
      item = map.get(widget.id);
    if (item.w !== prior.w || item.h !== prior.h)
      widget.footprints = {
        ...(widget.footprints || {}),
        [mode]: { w: item.w, h: item.h },
      };
  }
  next.positions[mode] = layout.map((item) => {
    const position = map.get(item.id);
    return { id: item.id, x: position.x, y: position.y };
  });
  return next;
}
function sharedEdges(target, resized, peers, columns, rows, mode) {
  const dx = resized.w - target.w,
    dy = resized.h - target.h;
  const packed = [resized];
  for (const peer of peers) {
    const next = { ...peer };
    if (
      peer.x === target.x + target.w &&
      peer.y < target.y + target.h &&
      peer.y + peer.h > target.y
    ) {
      next.x += dx;
      next.w -= dx;
    }
    if (
      peer.y === target.y + target.h &&
      peer.x < target.x + target.w &&
      peer.x + peer.w > target.x
    ) {
      next.y += dy;
      next.h -= dy;
    }
    if (
      next.w < minimumWidth(next, mode) ||
      next.h < 2 ||
      next.h > 8 ||
      !insideHome(next, columns, rows) ||
      packed.some((other) => overlaps(next, other))
    )
      return null;
    packed.push(next);
  }
  return packed;
}

/** Resize within the visible canvas. A resize never evicts a visible peer. */
export function resizeWithinHome(state, { id, w, h, mode = 'wide', rows = 4 } = {}) {
  if (
    !Object.hasOwn(MODES, mode) ||
    (w !== undefined && !Number.isFinite(w)) ||
    (h !== undefined && !Number.isFinite(h)) ||
    !Number.isInteger(rows) ||
    rows < 2 ||
    rows > ROW_LIMIT
  )
    return state;
  const layout = projectLayout(state, mode),
    target = layout.find((item) => item.id === id),
    columns = MODES[mode];
  if (!target || !insideHome(target, columns, rows)) return state;
  w ??= target.w;
  h ??= target.h;
  const desiredW = Math.max(
    minimumWidth(target, mode),
    Math.min(columns - target.x, Math.floor(w)),
  );
  const desiredH = Math.max(2, Math.min(8, rows - target.y, Math.floor(h)));
  if (desiredW === target.w && desiredH === target.h) return state;
  const peers = layout.filter((item) => item.id !== id && insideHome(item, columns, rows));
  const widths = [],
    heights = [];
  for (let width = desiredW; width >= Math.min(desiredW, target.w); width--) widths.push(width);
  for (let height = desiredH; height >= Math.min(desiredH, target.h); height--)
    heights.push(height);
  const sizes = widths.flatMap((width) =>
    heights.map((height) => ({
      w: width,
      h: height,
      distance: desiredW - width + desiredH - height,
    })),
  );
  sizes.sort((a, b) => a.distance - b.distance || b.w - a.w);
  const budget = { remaining: 12000 };
  for (const size of sizes) {
    const resized = { ...target, w: size.w, h: size.h };
    let packed = sharedEdges(target, resized, peers, columns, rows, mode);
    if (!packed) {
      // Reserve untouched rectangles first, so a displaced item does not steal
      // an otherwise unaffected widget's position.
      const fixed = peers.filter((item) => !overlaps(item, resized));
      const displaced = peers.filter((item) => overlaps(item, resized));
      packed = packWithinHome(displaced, [resized, ...fixed], columns, rows, mode, budget);
      if (!packed) packed = packWithinHome(peers, [resized], columns, rows, mode, budget);
    }
    if (packed) return keepPlacement(state, mode, layout, packed, rows);
  }
  return state;
}

/** Recover overflow into unused room, keeping already visible widgets stable. */
export function fitWithinHome(state, { mode = 'wide', rows = 4 } = {}) {
  if (!Object.hasOwn(MODES, mode) || !Number.isInteger(rows) || rows < 2 || rows > ROW_LIMIT)
    return state;
  const layout = projectLayout(state, mode),
    columns = MODES[mode];
  const visible = layout.filter((item) => insideHome(item, columns, rows)),
    hidden = layout.filter((item) => !insideHome(item, columns, rows));
  if (!hidden.length) return state;
  const firstRow = Math.min(...hidden.map((item) => item.y));
  const peers = hidden.map((item) => ({ ...item, y: Math.max(0, item.y - firstRow) }));
  const packed = packWithinHome(peers, visible, columns, rows, mode, { remaining: 12000 });
  return packed ? keepPlacement(state, mode, layout, packed, rows) : state;
}

function cloneState(state) {
  return {
    version: 1,
    ...(state.onboardingId ? { onboardingId: state.onboardingId } : {}),
    widgets: state.widgets.map((widget) => ({
      ...widget,
      ...(widget.footprints
        ? {
            footprints: Object.fromEntries(
              Object.entries(widget.footprints).map(([mode, footprint]) => [
                mode,
                { ...footprint },
              ]),
            ),
          }
        : {}),
    })),
    positions: Object.fromEntries(
      Object.entries(state.positions).map(([mode, list]) => [
        mode,
        list.map((position) => ({ ...position })),
      ]),
    ),
  };
}
function settle(state, mode, targetId, x, y) {
  const columns = MODES[mode],
    current = projectLayout(state, mode),
    target = current.find((item) => item.id === targetId);
  if (!target) return current;
  const anchored = clamped(target, x, y, columns),
    placed = [anchored];
  for (const item of current)
    if (item.id !== targetId) {
      const preferred = clamped(item, item.x, item.y, columns);
      placed.push(
        !placed.some((other) => overlaps(preferred, other))
          ? preferred
          : fit(item, placed, columns, item.y),
      );
    }
  return placed;
}
function reconcileSavedModes(state) {
  for (const mode of Object.keys(state.positions))
    state.positions[mode] = savedPositions(projectLayout(state, mode));
  return state;
}

export function updateLayout(state, action) {
  const safe = normalizeState(state);
  if (!isObject(action) || typeof action.type !== 'string') return state;
  if (action.type === 'add') {
    const id = action.id,
      mode = validMode(action.mode);
    if (
      typeof id !== 'string' ||
      !id.trim() ||
      safe.widgets.length >= 24 ||
      safe.widgets.some((widget) => widget.id === id) ||
      !Object.hasOwn(CATALOG, action.widgetType) ||
      !Object.hasOwn(CATALOG[action.widgetType].sizes, action.size) ||
      (action.widgetType === 'context' && !validContextComponentId(action.componentId))
    )
      return state;
    const next = cloneState(safe);
    next.widgets.push({
      id,
      type: action.widgetType,
      size: action.size,
      ...(action.widgetType === 'context' ? { componentId: action.componentId } : {}),
    });
    const layout = projectLayout(next, mode);
    next.positions[mode] = savedPositions(layout);
    return reconcileSavedModes(next);
  }
  const index = safe.widgets.findIndex((widget) => widget.id === action.id);
  if (index < 0) return state;
  if (action.type === 'remove') {
    const next = cloneState(safe);
    next.widgets.splice(index, 1);
    for (const mode of Object.keys(next.positions))
      next.positions[mode] = next.positions[mode].filter((position) => position.id !== action.id);
    return next;
  }
  const mode = validMode(action.mode);
  if (action.type === 'resize') {
    const widget = safe.widgets[index];
    if (!Object.hasOwn(CATALOG[widget.type].sizes, action.size)) return state;
    const next = cloneState(safe);
    next.widgets[index].size = action.size;
    delete next.widgets[index].footprints;
    const prior = projectLayout(safe, mode).find((item) => item.id === action.id);
    next.positions[mode] = savedPositions(settle(next, mode, action.id, prior.x, prior.y));
    return reconcileSavedModes(next);
  }
  if (action.type === 'resizeTo') {
    if (!Number.isFinite(action.w) || !Number.isFinite(action.h)) return state;
    const widget = safe.widgets[index],
      footprint = normalizedFootprint(widget.type, mode, action);
    if (!footprint) return state;
    const next = cloneState(safe),
      prior = projectLayout(safe, mode).find((item) => item.id === action.id);
    next.widgets[index].footprints = {
      ...(next.widgets[index].footprints || {}),
      [mode]: footprint,
    };
    next.positions[mode] = savedPositions(settle(next, mode, action.id, prior.x, prior.y));
    return reconcileSavedModes(next);
  }
  if (action.type === 'move') {
    if (integer(action.x) === null || anchor(action.y) === null) return state;
    const next = cloneState(safe);
    next.positions[mode] = savedPositions(
      settle(next, mode, action.id, action.x, anchor(action.y)),
    );
    return next;
  }
  return state;
}

// A one-time, URL-fragment handoff carries view metadata only, never task or chat content.
export function layoutTransferHash(layout, prefs = {}) {
  return (
    '#home-layout=' +
    encodeURIComponent(
      JSON.stringify({
        layout: normalizeState(layout),
        preferences: { pin: prefs.pin === true, reducedMotion: prefs.reducedMotion === true },
      }),
    )
  );
}
export function readLayoutTransfer(hash) {
  if (typeof hash !== 'string' || !hash.startsWith('#home-layout=') || hash.length > 32768)
    return null;
  try {
    const value = JSON.parse(decodeURIComponent(hash.slice('#home-layout='.length)));
    if (value?.layout?.version !== 1 || !Array.isArray(value.layout.widgets)) return null;
    return {
      layout: normalizeState(value.layout),
      preferences: {
        pin: value.preferences?.pin === true,
        reducedMotion: value.preferences?.reducedMotion === true,
      },
    };
  } catch {
    return null;
  }
}

/** Stage an addition against the original pages so drag/resize previews never accumulate reflow. */
export function previewWidgetAddition(
  state,
  widget,
  { mode = 'wide', rows = 4, page = 0, x, y, w, h } = {},
) {
  if (
    !validWidget(widget) ||
    state.widgets.length >= 24 ||
    state.widgets.some((item) => item.id === widget.id)
  )
    return state;
  mode = validMode(mode);
  rows = Math.max(2, Math.min(8, Math.floor(rows) || 4));
  const pages = paginateHomeLayout(state, mode, rows);
  page = Math.max(0, Math.min(pages.length - 1, page));
  const current = pages[page] || [];
  const size = dimensions(widget, mode);
  const footprint = normalizedFootprint(widget.type, mode, {
    w: w ?? size.w,
    h: Math.min(h ?? size.h, rows),
  });
  let target = { ...widget, ...footprint, x: 0, y: 0 };
  if (Number.isFinite(x) && Number.isFinite(y))
    target = clamped(target, x, Math.min(y, rows - target.h), MODES[mode]);
  else target = fitWithinPage(target, current, MODES[mode], rows, 0, 0) || target;
  const clear = current.filter((item) => !overlaps(item, target));
  const displaced = current.filter((item) => overlaps(item, target));
  const placed = [target, ...clear];
  const spill = [];
  for (const item of displaced) {
    const slot = fitWithinPage(item, placed, MODES[mode], rows, item.x, item.y);
    if (slot) placed.push(slot);
    else spill.push(item);
  }
  const layouts = pages.map((items, index) => (index === page ? placed : items));
  if (!layouts.length) layouts.push(placed);
  const positions = layouts.flatMap((items, index) =>
    items.map((item) => ({ id: item.id, x: item.x, y: item.y + index * rows })),
  );
  let overflow = [];
  for (const item of spill) overflow.push(fit(item, overflow, MODES[mode]));
  positions.push(
    ...overflow.map((item) => ({ id: item.id, x: item.x, y: item.y + layouts.length * rows })),
  );
  const byId = new Map(pages.flat().map((item) => [item.id, item]));
  const next = cloneState(normalizeState(state));
  next.widgets = next.widgets.map((item) => {
    const displayed = byId.get(item.id);
    return displayed
      ? { ...item, footprints: { ...item.footprints, [mode]: { w: displayed.w, h: displayed.h } } }
      : item;
  });
  next.widgets.push({ ...widget, footprints: { ...widget.footprints, [mode]: footprint } });
  next.positions[mode] = positions;
  return next;
}

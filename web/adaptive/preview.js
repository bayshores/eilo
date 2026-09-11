import { gsap, Flip } from './dependencies.js';
import { adaptiveFixtureResources, adaptiveFixtures } from './fixtures.js';
import { createAdaptiveMotion } from './motion.js';
import { ADAPTIVE_ACTIONS, createAdaptiveRenderer } from './renderer.js';

const FIXTURE_KEYS = Object.freeze(['writing', 'travel', 'creative', 'admin', 'study', 'coding']);
const MAX_PINNED = 8;
const OPTIONAL_CONTENT_LIMIT = 4;
const create = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const clone = (value) => structuredClone(value);

/** A fixture-only proof surface. It owns no task state, capture, or server connection. */
export function mountAdaptivePreview({ host, onExit } = {}) {
  if (!host?.replaceChildren) throw new TypeError('A preview host element is required.');
  const shell = create('section', 'adaptive-preview');
  const top = create('header', 'adaptive-preview__header');
  const heading = create('div');
  heading.append(
    create('p', 'adaptive-preview__label', 'Adaptive Home · preview'),
    create('p', '', 'Sample data'),
  );
  const controls = create('div', 'adaptive-preview__controls');
  const select = create('select', 'adaptive-preview__select');
  for (const key of FIXTURE_KEYS) {
    const option = create('option', '', key[0].toUpperCase() + key.slice(1));
    option.value = key;
    select.append(option);
  }
  const previous = create('button', 'adaptive-preview__button', 'Previous');
  const next = create('button', 'adaptive-preview__button', 'Next');
  const undo = create('button', 'adaptive-preview__button', 'Undo');
  const reduced = create('input');
  reduced.type = 'checkbox';
  reduced.id = 'adaptive-preview-reduced';
  const reducedLabel = create('label', 'adaptive-preview__reduced', 'Reduced motion');
  reducedLabel.htmlFor = reduced.id;
  reducedLabel.prepend(reduced);
  controls.append(select, previous, next, undo, reducedLabel);
  if (onExit) {
    const exit = create(
      'button',
      'adaptive-preview__button adaptive-preview__exit',
      'Exit preview',
    );
    exit.type = 'button';
    exit.addEventListener('click', onExit);
    controls.append(exit);
  }
  top.append(heading, controls);
  const status = create('p', 'adaptive-preview__status');
  status.setAttribute('role', 'status');
  const board = create('div', 'adaptive-preview__board');
  shell.append(top, status, board);
  host.replaceChildren(shell);

  let selected = 0;
  let history = [];
  let queued = null;
  let pointerActive = false;
  let destroyed = false;
  const pinned = new Map();
  const nativeMotion = createAdaptiveMotion({ gsap, Flip, isBusy: () => isUnsafe() });
  const motion = {
    transition(mutator, targets, options) {
      if (reduced.checked) return mutator();
      return nativeMotion.transition(mutator, targets, options);
    },
    feedback: (target) => {
      if (!reduced.checked) nativeMotion.feedback(target);
    },
    destroy: () => nativeMotion.destroy(),
  };
  const renderer = createAdaptiveRenderer(board, {
    motion,
    resources: adaptiveFixtureResources,
    onAction(action) {
      if (action.id === ADAPTIVE_ACTIONS.pin) {
        const component = currentComposition().components.find(
          (item) => item.id === action.componentId,
        );
        if (!component) return;
        if (pinned.size >= MAX_PINNED && !pinned.has(component.id)) {
          status.textContent = `Keep up to ${MAX_PINNED} pinned cards in this preview.`;
          return;
        }
        const position = previewComposition().components.findIndex(
          (item) => item.id === component.id,
        );
        pinned.set(component.id, {
          component: clone(component),
          // A simple 12-column slot map, not a pixel anchor.
          slot: {
            column: (Math.max(0, position) % 2) * 6 + 1,
            row: Math.floor(Math.max(0, position) / 2) + 1,
          },
        });
      }
      if (action.id === ADAPTIVE_ACTIONS.unpin) pinned.delete(action.componentId);
      if (action.id === ADAPTIVE_ACTIONS.pin || action.id === ADAPTIVE_ACTIONS.unpin) renderNow();
    },
  });

  const unsafeMenu = () => document.querySelector('dialog[open], [role="menu"][data-open="true"]');
  const isUnsafe = () => {
    const active = document.activeElement;
    return Boolean(
      document.hidden ||
      pointerActive ||
      unsafeMenu() ||
      active?.matches?.('textarea, input, [contenteditable="true"]') ||
      window.getSelection?.()?.toString(),
    );
  };
  const currentComposition = () => adaptiveFixtures[FIXTURE_KEYS[selected]];
  const previewComposition = () => {
    const source = clone(currentComposition());
    const pinnedIds = new Set(pinned.keys());
    const optional = source.components.filter((component) => !pinnedIds.has(component.id));
    source.components = [
      ...source.components.filter((component) => pinnedIds.has(component.id)),
      ...optional.slice(0, OPTIONAL_CONTENT_LIMIT),
      ...[...pinned.values()]
        .map(({ component }) => component)
        .filter((component) => !source.components.some((item) => item.id === component.id)),
    ];
    source.revision += history.length + selected + pinned.size;
    return source;
  };
  const renderNow = () => {
    if (destroyed) return;
    const composition = previewComposition();
    board.dataset.fixture = FIXTURE_KEYS[selected];
    renderer.update(composition);
    renderer.setPinned([...pinned.keys()]);
    for (const card of board.querySelectorAll('[data-component-id]')) {
      const record = pinned.get(card.dataset.componentId);
      card.style.removeProperty('grid-column');
      card.style.removeProperty('grid-row');
      if (record) {
        card.style.gridColumn = `${record.slot.column} / span 6`;
        card.style.gridRow = String(record.slot.row);
      }
    }
    select.value = FIXTURE_KEYS[selected];
    undo.disabled = history.length === 0;
    status.textContent = `${FIXTURE_KEYS[selected]} sample${pinned.size ? ` · ${pinned.size} pinned` : ''}`;
  };
  const request = (nextIndex) => {
    const normalized = (nextIndex + FIXTURE_KEYS.length) % FIXTURE_KEYS.length;
    if (isUnsafe()) {
      queued = normalized;
      status.textContent = 'Sample change is ready when editing or selection is released.';
      return;
    }
    if (normalized === selected) return;
    history.push(selected);
    selected = normalized;
    renderNow();
  };
  const flush = () => {
    if (queued === null || isUnsafe()) return;
    const nextIndex = queued;
    queued = null;
    request(nextIndex);
  };
  previous.addEventListener('click', () => request(selected - 1));
  next.addEventListener('click', () => request(selected + 1));
  select.addEventListener('change', () => request(FIXTURE_KEYS.indexOf(select.value)));
  undo.addEventListener('click', () => {
    if (!history.length || isUnsafe()) return;
    selected = history.pop();
    renderNow();
  });
  reduced.addEventListener('change', () => {
    status.textContent = reduced.checked ? 'Reduced motion shown.' : 'Motion shown.';
  });
  const onPointerDown = () => {
    pointerActive = true;
  };
  const onRelease = () => {
    pointerActive = false;
    queueMicrotask(flush);
  };
  const onFocusOut = () => queueMicrotask(flush);
  const onSelectionChange = () => queueMicrotask(flush);
  shell.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointerup', onRelease, true);
  window.addEventListener('pointercancel', onRelease, true);
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('visibilitychange', flush);
  renderNow();
  return {
    destroy() {
      destroyed = true;
      renderer.destroy();
      shell.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointerup', onRelease, true);
      window.removeEventListener('pointercancel', onRelease, true);
      document.removeEventListener('focusout', onFocusOut, true);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('visibilitychange', flush);
      host.replaceChildren();
    },
  };
}

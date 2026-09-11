import { normalizeComposition } from './catalog.js';
import { renderTrackingWidget, renderUsageWidget } from '../home/context-widgets.js';

export const ADAPTIVE_ACTIONS = Object.freeze({
  pin: 'adaptive.pin',
  unpin: 'adaptive.unpin',
  noteDraft: 'adaptive.note-draft',
  openResource: 'adaptive.open-resource',
  feedback: 'adaptive.feedback',
  openConnections: 'adaptive.open-connections',
  openActivity: 'adaptive.open-activity',
});
const create = (tag, className, content) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
};
const asItems = (value) =>
  Array.isArray(value)
    ? value.map((item, index) =>
        typeof item === 'string' ? { id: `bound-${index + 1}`, label: item } : item,
      )
    : [];

export function componentPatchPolicy(previous, next) {
  if (!previous) return 'create';
  if (!next) return 'remove';
  return previous.id === next.id && previous.kind === next.kind ? 'patch' : 'replace';
}
export function shouldPreserveNoteDraft(draft, incomingText) {
  return Boolean(draft && draft.sourceText === (incomingText || ''));
}
/** Return only DOM moves needed to reach an order, deferring a focused keyed card. */
export function keyedMovePlan(current, desired, focusedId) {
  if (focusedId && current.indexOf(focusedId) !== desired.indexOf(focusedId)) return [];
  const order = [...current];
  const moves = [];
  for (let index = 0; index < desired.length; index++) {
    if (order[index] === desired[index]) continue;
    const from = order.indexOf(desired[index]);
    if (desired[index] === focusedId) continue;
    moves.push({ id: desired[index], before: order[index] || null });
    if (from !== -1) order.splice(from, 1);
    order.splice(index, 0, desired[index]);
  }
  return moves;
}

function list(body, items) {
  if (!asItems(items).length) return;
  const output = create('ul', 'live-agenda adaptive-card__items');
  for (const item of asItems(items)) {
    const row = create('li', 'live-task adaptive-item');
    const copy = create('div', 'live-task-copy');
    copy.append(create('strong', '', item.label || 'Untitled'));
    if (item.detail) copy.append(create('span', 'live-task-meta', item.detail));
    row.append(copy);
    if (item.status || item.value)
      row.append(create('span', 'live-task-meta', item.value || item.status));
    output.append(row);
  }
  body.append(output);
}
function comparison(body, items) {
  const options = create('div', 'adaptive-comparison');
  for (const item of asItems(items).slice(0, 3)) {
    const option = create('article', 'adaptive-option');
    option.append(
      create('strong', 'adaptive-option__value', item.value || '—'),
      create('span', 'adaptive-option__label', item.label || 'Option'),
    );
    if (item.detail) option.append(create('span', 'adaptive-option__detail', item.detail));
    options.append(option);
  }
  body.append(options);
}
function stages(body, items) {
  const stages = create('ol', 'goal-steps adaptive-stages');
  for (const item of asItems(items)) {
    const stage = create('li', 'goal-step');
    stage.dataset.status = item.status || 'pending';
    stage.classList.toggle('current', item.status === 'next');
    const dot = create('span', 'goal-dot');
    dot.setAttribute('aria-hidden', 'true');
    const copy = create('div');
    copy.append(create('strong', '', item.label || 'Stage'));
    if (item.status) copy.append(create('p', '', item.status === 'next' ? 'Up next' : item.status));
    stage.append(dot, copy);
    stages.append(stage);
  }
  body.append(stages);
}
function resources(body, items, onAction) {
  const tiles = create('div', 'live-agenda adaptive-resources');
  for (const item of asItems(items)) {
    const tile = create('article', 'live-task');
    const copy = create('div', 'live-task-copy');
    copy.append(create('strong', '', item.label || 'Source'));
    if (item.detail || item.status)
      copy.append(create('span', 'live-task-meta', item.detail || item.status));
    tile.append(copy);
    if (item.url && item.id) {
      const open = create('button', 'text-button', 'Open');
      open.type = 'button';
      open.addEventListener('click', () =>
        onAction?.({ id: ADAPTIVE_ACTIONS.openResource, resourceId: item.id }),
      );
      tile.append(open);
    }
    tiles.append(tile);
  }
  body.append(tiles);
}
function timeline(body, items) {
  const source = asItems(items);
  const maximum = Math.max(1, ...source.map((item) => Number(item.duration) || 0));
  const rows = create('ol', 'adaptive-timeline');
  for (const item of source) {
    const row = create('li', 'adaptive-timeline__row');
    row.append(create('span', 'adaptive-timeline__label', item.label || 'Moment'));
    if (item.duration) {
      const track = create('span', 'adaptive-timeline__track');
      const interval = create('span', 'adaptive-timeline__interval');
      interval.style.width = `${Math.max(8, (100 * item.duration) / maximum)}%`;
      track.append(interval);
      row.append(track);
    }
    if (item.detail || item.value)
      row.append(create('span', 'adaptive-timeline__detail', item.detail || item.value));
    rows.append(row);
  }
  body.append(rows);
}
function makeCard(component, onAction, motion) {
  const card = create('article', `home-widget adaptive-card adaptive-card--${component.kind}`);
  card.dataset.componentId = component.id;
  const content = create('div', 'widget-content live-content adaptive-card__content');
  const header = create('header', 'adaptive-card__header');
  const heading = create('h2', 'adaptive-card__title');
  const pin = create('button', 'adaptive-card__pin', 'Pin');
  pin.type = 'button';
  pin.addEventListener('click', () => {
    menu.open = false;
    motion?.feedback?.(pin);
    onAction({ id: pin.dataset.action, componentId: card.dataset.componentId });
  });
  const menu = create('details', 'adaptive-card__menu');
  const toggle = create('summary', 'text-button');
  toggle.innerHTML = '<svg aria-hidden="true"><use href="#more"/></svg>';
  menu.append(toggle);
  const choices = create('div', 'adaptive-card__choices');
  choices.append(pin);
  for (const [value, label] of [
    ['prefer', 'Useful for this work'],
    ['less', 'Less useful here'],
  ]) {
    const choice = create('button', '', label);
    choice.type = 'button';
    choice.addEventListener('click', () => {
      menu.open = false;
      onAction({ id: ADAPTIVE_ACTIONS.feedback, componentId: card.dataset.componentId, value });
    });
    choices.append(choice);
  }
  menu.append(choices);
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    menu.open = false;
    toggle.focus();
  });
  header.append(heading);
  content.append(header, create('div', 'adaptive-card__body'));
  card.append(content, menu);
  return card;
}
function resolvedData(component, resources, getBinding) {
  const external = getBinding?.(component.binding || {}, component);
  if (external !== undefined) return external;
  if (!component.binding) return component.items;
  const source = resources?.[component.binding.id];
  return component.binding.field ? source?.[component.binding.field] : source || component.items;
}
function patchNote(body, component, drafts, onAction) {
  let textarea = body.querySelector('.adaptive-note');
  const draft = drafts.get(component.id);
  const incoming = component.text || '';
  if (!textarea) {
    textarea = create('textarea', 'note-input adaptive-note');
    textarea.rows = 5;
    textarea.placeholder = 'A thought for later…';
    textarea.addEventListener('input', () => {
      drafts.set(component.id, {
        sourceText: textarea.dataset.sourceText || '',
        value: textarea.value,
      });
      onAction({
        id: ADAPTIVE_ACTIONS.noteDraft,
        componentId: component.id,
        draft: textarea.value,
      });
    });
    body.replaceChildren(textarea);
  }
  const value = shouldPreserveNoteDraft(draft, incoming) ? draft.value : incoming;
  if (textarea.value !== value) textarea.value = value;
  if (value === incoming) drafts.delete(component.id);
  textarea.dataset.sourceText = incoming;
  textarea.setAttribute('aria-label', component.title);
}
function patchCard(card, component, context) {
  card.className = `home-widget adaptive-card adaptive-card--${component.kind} adaptive-card--${component.emphasis}`;
  card.dataset.componentId = component.id;
  card
    .querySelector('.adaptive-card__menu summary')
    .setAttribute('aria-label', `${component.title} widget options`);
  const pin = card.querySelector('.adaptive-card__pin');
  const pinned = card.dataset.pinned === 'true';
  pin.textContent = pinned ? 'Unpin' : 'Pin';
  pin.dataset.action = pinned ? ADAPTIVE_ACTIONS.unpin : ADAPTIVE_ACTIONS.pin;
  const data = resolvedData(component, context.resources, context.getBinding);
  if (['connections', 'usage'].includes(component.kind)) {
    const content = card.querySelector('.widget-content');
    const widgetView = data?.widgetView || { connection: 'loading' };
    const onConnect = () => context.onAction({ id: ADAPTIVE_ACTIONS.openConnections });
    if (component.kind === 'connections') renderTrackingWidget(content, widgetView, onConnect);
    else
      renderUsageWidget(
        content,
        widgetView,
        () => context.onAction({ id: ADAPTIVE_ACTIONS.openActivity }),
        onConnect,
      );
    const heading = content.querySelector('h2');
    heading.classList.add('adaptive-card__title');
    heading.textContent = component.title;
    return;
  }
  card.querySelector('.adaptive-card__title').textContent = component.title;
  const body = card.querySelector('.adaptive-card__body');
  if (component.kind === 'note')
    return patchNote(body, component, context.drafts, context.onAction);
  body.replaceChildren();
  if (component.kind === 'intention')
    body.append(create('p', 'live-empty', component.text || 'No context supplied.'));
  else if (component.kind === 'comparison') {
    if (!asItems(data || component.items).length && component.text)
      body.append(create('p', 'live-empty', component.text));
    else comparison(body, data || component.items);
  } else if (component.kind === 'stages') stages(body, data || component.items);
  else if (component.kind === 'resources') {
    if (!asItems(data || component.items).length && component.text)
      body.append(create('p', 'live-empty', component.text));
    else resources(body, data || component.items, context.onAction);
  } else if (component.kind === 'timeline') timeline(body, data || component.items);
  else {
    if (component.text) body.append(create('p', 'live-empty', component.text));
    list(body, data || component.items);
  }
}
function reconcileOrder(grid, nextCards, components) {
  const desired = components.map((component) => component.id);
  const activeCard = document.activeElement?.closest?.('[data-component-id]');
  const moves = keyedMovePlan(
    [...grid.children].map((card) => card.dataset.componentId),
    desired,
    activeCard?.dataset.componentId,
  );
  for (const move of moves) {
    const card = nextCards.get(move.id);
    const before = move.before ? nextCards.get(move.before) : null;
    if (grid.moveBefore && card.parentNode === grid) grid.moveBefore(card, before);
    else grid.insertBefore(card, before);
  }
  for (const id of desired) if (!nextCards.get(id).parentNode) grid.append(nextCards.get(id));
  for (const card of [...grid.children])
    if (!nextCards.has(card.dataset.componentId)) card.remove();
}
export function createAdaptiveRenderer(
  host,
  { onAction, motion, resources = {}, getBinding, onLayout } = {},
) {
  if (!host?.replaceChildren) throw new TypeError('A host element is required.');
  const root = create('section', 'adaptive-surface');
  const title = create('h1', 'adaptive-surface__title');
  const grid = create('div', 'adaptive-surface__grid');
  root.append(title, grid);
  host.replaceChildren(root);
  const closeMenus = (event) => {
    for (const menu of root.querySelectorAll('.adaptive-card__menu[open]'))
      if (!menu.contains(event.target)) menu.open = false;
  };
  document.addEventListener('click', closeMenus);
  let composition = null;
  let cards = new Map();
  let destroyed = false;
  const drafts = new Map();
  const dispatch = (action) => onAction?.(action);
  const update = (nextValue) => {
    if (destroyed) return false;
    const next = normalizeComposition(nextValue);
    if (!next) return false;
    const render = () => {
      title.textContent = next.title;
      const nextCards = new Map();
      for (const component of next.components) {
        const previous = composition?.components.find((item) => item.id === component.id);
        const card =
          componentPatchPolicy(previous, component) === 'patch'
            ? cards.get(component.id)
            : makeCard(component, dispatch, motion);
        if (JSON.stringify(previous) !== JSON.stringify(component))
          patchCard(card, component, { resources, getBinding, drafts, onAction: dispatch, motion });
        nextCards.set(component.id, card);
      }
      reconcileOrder(grid, nextCards, next.components);
      cards = nextCards;
      composition = next;
      onLayout?.(next);
    };
    const content =
      composition?.components.length === next.components.length &&
      next.components.every(
        (item, index) =>
          item.id === composition.components[index].id &&
          item.emphasis === composition.components[index].emphasis,
      );
    motion?.transition(render, [...cards.values()], {
      content,
      getTargets: () => [...cards.values()],
    });
    if (!motion) render();
    return true;
  };
  return {
    update,
    refreshBindings() {
      // Recorded time and source health update their own content. They do not
      // move the layout or rebuild unrelated editable widgets.
      if (destroyed || !composition) return;
      for (const component of composition.components)
        if (component.binding || ['usage', 'connections'].includes(component.kind))
          patchCard(cards.get(component.id), component, {
            resources,
            getBinding,
            drafts,
            onAction: dispatch,
            motion,
          });
    },
    setPinned(ids) {
      const set = new Set(ids || []);
      for (const [id, card] of cards) {
        card.dataset.pinned = String(set.has(id));
        const pin = card.querySelector('.adaptive-card__pin');
        pin.textContent = set.has(id) ? 'Unpin' : 'Pin';
        pin.dataset.action = set.has(id) ? ADAPTIVE_ACTIONS.unpin : ADAPTIVE_ACTIONS.pin;
      }
    },
    destroy() {
      destroyed = true;
      document.removeEventListener('click', closeMenus);
      motion?.destroy?.();
      cards.clear();
      drafts.clear();
      host.replaceChildren();
    },
  };
}

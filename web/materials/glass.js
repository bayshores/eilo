const MATERIAL_SELECTOR = [
  '.live-composer',
  '.goals-index',
  '.goal-detail',
  '.activity-usage-card',
  '.talk-history',
  '.workspace-inspector .button',
  '.workspace-inspector .goal-filter',
  '.workspace-inspector .activity-first-use',
  '.unified-card',
  '.unified-detail',
  '.unified-replies .button',
  '.context-panel--embedded .context-panel__tab',
  '.context-panel--embedded .button',
  '.connections-manager__row',
  '.connections-manager__add-form',
  '.calendar-connection__content',
  '.briefing-sources__account',
  '.settings-account',
  '.header-actions .button',
  '.activity-header-controls > .button',
  '.activity-timeline',
  '.activity-record',
].join(',');

function candidates(root, selector) {
  const nodes = [];
  if (root instanceof Element && root.matches(selector)) nodes.push(root);
  if (root.querySelectorAll) nodes.push(...root.querySelectorAll(selector));
  return nodes;
}

function decorate(root = document) {
  for (const element of candidates(root, MATERIAL_SELECTOR)) element.classList.add('eilo-glass');
  for (const surface of candidates(
    root,
    '.workspace.unified-home .conversation-dock, .context-panel--embedded .context-panel__body',
  ))
    surface.classList.add('eilo-glass-surface');
  for (const field of candidates(
    root,
    '.context-panel--embedded :is(input:not([type="checkbox"]):not([type="range"]), select)',
  )) {
    if (field.parentElement?.classList.contains('eilo-glass-control')) continue;
    const face = document.createElement('span');
    face.className = 'eilo-glass-control';
    field.before(face);
    face.append(field);
  }
}

decorate();
const observer = new MutationObserver((records) => {
  for (const record of records)
    for (const added of record.addedNodes) if (added instanceof Element) decorate(added);
});
observer.observe(document.body, { childList: true, subtree: true });
window.addEventListener('pagehide', () => observer.disconnect(), { once: true });

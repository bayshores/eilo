import { glassOffset, glassPose, mapSize } from './glass-math.js';
const surfaceSelector =
  '.context-panel--embedded .context-panel__body, .unified-home .conversation-dock';
const fieldSelector =
  '.context-panel--embedded select, .context-panel--embedded input[type="text"], .context-panel--embedded input[type="search"]';
const selector =
  ".home-widget:not(.widget-preview):not(.drag-ghost), .live-composer, .goals-index, .goal-detail, .activity-usage-card, .talk-history, .workspace-inspector .button, .workspace-inspector .goal-filter, .workspace-inspector .activity-first-use, .unified-card, .unified-detail, .unified-replies .button, .context-panel--embedded .context-panel__tab, .context-panel--embedded .button, .connections-manager__row, .connections-manager__add-form, .calendar-connection__content, .briefing-sources__account, .settings-account, :root[data-source='live'] :is(.nav-rail, .header-actions .button, .activity-header-controls > .button, .activity-timeline, .activity-record)";
const records = new Map();
const hoverAllowed = matchMedia(
  '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
);
const plain = matchMedia('(prefers-reduced-transparency: reduce), (forced-colors: active)');
const svgNode = (name, attributes = {}) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
};
const svg = svgNode('svg', { width: 0, height: 0, 'aria-hidden': 'true' });
svg.style.position = 'absolute';
const defs = svgNode('defs');
svg.append(defs);
document.body.append(svg);
let nextId = 0,
  active = null,
  bounds = null,
  pose = null,
  frame = 0;
const FILTER_BLEED = 32;

function resetPose() {
  cancelAnimationFrame(frame);
  frame = 0;
  if (active) {
    active.classList.remove('eilo-glass-hover');
    for (const name of ['rotate', '--glass-light-x', '--glass-light-y', '--glass-light-angle'])
      active.style.removeProperty(name);
  }
  active = null;
  bounds = null;
  pose = null;
}
function blocked(element) {
  return (
    !hoverAllowed.matches ||
    element.matches(':disabled, [aria-disabled="true"]') ||
    document.body.classList.contains('reduce-motion') ||
    document.body.classList.contains('resize-active') ||
    !!element.closest(
      '.editing, .is-dragging, .is-resizing, .keyboard-moving, .holding-widget, .drag-ghost',
    ) ||
    element.matches('input:focus, textarea:focus, select:focus, [contenteditable]:focus') ||
    !!element.querySelector('input:focus, textarea:focus, select:focus, [contenteditable]:focus')
  );
}
function move(event) {
  const element = event.target.closest?.('.eilo-glass');
  if (event.pointerType !== 'mouse' || event.buttons || !records.has(element) || blocked(element)) {
    if (active) resetPose();
    return;
  }
  if (active !== element) {
    resetPose();
    active = element;
    bounds = element.getBoundingClientRect();
    element.classList.add('eilo-glass-hover');
  }
  pose = glassPose(
    (2 * (event.clientX - bounds.left)) / bounds.width - 1,
    (2 * (event.clientY - bounds.top)) / bounds.height - 1,
  );
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (!active || !pose) return;
    active.style.rotate = pose.rotation;
    active.style.setProperty('--glass-light-x', pose.lightX);
    active.style.setProperty('--glass-light-y', pose.lightY);
    active.style.setProperty('--glass-light-angle', pose.lightAngle);
  });
}

function rebuild(element, record) {
  record.timer = null;
  if (!element.isConnected || plain.matches || record.width < 1 || record.height < 1) return;
  const key = `${Math.round(record.width)}:${Math.round(record.height)}:${record.radius}`;
  if (record.key === key) return;
  const start = performance.now(),
    canvas = document.createElement('canvas');
  const size = mapSize(record.width, record.height);
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  const pixels = context.createImageData(size.width, size.height);
  pixels.data.fill(128);
  for (let alpha = 3; alpha < pixels.data.length; alpha += 4) pixels.data[alpha] = 255;
  const shoulder = Math.min(record.radius + 7, 24);
  for (let y = 0; y < size.height; y++) {
    const py = ((y + 0.5) * record.height) / size.height;
    for (let x = 0; x < size.width; x++) {
      const px = ((x + 0.5) * record.width) / size.width;
      if (
        px > shoulder &&
        px < record.width - shoulder &&
        py > shoulder &&
        py < record.height - shoulder
      )
        continue;
      const [dx, dy] = glassOffset(px, py, record.width, record.height, record.radius);
      const offset = (y * size.width + x) * 4;
      pixels.data[offset] = Math.round(127.5 + dx * 127.5);
      pixels.data[offset + 1] = Math.round(127.5 + dy * 127.5);
    }
  }
  context.putImageData(pixels, 0, 0);
  record.image.setAttribute('href', canvas.toDataURL());
  element.style.setProperty('--glass-refraction', `url("#${record.id}")`);
  record.key = key;
  const duration = performance.now() - start;
  record.builds++;
  record.totalMs += duration;
  element.dataset.glassMapBuilds = String(record.builds);
  element.dataset.glassBuildMs = duration.toFixed(2);
  element.dataset.glassTotalMs = record.totalMs.toFixed(2);
  element.dataset.glassMapSize = `${size.width}x${size.height}`;
}
// Reuse the previous map while geometry animates; encode one final map after 140 ms at rest.
const resize = new ResizeObserver((entries) => {
  for (const { target, borderBoxSize } of entries) {
    const record = records.get(target);
    if (!record) continue;
    const width = borderBoxSize?.[0]?.inlineSize ?? target.offsetWidth;
    const height = borderBoxSize?.[0]?.blockSize ?? target.offsetHeight;
    if (width < 1 || height < 1) continue;
    const radius = Math.min(
      parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0,
      width * 0.5,
      height * 0.5,
    );
    if (width === record.width && height === record.height && radius === record.radius) continue;
    Object.assign(record, { width, height, radius });
    record.filter.setAttribute('x', -FILTER_BLEED);
    record.filter.setAttribute('y', -FILTER_BLEED);
    record.filter.setAttribute('width', width + FILTER_BLEED * 2);
    record.filter.setAttribute('height', height + FILTER_BLEED * 2);
    record.image.setAttribute('width', width);
    record.image.setAttribute('height', height);
    clearTimeout(record.timer);
    record.timer = setTimeout(() => rebuild(target, record), 140);
  }
});

// The widget owns its positioning transform. Only its existing inner face may tilt.
function register(element) {
  if (element.matches('.home-widget')) {
    if (element.closest('.drag-ghost, .widget-preview')) return;
    const face = element.querySelector(':scope > .widget-content');
    if (!face) return;
    if (!element.classList.contains('eilo-glass-widget'))
      element.classList.add('eilo-glass-widget');
    element = face;
  }
  if (records.has(element) || element.closest('.drag-ghost, .widget-preview')) return;
  if (element.parentElement.closest('.eilo-glass:not(.eilo-glass-surface)')) return;
  const id = `eilo-glass-depth-${++nextId}`;
  const filter = svgNode('filter', {
    id,
    x: -FILTER_BLEED,
    y: -FILTER_BLEED,
    width: FILTER_BLEED * 2,
    height: FILTER_BLEED * 2,
    filterUnits: 'userSpaceOnUse',
    'color-interpolation-filters': 'sRGB',
  });
  const image = svgNode('feImage', {
    x: 0,
    y: 0,
    preserveAspectRatio: 'none',
    result: 'curvature',
  });
  filter.append(
    image,
    svgNode('feDisplacementMap', {
      in: 'SourceGraphic',
      in2: 'curvature',
      scale: 40,
      xChannelSelector: 'R',
      yChannelSelector: 'G',
    }),
  );
  defs.append(filter);
  records.set(element, {
    id,
    filter,
    image,
    width: 0,
    height: 0,
    radius: 0,
    key: '',
    builds: 0,
    totalMs: 0,
    timer: null,
  });
  element.classList.add('eilo-glass');
  element.parentElement.classList.add('eilo-glass-stage');
  resize.observe(element);
}
function scan(root) {
  if (!(root instanceof Element)) return;
  const surfaces = [...root.querySelectorAll(surfaceSelector)];
  if (root.matches(surfaceSelector)) surfaces.push(root);
  surfaces.forEach((surface) => {
    surface.classList.add('eilo-glass-surface');
    register(surface);
  });
  const fields = [...root.querySelectorAll(fieldSelector)];
  if (root.matches(fieldSelector)) fields.push(root);
  for (const field of fields) {
    if (field.parentElement.classList.contains('eilo-glass-control')) continue;
    const face = document.createElement('span');
    face.className = 'eilo-glass-control';
    field.before(face);
    face.append(field);
    register(face);
  }
  if (root.matches(selector)) register(root);
  root.querySelectorAll(selector).forEach(register);
}
new MutationObserver((changes) => {
  for (const change of changes) {
    if (change.type === 'childList') change.addedNodes.forEach(scan);
    else if (change.target.matches('.unified-home')) scan(change.target);
    else if (change.target.matches(selector)) register(change.target);
  }
  if (active && (!active.isConnected || blocked(active))) resetPose();
  for (const [element, record] of records) {
    if (element.isConnected) continue;
    clearTimeout(record.timer);
    resize.unobserve(element);
    record.filter.remove();
    records.delete(element);
  }
}).observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['class'],
});
scan(document.body);

document.addEventListener('pointerover', move);
document.addEventListener('pointermove', move);
document.addEventListener('pointerup', (event) =>
  setTimeout(() => {
    if (event.target.closest?.('.eilo-glass')?.matches(':hover')) move(event);
  }, 0),
);
document.addEventListener('pointerout', (event) => {
  if (active && !active.contains(event.relatedTarget)) resetPose();
});
document.addEventListener('pointerdown', resetPose, true);
document.addEventListener('pointercancel', resetPose);
document.addEventListener('focusin', (event) => {
  if (event.target.matches('input, textarea, select, [contenteditable]')) resetPose();
});
for (const event of ['resize', 'blur', 'hashchange']) addEventListener(event, resetPose);
addEventListener('scroll', resetPose, true);
document.addEventListener('visibilitychange', resetPose);
hoverAllowed.addEventListener('change', resetPose);
plain.addEventListener('change', () => {
  resetPose();
  for (const [element, record] of records) if (!plain.matches) rebuild(element, record);
});

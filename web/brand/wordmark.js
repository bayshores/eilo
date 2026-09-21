let sequence = 0;
export function stepWordmark(s, target, dt, moving = true) {
  const seconds = Math.max(0, Math.min(dt, 0.05));
  const ease = 1 - Math.exp(-seconds * 5.5);
  return {
    phase: s.phase + (moving ? seconds : 0),
    x: s.x + ((moving ? target.x : 0) - s.x) * ease,
    y: s.y + ((moving ? target.y : 0) - s.y) * ease,
  };
}
export async function mountGlassWordmark(host) {
  if (!host || host.dataset.glassWordmark) return null;
  host.dataset.glassWordmark = 'loading';
  try {
    const faces = await document.fonts.load('500 100px EiloWordmark');
    if (!faces.length || !host.isConnected) throw new Error('Wordmark unavailable');
    if (!document.fonts.check('500 100px EiloWordmark')) throw new Error('Font unavailable');
  } catch {
    delete host.dataset.glassWordmark;
    return null;
  }
  const savedPosition = host.style.position;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const original = [...host.childNodes];
  const existing =
    host.childElementCount === 1 && host.firstElementChild.tagName === 'SPAN'
      ? host.firstElementChild
      : null;
  const fallback = existing || document.createElement('span');
  fallback.classList.add('glass-wordmark-fallback');
  if (!existing) {
    fallback.append(...original);
    host.append(fallback);
  }
  const id = 'eilo-wordmark-' + ++sequence;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('glass-wordmark-visual');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = [
    '<defs>',
    '<text id="ID-letters" x="10" y="100" font-family="EiloWordmark" font-size="100" font-weight="500" letter-spacing="-4.2">felis</text>',
    '<linearGradient id="ID-face" x1="0" y1="0" x2=".25" y2="1"><stop offset="0" stop-color="#f5f4e8" stop-opacity=".8"/><stop offset=".26" stop-color="#cad7dc" stop-opacity=".58"/><stop offset=".52" stop-color="#8b9dad" stop-opacity=".30"/><stop offset=".79" stop-color="#e4e7e2" stop-opacity=".66"/><stop offset="1" stop-color="#a1b6c6" stop-opacity=".52"/></linearGradient>',
    '<linearGradient id="ID-edge" x1="0" y1="0" x2=".4" y2="1"><stop stop-color="#e6eef0" stop-opacity=".84"/><stop offset=".44" stop-color="#b4c0d2" stop-opacity=".1"/><stop offset=".76" stop-color="#081621" stop-opacity=".66"/><stop offset="1" stop-color="#d7e3df" stop-opacity=".75"/></linearGradient>',
    '<filter id="ID-light" x="-20%" y="-25%" width="145%" height="165%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceAlpha" stdDeviation="1.8" result="relief"/><feSpecularLighting in="relief" surfaceScale="4" specularConstant="1.1" specularExponent="18" lighting-color="#fff9e9" result="shine"><fePointLight x="35" y="-40" z="105"/></feSpecularLighting><feComposite in="shine" in2="SourceAlpha" operator="in" result="clipped"/><feComponentTransfer in="clipped"><feFuncA type="linear" slope=".8"/></feComponentTransfer></filter>',
    '<filter id="ID-shadow" x="-35%" y="-35%" width="180%" height="200%"><feGaussianBlur stdDeviation="2.2"/></filter>',
    '<mask id="ID-side" x="-20%" y="-25%" width="145%" height="165%"><rect x="-30" y="-30" width="400" height="250" fill="white"/><use href="#ID-letters" fill="black"/></mask>',
    '</defs>',
    '<g class="wordmark-shadow" fill="#030b16" opacity=".5" transform="translate(1 7)" filter="url(#ID-shadow)"><use href="#ID-letters"/></g>',
    '<g class="wordmark-relief"><g mask="url(#ID-side)"><use href="#ID-letters" fill="#152330" stroke="#182932" stroke-width="1.3" transform="translate(1.1 3)"/><use href="#ID-letters" fill="#748c9d" opacity=".58" transform="translate(.7 1.7)"/></g><use href="#ID-letters" fill="url(#ID-face)" stroke="url(#ID-edge)" stroke-width=".8"/><use href="#ID-letters" fill="white" filter="url(#ID-light)"/></g>',
  ]
    .join('')
    .replaceAll('ID-', id + '-');
  const optics = document.createElement('span');
  optics.className = 'glass-wordmark-optics';
  const backdrop = document.createElement('span');
  backdrop.className = 'glass-wordmark-backdrop';
  optics.append(backdrop, svg);
  host.append(optics);
  const advance = svg.querySelector('text').getComputedTextLength();
  svg.setAttribute('viewBox', '0 0 ' + (advance + 20) + ' 128');
  svg.setAttribute('preserveAspectRatio', 'none');
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((advance + 20) * 3);
  canvas.height = 384;
  const ctx = canvas.getContext('2d');
  ctx.scale(3, 3);
  ctx.font = '500 100px EiloWordmark';
  ctx.letterSpacing = '-4.2px';
  ctx.fillStyle = '#fff';
  ctx.fillText('felis', 10, 100);
  backdrop.style.maskImage = 'url(' + canvas.toDataURL() + ')';
  host.classList.add('glass-wordmark');
  host.dataset.glassWordmark = 'ready';
  const light = svg.querySelector('fePointLight'),
    shadow = svg.querySelector('.wordmark-shadow');
  const media = matchMedia('(prefers-reduced-motion: reduce)'),
    pointer = matchMedia('(hover: hover) and (pointer: fine)'),
    forced = matchMedia('(forced-colors: active)');
  const events = new AbortController();
  let state = { phase: 0, x: 0, y: 0 },
    target = { x: 0, y: 0 },
    frame = 0,
    previous = 0,
    visible = true,
    displayed = true,
    destroyed = false;
  function paused() {
    return (
      media.matches ||
      forced.matches ||
      document.body.classList.contains('motion-paused') ||
      document.body.classList.contains('reduce-motion')
    );
  }
  function paint() {
    const t = state.phase;
    light.setAttribute(
      'x',
      (
        advance * (0.3 + 0.23 * Math.sin(t * 0.19) + 0.09 * Math.sin(t * 0.31 + 0.7)) +
        state.x * 55
      ).toFixed(2),
    );
    light.setAttribute('y', (-24 + 17 * Math.sin(t * 0.17 + 0.8) + state.y * 30).toFixed(2));
    light.setAttribute('z', (95 + 14 * Math.sin(t * 0.13)).toFixed(2));
    optics.style.transform =
      'perspective(700px) rotateX(' + -state.y * 3 + 'deg) rotateY(' + state.x * 4 + 'deg)';
    shadow.setAttribute(
      'transform',
      'translate(' + (1 - state.x * 1.2) + ' ' + (7 - state.y * 0.8) + ')',
    );
  }
  function render(time) {
    frame = 0;
    if (destroyed || !visible || !displayed || document.hidden || paused()) {
      previous = 0;
      return;
    }
    if (!previous) previous = time;
    if (time - previous >= 1000 / 30) {
      state = stepWordmark(state, target, (time - previous) / 1000);
      previous = time;
      paint();
    }
    frame = requestAnimationFrame(render);
  }
  function isDisplayed() {
    for (let node = host; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (
        node.hidden ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity) === 0
      )
        return false;
    }
    return true;
  }
  function synchronize() {
    displayed = isDisplayed();
    cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
    if (paused()) {
      target = { x: 0, y: 0 };
      state.x = 0;
      state.y = 0;
      paint();
    } else if (visible && displayed && !document.hidden && !destroyed)
      frame = requestAnimationFrame(render);
  }
  function position() {
    const b = fallback.getBoundingClientRect(),
      p = host.getBoundingClientRect();
    optics.style.left = b.left - p.left - 4 + 'px';
    optics.style.top = b.top - p.top - 3 + 'px';
    optics.style.width = b.width + 8 + 'px';
    optics.style.height = b.height + 10 + 'px';
  }
  host.addEventListener(
    'pointermove',
    (event) => {
      if (paused() || !pointer.matches || event.pointerType !== 'mouse') return;
      const b = host.getBoundingClientRect();
      target = {
        x: Math.max(-1, Math.min(1, (2 * (event.clientX - b.left)) / b.width - 1)),
        y: Math.max(-1, Math.min(1, (2 * (event.clientY - b.top)) / b.height - 1)),
      };
    },
    { signal: events.signal },
  );
  for (const name of ['pointerleave', 'pointercancel'])
    host.addEventListener(
      name,
      () => {
        target = { x: 0, y: 0 };
      },
      { signal: events.signal },
    );
  document.addEventListener('visibilitychange', synchronize, { signal: events.signal });
  window.addEventListener(
    'blur',
    () => {
      target = { x: 0, y: 0 };
    },
    { signal: events.signal },
  );
  media.addEventListener('change', synchronize, { signal: events.signal });
  forced.addEventListener('change', synchronize, { signal: events.signal });
  const resize = new ResizeObserver(position);
  resize.observe(fallback);
  const visibility = new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    synchronize();
  });
  visibility.observe(host);
  const settings = new MutationObserver(synchronize);
  for (let node = host.parentElement; node; node = node.parentElement) {
    settings.observe(node, { attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
  }
  position();
  paint();
  synchronize();
  return {
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      events.abort();
      resize.disconnect();
      visibility.disconnect();
      settings.disconnect();
      optics.remove();
      if (existing) fallback.classList.remove('glass-wordmark-fallback');
      else fallback.replaceWith(...original);
      host.classList.remove('glass-wordmark');
      host.style.position = savedPosition;
      delete host.dataset.glassWordmark;
    },
  };
}

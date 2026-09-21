const bridge = globalThis.eiloOverlay;
const overlay = document.querySelector('.overlay');
const message = document.querySelector('#message');
const open = document.querySelector('#open');
const dismiss = document.querySelector('#dismiss');
const orbHost = document.querySelector('#orb');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const webRoot = new URL('../../web/', import.meta.url);
const fontRoot = new URL('assets/fonts/', webRoot);
const fonts = [
  new FontFace('Geist Mono', `url(${new URL('geist-mono.woff2', fontRoot)})`, {
    weight: '100 900',
  }),
  new FontFace('Geist Sans', `url(${new URL('geist-sans.woff2', fontRoot)})`, {
    weight: '100 900',
  }),
];
for (const font of fonts) document.fonts.add(font);
await Promise.allSettled(fonts.map((font) => font.load()));

let orb = null;
try {
  const { createVoiceOrb } = await import(new URL('orb/renderer.js', webRoot));
  orb = createVoiceOrb(orbHost, { detail: 14, interactive: false });
  const updateOrb = () =>
    orb?.update({ color: '#fac399', reducedMotion: reducedMotion.matches, busy: false });
  reducedMotion.addEventListener('change', updateOrb);
  updateOrb();
} catch {
  overlay.dataset.orb = 'unavailable';
}

let closing = false;
let hasMessage = false;

function revealMessage(value) {
  if (hasMessage && !reducedMotion.matches) {
    message.classList.remove('is-refreshing');
    requestAnimationFrame(() => {
      message.textContent = value.text;
      message.classList.add('is-refreshing');
    });
  } else {
    message.textContent = value.text;
  }
  hasMessage = true;
  overlay.classList.remove('is-leaving');
  requestAnimationFrame(() => overlay.classList.add('is-ready'));
}

function finish(action) {
  if (closing) return;
  closing = true;
  open.disabled = true;
  dismiss.disabled = true;
  overlay.classList.add('is-leaving');

  let completed = false;
  const complete = () => {
    if (completed) return;
    completed = true;
    action();
  };
  if (reducedMotion.matches) {
    complete();
    return;
  }
  const transitionEnded = (event) => {
    if (event.target !== overlay || event.propertyName !== 'opacity') return;
    overlay.removeEventListener('transitionend', transitionEnded);
    complete();
  };
  overlay.addEventListener('transitionend', transitionEnded);
  setTimeout(complete, 240);
}

bridge?.onCheckIn(revealMessage);
bridge?.ready();

open.addEventListener('click', () => finish(() => bridge?.open()));
dismiss.addEventListener('click', () => finish(() => bridge?.dismiss()));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') finish(() => bridge?.dismiss());
});
window.addEventListener('pagehide', () => orb?.destroy(), { once: true });

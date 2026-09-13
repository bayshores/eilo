import { normalizeAccent } from '../home/storage.js';

export function accentChannels(color) {
  return [1, 3, 5].map((start) => parseInt(normalizeAccent(color).slice(start, start + 2), 16));
}

function luminance(channels) {
  return channels.reduce((sum, channel, index) => {
    const value = channel / 255;
    return (
      sum +
      (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
        [0.2126, 0.7152, 0.0722][index]
    );
  }, 0);
}

// Lighten dark choices so accent text and dark labels on filled buttons stay readable.
export function readableAccent(color) {
  let channels = accentChannels(color);
  while (luminance(channels) < 0.48) channels = channels.map((value) => Math.min(255, value + 1));
  return '#' + channels.map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function applyAccent(color) {
  document.documentElement.style.setProperty('--accent-color', normalizeAccent(color));
  document.documentElement.style.setProperty('--peach', readableAccent(color));
  document.documentElement.dataset.customAccent = String(normalizeAccent(color) !== '#fac399');
}

export function createAccentSelector({ value, onChange }) {
  const section = document.createElement('fieldset');
  section.className = 'accent-selector';
  section.innerHTML =
    '<legend>Accent color</legend><div class="accent-plane" role="group" aria-label="Saturation and brightness"><span class="accent-marker" aria-hidden="true"></span><input class="sr-only" type="range" min="0" max="100" step="1" aria-label="Saturation"><input class="sr-only" type="range" min="0" max="100" step="1" aria-label="Brightness"></div><input class="accent-hue" type="range" min="0" max="360" step="1" aria-label="Hue"><div class="accent-value"><span class="accent-swatch" aria-hidden="true"></span><input class="accent-hex" type="text" aria-label="Accent hex color" spellcheck="false" autocomplete="off"><button class="text-button accent-reset" type="button">Reset</button></div><p class="accent-feedback" role="status"></p>';
  const plane = section.querySelector('.accent-plane');
  const marker = section.querySelector('.accent-marker');
  const hex = section.querySelector('.accent-hex');
  const reset = section.querySelector('.accent-reset');
  const hue = section.querySelector('.accent-hue');
  const saturation = section.querySelector('[aria-label="Saturation"]');
  const brightness = section.querySelector('[aria-label="Brightness"]');
  const feedback = section.querySelector('.accent-feedback');
  let current = normalizeAccent(value);
  let hsv = hexToHsv(current);
  function sync() {
    hex.value = current;
    hex.removeAttribute('aria-invalid');
    reset.disabled = current === '#fac399';
    plane.style.setProperty('--hue', hsv.h);
    marker.style.left = hsv.s * 100 + '%';
    marker.style.top = (1 - hsv.v) * 100 + '%';
    hue.value = Math.round(hsv.h);
    saturation.value = Math.round(hsv.s * 100);
    brightness.value = Math.round(hsv.v * 100);
    hue.setAttribute('aria-valuetext', Math.round(hsv.h) + ' degrees');
    saturation.setAttribute('aria-valuetext', Math.round(hsv.s * 100) + ' percent');
    brightness.setAttribute('aria-valuetext', Math.round(hsv.v * 100) + ' percent');
    section.querySelector('.accent-swatch').style.background = current;
  }
  function choose(color, { convert = true } = {}) {
    current = normalizeAccent(color);
    if (convert) hsv = hexToHsv(current);
    applyAccent(current);
    feedback.textContent =
      onChange(current) === false ? 'Color applied for now; it could not be saved.' : '';
    sync();
  }
  function choosePoint(event) {
    const bounds = plane.getBoundingClientRect();
    hsv.s = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    hsv.v = 1 - Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    choose(hsvToHex(hsv.h, hsv.s, hsv.v), { convert: false });
  }
  plane.addEventListener('pointerdown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    event.preventDefault();
    plane.setPointerCapture(event.pointerId);
    choosePoint(event);
  });
  plane.addEventListener('pointermove', (event) => {
    if (plane.hasPointerCapture(event.pointerId)) choosePoint(event);
  });
  plane.addEventListener('pointerup', (event) => {
    if (plane.hasPointerCapture(event.pointerId)) plane.releasePointerCapture(event.pointerId);
  });
  for (const [input, key, scale] of [
    [hue, 'h', 1],
    [saturation, 's', 100],
    [brightness, 'v', 100],
  ]) {
    input.addEventListener('input', () => {
      hsv[key] = Number(input.value) / scale;
      choose(hsvToHex(hsv.h, hsv.s, hsv.v), { convert: false });
    });
  }
  const commitHex = () => {
    const value = hex.value.trim();
    const color = value.startsWith('#') ? value : '#' + value;
    if (new RegExp('^#[0-9a-f]{6}$', 'i').test(color)) choose(color);
    else {
      hex.setAttribute('aria-invalid', 'true');
      feedback.textContent = 'Enter six hex digits.';
    }
  };
  hex.addEventListener('change', commitHex);
  hex.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitHex();
    }
  });
  reset.addEventListener('click', () => {
    choose('#fac399');
    hex.focus({ preventScroll: true });
  });
  sync();
  return section;
}

export function hsvToHex(hue, saturation, value) {
  const h = (((hue % 360) + 360) % 360) / 60;
  const c = value * saturation,
    x = c * (1 - Math.abs((h % 2) - 1)),
    m = value - c;
  const channels = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][Math.floor(h)];
  return (
    '#' +
    channels
      .map((v) =>
        Math.round((v + m) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
export function hexToHsv(hex) {
  const [r, g, b] = [1, 3, 5].map(
    (start) => parseInt(normalizeAccent(hex).slice(start, start + 2), 16) / 255,
  );
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min;
  let h = 0;
  if (delta)
    h =
      60 *
      (max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4);
  return { h: (h + 360) % 360, s: max ? delta / max : 0, v: max };
}

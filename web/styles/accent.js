import { normalizeAccent } from '../home/storage.js';
const PRESETS = [
  ['Peach', '#fac399'],
  ['Rose', '#f5a9bf'],
  ['Lavender', '#c5b4fa'],
  ['Sky', '#99cefa'],
  ['Mint', '#9ddfc3'],
];

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
  section.innerHTML = `<legend>Accent color</legend><div class="accent-presets" role="group" aria-label="Accent presets"></div><div class="accent-custom"><label class="accent-picker-label">Custom<input type="color" aria-label="Custom accent color"></label><div class="accent-channels" role="group" aria-label="RGB color">${['Red', 'Green', 'Blue'].map((name) => `<label>${name[0]}<input type="number" min="0" max="255" step="1" required aria-label="${name}" inputmode="numeric"></label>`).join('')}</div></div><p class="accent-feedback" role="status"></p>`;
  const presets = section.querySelector('.accent-presets');
  const picker = section.querySelector('input[type="color"]');
  const channels = [...section.querySelectorAll('input[type="number"]')];
  const feedback = section.querySelector('.accent-feedback');
  let current = normalizeAccent(value);
  function sync() {
    picker.value = current;
    accentChannels(current).forEach((channel, index) => {
      channels[index].value = channel;
    });
    for (const button of presets.children)
      button.setAttribute('aria-pressed', String(button.dataset.color === current));
  }
  function choose(color) {
    current = normalizeAccent(color);
    applyAccent(current);
    feedback.textContent =
      onChange(current) === false ? 'Color applied for now; it could not be saved.' : '';
    sync();
  }
  for (const [name, color] of PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.color = color;
    button.innerHTML = '<span aria-hidden="true"></span>';
    button.querySelector('span').style.background = color;
    button.append(name);
    button.addEventListener('click', () => choose(color));
    presets.append(button);
  }
  picker.addEventListener('input', () => choose(picker.value));
  for (const input of channels) {
    input.addEventListener('input', () => {
      if (channels.every((channel) => channel.validity.valid)) {
        choose(
          '#' +
            channels.map((channel) => Number(channel.value).toString(16).padStart(2, '0')).join(''),
        );
      }
    });
    input.addEventListener('blur', sync);
  }
  sync();
  return section;
}

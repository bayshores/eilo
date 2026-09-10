const choices = {
  a: { name: 'A · Source Sans 3', description: 'Softer letterforms; a lighter reading rhythm.' },
  b: {
    name: 'B · IBM Plex Sans',
    description: 'Sharper letterforms; restrained headings and precise numbers.',
  },
  c: {
    name: 'C · Atkinson Hyperlegible Next',
    description: 'Open shapes and clearer distinctions between similar letters.',
  },
  current: {
    name: 'Previous · System sans',
    description: 'The original typography, before the selected B treatment.',
  },
};
const frame = document.querySelector('iframe');
let selected = 'a';
function select(value) {
  if (!choices[value]) return;
  selected = value;
  document
    .querySelectorAll('[data-type]')
    .forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.type === value)),
    );
  document.querySelector('#font-name').textContent = choices[value].name;
  document.querySelector('#type-description').textContent = choices[value].description;
  frame.contentWindow.postMessage({ type: 'eilo:typography', value }, location.origin);
}
document
  .querySelectorAll('[data-type]')
  .forEach((button) => button.addEventListener('click', () => select(button.dataset.type)));
frame.addEventListener('load', () => select(selected));
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
  if (event.data?.type === 'eilo:fonts-ready') document.documentElement.dataset.fontsReady = 'true';
});

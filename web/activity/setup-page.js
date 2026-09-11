import { mountChromeSetup } from './setup.js';
import '../styles/focus.js';

const guide = mountChromeSetup(document.querySelector('[data-chrome-setup]'));
window.addEventListener('pagehide', () => guide.destroy());

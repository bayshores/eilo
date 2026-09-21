import { desktopSetupState } from './setup-state.js';
import { createSetupMonitor } from './setup-monitor.js';
import { setupVisual, animateSetup } from './setup-visual.js';

export function mountDesktopSetup(
  container,
  {
    onConfigure,
    onRefresh,
    onDone,
    onDismiss = onDone,
    doneLabel = null,
    requestPermission = globalThis.eiloDesktop?.openContextPermission,
  } = {},
) {
  const make = (tag, name, text) => {
    const item = document.createElement(tag);
    if (name) item.className = name;
    if (text) item.textContent = text;
    return item;
  };
  const root = make('section', 'source-setup desktop-setup');
  root.setAttribute('aria-label', 'Desktop connection setup');
  const visual = setupVisual('desktop');
  const heading = make('h2');
  const copy = make('p', 'chrome-setup__copy');
  copy.setAttribute('role', 'status');
  const controls = make('div', 'chrome-setup__actions');
  const primary = make('button', 'chrome-setup__button chrome-setup__button--primary');
  primary.type = 'button';
  const later = make('button', 'chrome-setup__button', 'Not now');
  later.type = 'button';
  const feedback = make('p', 'chrome-setup__feedback');
  feedback.setAttribute('role', 'status');
  controls.append(primary, later);
  root.append(visual, heading, copy, controls, feedback);
  container.replaceChildren(root);
  let current = null,
    text = false,
    state = null,
    busy = false,
    destroyed = false,
    lastKey = '';
  const visible = () => root.isConnected !== false && (root.getClientRects?.().length ?? 1) > 0;
  const monitor = createSetupMonitor({ refresh: () => onRefresh?.(), visible });
  function render() {
    if (destroyed) return;
    state = desktopSetupState(current, { text });
    const key = JSON.stringify(state);
    if (key !== lastKey) {
      lastKey = key;
      heading.textContent = state.title;
      copy.textContent = state.copy;
      primary.textContent = state.action === 'done' && doneLabel ? doneLabel : state.label;
      visual.dataset.stage = String(state.stage);
      animateSetup(root);
    }
    primary.disabled = busy;
    if (state.id === 'connected') {
      monitor.stop();
      later.hidden = true;
    } else later.hidden = false;
  }
  primary.addEventListener('click', async () => {
    if (busy) return;
    if (state.action === 'done') {
      onDone?.();
      return;
    }
    busy = true;
    feedback.textContent = '';
    render();
    try {
      if (state.action === 'permission') {
        if (!requestPermission)
          feedback.textContent = 'In the felis Mac app, choose Continue to macOS.';
        else if (!(await requestPermission('text')))
          feedback.textContent =
            'The permission window could not open. Reopen felis and try again.';
        else
          feedback.textContent =
            'Follow the macOS prompt, then return here. We’ll check automatically.';
      } else if (state.action === 'connect')
        await onConfigure?.({ enabled: true, desktop_enabled: true });
      else if (state.action === 'resume') await onConfigure?.({ enabled: true });
      monitor.start({ restart: true });
      await onRefresh?.();
    } catch (error) {
      if (!destroyed)
        feedback.textContent = error?.message || 'The connection could not be checked.';
    } finally {
      busy = false;
      render();
    }
  });
  later.addEventListener('click', () => onDismiss?.());
  return {
    update(next, options = {}) {
      current = next;
      text = options.text === true;
      render();
      if (state.id !== 'connected') monitor.start();
    },
    focus() {
      primary.focus();
    },
    pause() {
      monitor.stop();
    },
    destroy() {
      destroyed = true;
      monitor.destroy();
      globalThis.gsap?.killTweensOf(root);
    },
  };
}

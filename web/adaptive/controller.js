import { ADAPTIVE_ACTIONS, createAdaptiveRenderer } from './renderer.js';
import { createAdaptiveMotion } from './motion.js';
import { gsap, Flip } from './dependencies.js';
import { refreshSetupHealth } from '../activity/setup-health.js';
import { selectTracking, selectBrowserUsage } from '../home/tracking-data.js';
import { createContextPanel, contextPolicyPatch, contextSummary } from './context-panel.js';

const create = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (text, className = '') => {
  const node = create('button', className, text);
  node.type = 'button';
  return node;
};
const sourceWidgetKey = (view) => JSON.stringify([selectTracking(view), selectBrowserUsage(view)]);

/** Production adaptive surface: a projection of the context service, never a capture authority. */
export function mountAdaptiveHome({
  host,
  client,
  isBusy = () => false,
  getManualPins = () => [],
  onModeChange,
  onOpenConnections,
  onOpenActivity,
  onTalk,
  onRendered,
} = {}) {
  if (!host?.replaceChildren || !client?.subscribe)
    throw new TypeError('A host and workspace client are required.');
  const shell = create('section', 'adaptive-home');
  const context = button('', 'button home-context-trigger');
  context.setAttribute('aria-haspopup', 'dialog');
  context.setAttribute('aria-expanded', 'false');
  context.innerHTML =
    '<span class="home-context-trigger__dot" aria-hidden="true"></span><span>Home context</span><span class="home-context-trigger__state"></span><svg aria-hidden="true"><use href="#arrow-right"/></svg>';
  const status = create('p', 'adaptive-home__status');
  status.setAttribute('role', 'status');
  status.hidden = true;
  const surface = create('div', 'adaptive-home__surface');
  shell.append(status, surface);
  host.replaceChildren(shell);
  let view = null,
    renderedView = null,
    pending = null,
    destroyed = false,
    noteTimer = null,
    lastRenderKey = '',
    lastBindingKey = '',
    lastPinsKey = '',
    lastModeKey = '',
    lastSummaryKey = '',
    lastSourceWidgetKey = '';
  const panel = createContextPanel({
    onCommand: (lane, action, fields) =>
      lane === 'context' && action === 'configure'
        ? configure(fields)
        : command(lane === 'home' ? 'homeCommand' : 'contextCommand', action, fields),
    onTalk,
    onRefreshSources: () => refreshSetupHealth('desktop', () => client.refresh()),
    onConnections: onOpenConnections,
    onClose: () => flush(),
  });
  const motion = createAdaptiveMotion({
    gsap,
    Flip,
    reducedMotion: () =>
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.body.classList.contains('reduce-motion'),
    isBusy,
  });
  const renderer = createAdaptiveRenderer(surface, {
    onAction: handleRendererAction,
    motion,
    onLayout: (composition) =>
      onRendered?.({ host: surface, composition, pins: domain(view)?.pins || [] }),
    getBinding: (binding, component) => {
      const data = domain(view);
      const resources = data?.current_work_context?.resources || [];
      if (['usage', 'connections'].includes(component.kind)) return { widgetView: view };
      const resource = resources.find((item) => item.id === binding.id);
      if (resource) return [resource];
      return undefined;
    },
  });

  const unsafe = () =>
    Boolean(
      document.hidden ||
      isBusy() ||
      document.querySelector(
        'dialog[open], [role="menu"][data-open="true"], .adaptive-card__menu[open]',
      ) ||
      document.activeElement?.matches?.('textarea, input, select, [contenteditable="true"]') ||
      window.getSelection?.()?.toString(),
    );
  const domain = (next) =>
    next?.snapshot?.adaptive || next?.adaptive || next?.snapshot?.context || null;
  const command = async (method, action, fields = {}) => {
    try {
      await client[method]?.(action, fields, domain(view)?.revision);
      // An explicit setting change may update the cached layout behind this
      // dialog. Incoming background proposals still wait for a safe moment.
      if (!isBusy() && (panel.isOpen || !unsafe())) {
        pending = null;
        render(view);
      }
      return true;
    } catch (error) {
      const message = error.message || 'That change was not saved. Try again.';
      status.dataset.state = 'error';
      status.textContent = message;
      status.hidden = panel.isOpen;
      panel.showError(message);
      return false;
    }
  };
  function configure(next) {
    return command('contextCommand', 'configure', contextPolicyPatch(domain(view), next));
  }
  function handleRendererAction(action) {
    if (action.id === ADAPTIVE_ACTIONS.openConnections) onOpenConnections?.();
    if (action.id === ADAPTIVE_ACTIONS.openActivity) onOpenActivity?.();
    if (action.id === ADAPTIVE_ACTIONS.openResource) {
      const current = domain(view)?.current_work_context;
      const resource = current?.resources?.find((item) => item.id === action.resourceId);
      if (resource && /^https?:\/\//.test(resource.url)) {
        if (globalThis.eiloDesktop?.openContextSource)
          void globalThis.eiloDesktop.openContextSource(current.id, resource.id);
        else window.open(resource.url, '_blank', 'noopener,noreferrer');
      }
    }
    if (action.id === ADAPTIVE_ACTIONS.pin)
      void command('homeCommand', 'pin', { component_id: action.componentId });
    if (action.id === ADAPTIVE_ACTIONS.unpin)
      void command('homeCommand', 'unpin', { component_id: action.componentId });
    if (action.id === ADAPTIVE_ACTIONS.feedback)
      void command('homeCommand', 'feedback', {
        component_id: action.componentId,
        value: action.value,
      });
    if (action.id === ADAPTIVE_ACTIONS.noteDraft) {
      clearTimeout(noteTimer);
      noteTimer = setTimeout(
        () =>
          void command('contextCommand', 'note', {
            component_id: action.componentId,
            text: action.draft,
          }),
        500,
      );
    }
  }
  function render(next) {
    if (destroyed || !next) return;
    renderedView = next;
    status.dataset.state = 'quiet';
    status.hidden = true;
    const current = domain(next);
    if (!current) return;
    lastSourceWidgetKey = sourceWidgetKey(next);
    const manualPins = getManualPins() || [];
    const modeKey = JSON.stringify([current.mode, Boolean(current.home_composition), manualPins]);
    if (modeKey !== lastModeKey) {
      shell.dataset.manualPinCount = String(manualPins.length);
      surface.hidden = !current.home_composition || current.mode !== 'adaptive';
    }
    if (current.mode === 'adaptive' && current.home_composition) {
      const key = JSON.stringify(current.home_composition);
      const bindingKey = JSON.stringify([
        lastSourceWidgetKey,
        current.current_work_context?.resources,
      ]);
      const pinsKey = JSON.stringify(current.pins || []);
      if (key !== lastRenderKey) {
        renderer.update(current.home_composition);
        lastRenderKey = key;
        lastPinsKey = '';
      }
      if (bindingKey !== lastBindingKey) {
        renderer.refreshBindings();
        lastBindingKey = bindingKey;
      }
      if (pinsKey !== lastPinsKey) {
        renderer.setPinned(current.pins || []);
        lastPinsKey = pinsKey;
      }
    }
    if (modeKey !== lastModeKey) {
      onModeChange?.(current.mode, Boolean(current.home_composition));
      lastModeKey = modeKey;
    }
  }
  function update(next) {
    // Command revisions and controls always use the latest acknowledged state,
    // even when text selection, a dialog or a drag defers the Home composition.
    view = next;
    const current = domain(next);
    panel.update(current);
    const summary = contextSummary(current);
    const summaryKey = JSON.stringify(summary);
    if (summaryKey !== lastSummaryKey) {
      context.querySelector('.home-context-trigger__state').textContent = summary.label;
      context.dataset.tone = summary.tone;
      context.setAttribute('aria-label', `Home context: ${summary.label}`);
      lastSummaryKey = summaryKey;
    }
    if (
      JSON.stringify(current) === JSON.stringify(domain(renderedView)) &&
      sourceWidgetKey(next) === lastSourceWidgetKey
    )
      return;
    if (unsafe()) {
      pending = next;
      return;
    }
    render(next);
  }
  const flush = () => {
    if (pending && !unsafe()) {
      const next = pending;
      pending = null;
      render(next);
    }
  };
  context.addEventListener('click', () => panel.open(context));
  const unsubscribe = client.subscribe(update);
  const afterFocus = () => queueMicrotask(flush);
  document.addEventListener('focusout', afterFocus, true);
  document.addEventListener('pointerup', afterFocus);
  document.addEventListener('selectionchange', flush);
  document.addEventListener('visibilitychange', flush);
  return {
    update,
    trigger: context,
    destroy() {
      destroyed = true;
      clearTimeout(noteTimer);
      unsubscribe?.();
      renderer.destroy();
      panel.destroy();
      context.remove();
      document.removeEventListener('focusout', afterFocus, true);
      document.removeEventListener('pointerup', afterFocus);
      document.removeEventListener('selectionchange', flush);
      document.removeEventListener('visibilitychange', flush);
      host.replaceChildren();
    },
  };
}

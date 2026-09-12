import { ADAPTIVE_ACTIONS, renderContextWidget } from './renderer.js';
import { normalizeComposition } from './catalog.js';
import { refreshSetupHealth } from '../activity/setup-health.js';
import { selectTracking, selectBrowserUsage } from '../home/tracking-data.js';
import { createContextPanel, contextPolicyPatch, contextSummary } from './context-panel.js';

/** App-wide context controls and content bindings for the ordinary Home widgets. */
export function mountAdaptiveHome({
  client,
  isBusy = () => false,
  onComposition,
  onOpenConnections,
  onOpenActivity,
  onTalk,
  onError,
  settingsHost,
  settingsSections,
  onSettingsSection,
  onOpenSettings,
  onRestoreHome,
} = {}) {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'button home-context-trigger';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML =
    '<span class="home-context-trigger__dot" aria-hidden="true"></span><span>Context</span><span class="home-context-trigger__state"></span><svg aria-hidden="true"><use href="#arrow-right"/></svg>';
  let view = null,
    displayed = null,
    composition = null,
    pending = null,
    lastKey = '',
    destroyed = false;
  const drafts = new Map();
  const noteTimers = new Map();
  const domain = (next) => next?.snapshot?.adaptive || null;
  const panel = createContextPanel({
    host: settingsHost,
    onRestoreHome,
    extraSections: settingsSections,
    onSelectSection: onSettingsSection,
    onCommand: (lane, action, fields) =>
      command(
        lane === 'home' ? 'homeCommand' : 'contextCommand',
        action,
        lane === 'context' && action === 'configure'
          ? contextPolicyPatch(domain(view), fields)
          : fields,
      ),
    onTalk,
    onRefreshSources: () => refreshSetupHealth('desktop', () => client.refresh()),
    onConnections: onOpenConnections,
    onClose: () => flush(),
  });
  async function command(method, action, fields) {
    try {
      await client[method](action, fields, domain(view)?.revision);
      return true;
    } catch (error) {
      const message = error.message || 'That change was not saved. Try again.';
      if (panel.isOpen) panel.showError(message);
      else onError?.(message);
      return false;
    }
  }
  function onAction(action) {
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
    if (action.id === ADAPTIVE_ACTIONS.noteDraft) {
      clearTimeout(noteTimers.get(action.componentId));
      noteTimers.set(
        action.componentId,
        setTimeout(() => {
          noteTimers.delete(action.componentId);
          void command('contextCommand', 'note', {
            component_id: action.componentId,
            text: action.draft,
          });
        }, 500),
      );
    }
  }
  const unsafe = () =>
    document.hidden ||
    isBusy() ||
    document.querySelector('dialog[open]') ||
    document.activeElement?.matches('textarea, input, select, [contenteditable="true"]') ||
    window.getSelection?.()?.toString();
  function render(next) {
    const current = domain(next);
    displayed = next;
    composition = normalizeComposition(current?.home_composition);
    onComposition?.({
      components: composition?.components || [],
      enabled: current?.mode === 'adaptive',
      pins: current?.pins || [],
    });
  }
  function update(next) {
    view = next;
    const current = domain(next);
    panel.update(current);
    const summary = contextSummary(current);
    trigger.querySelector('.home-context-trigger__state').textContent = summary.label;
    trigger.dataset.tone = summary.tone;
    trigger.setAttribute('aria-label', `Context & privacy: ${summary.label}`);
    const key = JSON.stringify([
      current?.mode,
      current?.home_composition,
      current?.pins,
      current?.current_work_context?.resources,
      selectTracking(next),
      selectBrowserUsage(next),
    ]);
    if (key === lastKey) return;
    lastKey = key;
    if (unsafe()) pending = next;
    else render(next);
  }
  function flush() {
    if (destroyed || !pending || unsafe()) return;
    const next = pending;
    pending = null;
    render(next);
  }
  const afterFocus = () => queueMicrotask(flush);
  trigger.addEventListener('click', () => {
    if (onOpenSettings) onOpenSettings('sources');
    else panel.open(trigger);
  });
  const unsubscribe = client.subscribe(update);
  document.addEventListener('focusout', afterFocus, true);
  document.addEventListener('pointerup', afterFocus);
  document.addEventListener('selectionchange', flush);
  document.addEventListener('visibilitychange', flush);
  return {
    trigger,
    flush,
    open: (opener) => (onOpenSettings ? onOpenSettings('sources') : panel.open(opener)),
    selectSettings: (id) => panel.selectSection(id),
    hideSettings: () => panel.hide(),
    components: () => composition?.components || [],
    component: (widget) => composition?.components.find((item) => item.id === widget.componentId),
    renderWidget(widget, container, preview = false) {
      const component = this.component(widget);
      if (!component) return false;
      renderContextWidget(container, component, {
        drafts: preview ? new Map() : drafts,
        onAction: preview ? () => {} : onAction,
        getBinding: (binding, item) => {
          if (['usage', 'connections'].includes(item.kind)) return { widgetView: displayed };
          const resource = domain(displayed)?.current_work_context?.resources?.find(
            (entry) => entry.id === binding.id,
          );
          return resource ? [resource] : undefined;
        },
      });
      return true;
    },
    setPinned: (componentId, pinned) =>
      command('homeCommand', pinned ? 'pin' : 'unpin', { component_id: componentId }),
    destroy() {
      destroyed = true;
      for (const timer of noteTimers.values()) clearTimeout(timer);
      unsubscribe?.();
      panel.destroy();
      document.removeEventListener('focusout', afterFocus, true);
      document.removeEventListener('pointerup', afterFocus);
      document.removeEventListener('selectionchange', flush);
      document.removeEventListener('visibilitychange', flush);
    },
  };
}

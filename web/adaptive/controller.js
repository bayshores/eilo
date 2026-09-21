import { refreshSetupHealth } from '../activity/setup-health.js';
import { createContextPanel, contextPolicyPatch } from './context-panel.js';

/**
 * Keeps the Settings permission surfaces synchronized with the local service.
 * Home presentation is owned by the unified workspace and has no layout mode.
 */
export function mountSettingsController({
  client,
  onOpenConnections,
  onError,
  settingsHost,
  settingsSections,
  onSettingsSection,
} = {}) {
  let view = null;
  const domain = (next) => next?.snapshot?.adaptive || null;

  const panel = createContextPanel({
    host: settingsHost,
    extraSections: settingsSections,
    onSelectSection: onSettingsSection,
    onCommand: async (lane, action, fields) => {
      if (lane !== 'context') return false;
      try {
        const current = domain(view);
        await client.contextCommand(
          action,
          action === 'configure' ? contextPolicyPatch(current, fields) : fields,
          current?.revision,
        );
        return true;
      } catch (error) {
        const message = error.message || 'That change was not saved. Try again.';
        panel.showError(message);
        onError?.(message);
        return false;
      }
    },
    onRefreshSources: () => refreshSetupHealth('desktop', () => client.refresh()),
    onConnections: onOpenConnections,
  });

  const unsubscribe = client.subscribe((next) => {
    view = next;
    panel.update(domain(next));
  });

  return {
    selectSettings: (id) => panel.selectSection(id),
    hideSettings: () => panel.hide(),
    destroy() {
      unsubscribe?.();
      panel.destroy();
    },
  };
}

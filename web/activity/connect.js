import { createHomeClient } from '/home/chat/client.js';
import { mountChromeSetup } from '/home/activity/setup.js';
import { refreshSetupHealth } from '/home/activity/setup-health.js';
import '/home/adaptive/dependencies.js';
import '/home/styles/focus.js';

const client = createHomeClient({ storage: null });
const returnToDesktop = new URLSearchParams(location.search).get('client') === 'desktop';
if (returnToDesktop) document.querySelector('.back-link').remove();
const guide = mountChromeSetup(document.querySelector('[data-chrome-setup]'), {
  returnToDesktop,
  onRefresh: () => refreshSetupHealth('browser', () => client.refresh()),
  onNativeControl: (action) => {
    const policy = client.view?.snapshot?.adaptive?.policy;
    if (!policy) throw new Error('Open felis on this Mac, then try again.');
    return client.contextCommand('configure', {
      ...policy,
      ...(action === 'resume'
        ? { enabled: true }
        : action === 'connect'
          ? { enabled: true, browser_enabled: true }
          : { browser_enabled: false }),
    });
  },
});
const unsubscribe = client.subscribe((view) => guide.update(view));
void client.start();
window.addEventListener('pagehide', () => {
  guide.destroy();
  unsubscribe();
  client.stop();
});

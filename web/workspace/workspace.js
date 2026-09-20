import { mountCalendarConnection } from '../connections/calendar.js';
import { calendarAgenda, calendarTime } from '../calendar/agenda.js';
import { createLiveWidgetRenderer, widgetFingerprint } from '../home/live-widgets.js';
import { createWorkspaceViews } from './views.js';
import { createHomeClient } from '../chat/client.js';
import { createActivitySession } from '../activity/session.js';
import { mountChromeSetup } from '../activity/setup.js';
import { refreshSetupHealth } from '../activity/setup-health.js';
import { createLiveUpdates } from '../chat/live-updates.js';
import { mountSpeechInput } from '../speech/input.js';
import { mountSpeechOutput } from '../speech/output.js';
import {
  loadWorkflowDismissals,
  mountWorkflowProgress,
  rememberWorkflowDismissal,
} from '../chat/workflow-progress.js';
import { mountBriefingSources } from '../connections/briefing-sources.js';
import { mountConnectionsManager } from '../connections/manager.js';
import { mountAccount } from '../connections/account.js';
import { mountChatLibrary } from '../chat/library.js';
import { localCommand, commandMatches } from '../chat/commands.js';
import { mountChatContext } from '../chat/context.js';
import { homeData, progressText, conversationEntries, notificationEntry } from '../home/data.js';
import { createWorkspaceRouter } from './router.js';
import { mountOrb, orbState } from '../orb/presence.js';
import { mountOnboarding } from '../onboarding/onboarding.js';
import { createInterfaceSound } from '../onboarding/sound.js';
import { mountUnifiedWorkspace } from '../home/unified-workspace.js';
import { selectTracking, recordingSummary } from '../home/tracking-data.js';

const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const action = (label, handler, className = 'text-button') => {
  const button = node('button', className, label);
  button.type = 'button';
  button.addEventListener('click', handler);
  return button;
};

export function createLiveHome({
  openDetail,
  refreshWidgets,
  dialog,
  onViewChange = () => {},
  onSettingsSection = () => {},
  applyWorkspace = () => true,
  getSoundEnabled = () => true,
  getPreferences = () => ({ dailyGuidance: true, soundVolume: 0.5 }),
  setSoundEnabled = () => false,
}) {
  let storage = null;
  try {
    storage = localStorage;
    const draftKey = 'eilo:home:conversation-draft:v1';
    if (!storage.getItem(draftKey) && sessionStorage.getItem(draftKey))
      storage.setItem(draftKey, sessionStorage.getItem(draftKey));
    sessionStorage.removeItem(draftKey);
  } catch {
    /* In-page drafts still work. */
  }
  const client = createHomeClient({ storage });
  const presentationKey = 'eilo:workspace-presentation:v1';
  let savedPresentation = null;
  try {
    savedPresentation = JSON.parse(storage?.getItem(presentationKey) || 'null');
  } catch {
    /* A fresh view is safe. */
  }
  let restorePresentation = true;
  const talkPositions = new Map();
  let workspaceFocus = null;
  let historyOpen = false;
  let presentedChatId = null;
  function rememberPresentation() {
    if (!current.snapshot?.workspace?.active_chat_id) return;
    const id = current.snapshot.workspace.active_chat_id;
    const input = dock.querySelector('.live-input');
    const log = dock.querySelector('.live-messages');
    const previous = talkPositions.get(id) || {};
    const position = {
      draft: input?.value || '',
      start: input?.selectionStart || 0,
      end: input?.selectionEnd || 0,
      direction: input?.selectionDirection || 'none',
      scroll: log?.getClientRects().length ? log.scrollTop : previous.scroll || 0,
    };
    talkPositions.set(id, position);
    try {
      storage?.setItem(
        presentationKey,
        JSON.stringify({
          page: currentPage,
          open: threadOpen,
          chat: current.snapshot.workspace.active_chat_id,
          ...position,
        }),
      );
    } catch {
      /* The active view remains usable. */
    }
  }
  let unified = null;
  let onboarding = null,
    chatContext = null;
  let current = client.view,
    fingerprint = '',
    messageFingerprint = '',
    detailFingerprint = '',
    speech = null,
    speechOutput = null,
    speechState = 'idle';
  const sound = createInterfaceSound({
    enabled: getSoundEnabled,
    muted: () => speechState !== 'idle' || speechOutput?.speaking === true,
    volume: () => getPreferences().soundVolume,
  });
  const orbElement = node('span', 'agent-orb');
  let presence = null;
  const activity = createActivitySession(client);
  const dock = node('section', 'conversation-dock');
  dock.setAttribute('aria-label', 'Talk to eïlo');
  dock.dataset.open = 'false';
  document.querySelector('.workspace').append(dock);
  const talkEntry = action(
    '',
    () => (threadOpen ? setThreadOpen(false) : talk()),
    'nav-item talk-entry',
  );
  talkEntry.dataset.detail = 'talk';
  talkEntry.setAttribute('aria-label', 'Talk to eïlo');
  talkEntry.setAttribute('aria-pressed', 'false');
  const talkOrb = node('span', 'talk-entry-orb');
  talkEntry.append(talkOrb);
  let threadOpen = false,
    desktopNotice = '';
  let stopDesktop = null,
    calendarPanel = null,
    browserPanel = null,
    briefingSourcesPanel = null,
    workflowPanel = null;
  let dismissedWorkflowRunIds = new Set(loadWorkflowDismissals(storage));
  const workflowHost = node('div', 'workflow-progress-host');
  workflowHost.hidden = true;
  dock.append(workflowHost);
  dialog.addEventListener('close', () => {
    browserPanel?.destroy();
    browserPanel = null;
    calendarPanel?.destroy();
    calendarPanel = null;
    briefingSourcesPanel?.destroy();
    briefingSourcesPanel = null;
  });
  const updates = createLiveUpdates({
    openConversation: () => talk(),
    container: document.querySelector('.app-window'),
    isConversationOpen: () => threadOpen,
  });
  const workspace = document.querySelector('.workspace'),
    board = document.querySelector('.board-scroll');
  const pages = node('div', 'workspace-page');
  pages.hidden = true;
  board.after(pages);
  const header = document.querySelector('.home-header h1');
  const talkActions = node('div', 'talk-actions');
  talkActions.hidden = true;
  const historyToggle = action(
    'History',
    () => setHistoryOpen(!historyOpen),
    'button talk-history-toggle',
  );
  historyToggle.setAttribute('aria-expanded', 'false');
  historyToggle.setAttribute('aria-controls', 'talk-history');
  const returnWorkspace = action('Workspace', () => setThreadOpen(false), 'button talk-return');
  talkActions.append(historyToggle, returnWorkspace);
  document.querySelector('.header-actions').append(talkActions);
  workspace.addEventListener('focusin', (event) => {
    if (!threadOpen && (board.contains(event.target) || pages.contains(event.target)))
      workspaceFocus = event.target;
  });
  const accountHost = node('div', 'account-host');
  mountAccount(accountHost, { client });
  const accountShortcut = action(
    'Connect ChatGPT',
    () => showPage('settings', { settingsSection: 'account' }),
    'button primary account-shortcut',
  );
  accountShortcut.hidden = true;
  document.querySelector('.header-actions').prepend(accountShortcut);
  client.subscribe((next) => {
    const state = next.snapshot?.account?.state;
    accountShortcut.hidden = !state || ['connected', 'unknown'].includes(state);
  });

  const connectionStatuses = node('div', 'connection-statuses');
  connectionStatuses.setAttribute('role', 'group');
  connectionStatuses.setAttribute('aria-label', 'Connection statuses');
  const statusButtons = new Map();
  for (const [id, label, icon] of [
    ['desktop', 'Desktop', 'status-desktop'],
    ['browser', 'Browser', 'status-browser'],
    ['calendar', 'Calendar', 'status-calendar'],
    ['gmail', 'Gmail', 'status-gmail'],
  ]) {
    const button = action(
      '',
      () => showPage('settings', { settingsSection: 'sources' }),
      'connection-status',
    );
    button.innerHTML = `<svg aria-hidden="true"><use href="#${icon}"></use></svg>`;
    button.dataset.connection = id;
    button.dataset.label = label;
    statusButtons.set(id, button);
    connectionStatuses.append(button);
  }
  workspace.append(connectionStatuses);
  function updateConnectionStatuses() {
    const tracking = selectTracking(current);
    connectionStatuses.title = recordingSummary(current);
    const rows = new Map(tracking.rows.map((row) => [row.id, row]));
    for (const [id, button] of statusButtons) {
      const row = rows.get(id) || {
        name: button.dataset.label,
        status: 'Unavailable',
        detail: '',
        tone: 'attention',
      };
      const summary = `${row.name}: ${row.status}${row.detail ? `. ${row.detail}` : ''}`;
      button.dataset.tone = row.tone;
      button.title = summary;
      button.setAttribute('aria-label', `${summary}. Manage connection`);
    }
  }

  header.tabIndex = -1;
  let currentPage = 'home';
  let connectionsPanel = null,
    libraryPanel = null,
    connectionsRevision = null,
    commandsHidden = false;
  const browserGuides = new Set();
  function mountBrowserGuide(host) {
    const guide = mountChromeSetup(host, {
      onRefresh: () => refreshSetupHealth('browser', () => client.refresh()),
      onDone: () => showPage('connections'),
      onDismiss: () => {
        if (dialog.open) dialog.close();
        else showPage('connections');
      },
      onNativeControl: (action) =>
        client.contextCommand('configure', {
          ...current.snapshot.adaptive.policy,
          ...(action === 'resume'
            ? { enabled: true }
            : action === 'connect'
              ? { enabled: true, browser_enabled: true }
              : { browser_enabled: false }),
        }),
    });
    browserGuides.add(guide);
    guide.update(current);
    return {
      update: guide.update,
      refresh: guide.refresh,
      destroy() {
        browserGuides.delete(guide);
        guide.destroy();
      },
    };
  }
  const views = createWorkspaceViews({
    container: pages,
    pageHeader: pages,
    onDiscuss: (text) => talk(text),
    onConnections: () => openDetail('connections'),
    onActivity: () => showPage('activity'),
    onManage: async (operations, revision, context) => {
      sound.prepare();
      const result = await client.controlTasks(operations, revision, context);
      sound.play(operations.some((item) => item.op === 'complete') ? 'completed' : 'confirmed');
      return result;
    },
    onRecord: (action, id, revision, context) =>
      client.controlRecord(action, id, revision, context),
    canManage: () => client.canManage(),
    onReply: (message) => talk(`About your check-in “${message.text}”: `),
    onCheckinToggle: (enabled) =>
      client.activityControl(enabled ? 'enable_check_ins' : 'pause_check_ins', crypto.randomUUID()),
    onActivitySetup: () => openDetail('browser-setup'),
    onContextCommand: (action, fields) => client.contextCommand(action, fields),
    onRecordingToggle: async () => {
      const policy = current.snapshot?.adaptive?.policy;
      const adaptiveConfigured = Boolean(policy?.desktop_enabled || policy?.browser_enabled);
      const legacyState = current.snapshot?.accountability?.activity?.state;
      const active = (adaptiveConfigured && policy?.enabled === true) || legacyState === 'active';
      const available =
        current.connection === 'connected' &&
        (adaptiveConfigured || ['active', 'paused'].includes(legacyState));
      if (!available) return;
      const shouldResume = !active;
      sound.prepare();
      if (adaptiveConfigured && policy.enabled !== shouldResume)
        await client.contextCommand('configure', { ...policy, enabled: shouldResume });
      if (legacyState === (shouldResume ? 'paused' : 'active'))
        await activity.control(shouldResume ? 'enable' : 'pause');
      sound.play('confirmed');
    },
  });
  const settingsHost = node('div', 'settings-page');
  settingsHost.hidden = true;
  const accountSection = node('section', 'settings-account');
  const accountStatus = node('p', 'settings-account-status');
  accountSection.append(node('h2', '', 'ChatGPT account'), accountStatus, accountHost);
  client.subscribe((next) => {
    accountStatus.textContent =
      next.snapshot?.account?.state === 'connected'
        ? 'Connected. eïlo uses your ChatGPT account for conversations.'
        : next.snapshot?.account?.state === 'unknown'
          ? 'Account status is unavailable. Reconnect to the local service to check it.'
          : 'Connect your account to talk with eïlo.';
  });
  const connectionsHost = node('div', 'connections-page'),
    libraryHost = node('div', 'library-page');
  connectionsHost.hidden = false;
  libraryHost.hidden = true;
  libraryHost.id = 'talk-history';
  libraryHost.classList.add('talk-history');
  libraryHost.setAttribute('aria-label', 'Conversation history');
  pages.append(settingsHost);
  dock.append(libraryHost);
  const compactHistory = matchMedia('(max-width: 1000px)');
  function syncHistoryLayout() {
    const chat = dock.querySelector('.live-chat');
    if (!chat) return;
    const hidden = threadOpen && historyOpen && (currentPage === 'home' || compactHistory.matches);
    const hadFocus = chat.contains(document.activeElement);
    chat.inert = hidden;
    if (hidden && hadFocus) libraryHost.querySelector('input')?.focus({ preventScroll: true });
  }
  compactHistory.addEventListener('change', syncHistoryLayout);
  function setHistoryOpen(open, { focus = true } = {}) {
    const inline = dock.querySelector('.inline-surface[open]');
    if (inline) {
      if (!inline.dispatchEvent(new Event('cancel', { cancelable: true }))) return;
      inline.close();
    }
    rememberPresentation();
    historyOpen = open;
    libraryHost.hidden = !open;
    dock.classList.toggle('history-open', open);
    historyToggle.setAttribute('aria-expanded', String(open));
    if (open) ensureLibrary();
    syncHistoryLayout();
    if (focus)
      (open ? libraryHost.querySelector('input') : historyToggle)?.focus({ preventScroll: true });
  }
  function ensureConnections() {
    if (!connectionsPanel)
      connectionsPanel = mountConnectionsManager(connectionsHost, {
        embeddedPermissions: true,
        mountCalendar: (host, options) => {
          const connection = node('div'),
            sharing = node('div');
          host.append(connection, sharing);
          const calendar = mountCalendarConnection(connection, options);
          const consent = mountBriefingSources(sharing, { ...options, section: 'calendar' });
          return {
            destroy() {
              calendar.destroy();
              consent.destroy();
            },
          };
        },
        mountBriefingSources: (host, options) =>
          mountBriefingSources(host, { ...options, section: 'gmail' }),
        openGoogleAuthorization,
        openBriefingAuthorization,
        onActivitySetup: () => openDetail('browser-setup'),
        mountActivitySetup: (host) => mountBrowserGuide(host),
        onChanged: (next) => {
          connectionsRevision = next.revision;
          client.refresh();
        },
      });
    else connectionsPanel.refresh({ quiet: true });
  }
  function ensureLibrary() {
    if (!libraryPanel)
      libraryPanel = mountChatLibrary(libraryHost, {
        canManage: () => client.canManage(),
        onChanged: (next) => client.acceptWorkspace(next),
        onActivate: () => {
          messageFingerprint = '';
          if (historyOpen) setHistoryOpen(false, { focus: false });
          talk();
        },
      });
    libraryPanel.update(current.snapshot);
    libraryPanel.show();
  }
  const inspector = node('dialog', 'workspace-inspector');
  inspector.id = 'workspace-inspector';
  inspector.setAttribute('aria-labelledby', 'workspace-inspector-title');
  const inspectorHeader = node('header', 'workspace-inspector-header');
  const inspectorTitle = node('h2', '', '');
  inspectorTitle.id = 'workspace-inspector-title';
  inspectorTitle.tabIndex = -1;
  let inspectorReturnFocus = null;
  let inspectorDockOpen = false;
  const closeInspector = () => {
    const restore = inspectorReturnFocus;
    const open = inspectorDockOpen;
    showPage('home');
    setThreadOpen(open, { focus: false });
    if (restore?.isConnected && restore.getClientRects().length)
      restore.focus({ preventScroll: true });
  };
  inspectorHeader.append(inspectorTitle, action('Close', closeInspector, 'button'));
  inspector.append(inspectorHeader);
  workspace.append(inspector);
  inspector.addEventListener('cancel', (event) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    closeInspector();
  });
  const settingsBack = action('Back to Home', () => showPage('home'), 'button workspace-back');
  settingsBack.hidden = true;
  document.querySelector('.header-actions').prepend(settingsBack);
  let homeThreadOpen = threadOpen;
  let returningHome = false;
  const router = createWorkspaceRouter({
    onPageChange: (page) => {
      returningHome = page === 'home' && currentPage !== 'home';
      if (currentPage === 'home' && !inspector.open) homeThreadOpen = threadOpen;
      if (['goals', 'activity'].includes(page) && !inspector.open) {
        inspectorReturnFocus = document.activeElement;
        inspectorDockOpen = threadOpen;
      }
      if (inspector.open) inspector.close();
      onViewChange(page);
      if (['settings', 'connections'].includes(page)) {
        speech?.cancel();
        speechOutput?.stop();
      }
      if (dialog.open) dialog.close();
      setThreadOpen(false, { focus: false });
      if (!['chats', 'projects'].includes(page))
        currentPage = ['goals', 'activity'].includes(page) ? 'home' : page;
      rememberPresentation();
    },
    renderPage: (
      page,
      {
        goalFilter,
        goalId,
        editGoal,
        connectionsTab,
        activityTab,
        settingsSection,
        connectionId,
      } = {},
    ) => {
      if (['chats', 'projects'].includes(page)) {
        setThreadOpen(true, { focus: false });
        setHistoryOpen(true);
        return;
      }
      const inspecting = ['goals', 'activity'].includes(page);
      const homePage = inspecting ? 'home' : page;
      settingsBack.hidden = !['settings', 'connections'].includes(page);
      if (inspecting) inspector.append(pages);
      else board.after(pages);
      workspace.dataset.page = homePage;
      board.hidden = page !== 'home';
      pages.hidden = page === 'home';
      views.show(page, { goalFilter, goalId, editGoal, activityTab });
      settingsHost.hidden = !['settings', 'connections'].includes(page);
      if (page === 'connections' || page === 'settings') {
        onSettingsSection(settingsSection || (page === 'connections' ? 'connections' : 'general'));
        if (connectionsTab || connectionId) {
          ensureConnections();
          connectionsPanel.show({
            tab: connectionsTab || 'apps',
            id: connectionId === 'activity' ? 'browser-activity' : connectionId,
          });
        }
      }
      document.querySelector('.home-header').hidden = false;
      onboarding?.update(current, homePage);
      unified?.update(current, homePage, threadOpen);
      if (returningHome) setThreadOpen(homeThreadOpen, { focus: false });
      if (inspecting) {
        router.updateNavigation('home');
        unified?.update(current, 'home', threadOpen);
        inspectorTitle.textContent = page === 'goals' ? 'Your goals' : 'Activity';
        inspector.dataset.view = page;
        inspector.showModal();
        queueMicrotask(() => {
          if (inspector.open) inspectorTitle.focus();
        });
      }
    },
  });
  function showPage(page, options) {
    if (['chats', 'projects'].includes(page)) {
      talk();
      setHistoryOpen(true);
      return page;
    }
    return router.showPage(page, options);
  }

  async function runCommand(text) {
    const command = localCommand(text);
    if (!command) {
      desktopNotice = 'Unknown shortcut. Type / to see available commands.';
      renderConversation(dock);
      return;
    }
    if (command.command === '/new' && !client.canManage()) {
      desktopNotice = 'Wait for this reply before starting a new chat.';
      renderConversation(dock);
      return;
    }
    const previousDraft = current.draft;
    client.setDraft('');
    commandsHidden = true;
    desktopNotice = '';
    try {
      if (command.command === '/help') {
        commandsHidden = false;
        client.setDraft('/');
        dock.querySelector('.live-input')?.focus();
      } else if (['context', 'compress', 'usage'].includes(command.command.slice(1))) {
        const mode = command.command.slice(1);
        chatContext?.open(mode === 'compress' ? 'context' : mode);
      } else if (command.page)
        showPage(command.page, { connectionsTab: command.command === '/mcp' ? 'mcps' : 'all' });
      else {
        await client.controlCatalog('new_chat');
        messageFingerprint = '';
        showPage('home');
        talk();
      }
    } catch (error) {
      client.setDraft(previousDraft);
      desktopNotice = error.message;
    }
    renderConversation(dock);
  }
  function renderCommands() {
    const host = dock.querySelector('.local-commands');
    if (!host) return;
    const items = commandMatches(current.draft);
    host.hidden = commandsHidden || !items.length;
    const signature = JSON.stringify(items);
    if (host.dataset.signature === signature) return;
    host.dataset.signature = signature;
    host.replaceChildren();
    for (const item of items) {
      const choice = action('', () => runCommand(item.command), 'local-command');
      choice.append(node('strong', '', item.command), node('span', '', item.label));
      host.append(choice);
    }
  }

  function placeOrb() {
    const target = workspace.classList.contains('unified-home')
      ? dock.querySelector('.unified-presence')
      : threadOpen
        ? onboarding?.active
          ? workspace.querySelector('.onboarding-orb')
          : dock.querySelector('.conversation-presence')
        : talkOrb;
    if (!target) {
      orbElement.remove();
      presence?.pause(true);
      return;
    }
    if (orbElement.parentNode !== target) target.prepend(orbElement);
    if (!presence) presence = mountOrb(orbElement);
    presence.pause(false);
    presence.update({ state: orbState(current, speechState, speechOutput?.speaking === true) });
  }

  function setThreadOpen(open, { focus = true } = {}) {
    const wasOpen = threadOpen;
    if (wasOpen && !open) {
      rememberPresentation();
      speech?.cancel();
      speechOutput?.stop();
    }
    threadOpen = open;
    dock.dataset.open = String(open);
    workspace.classList.toggle('conversation-active', open);
    talkActions.hidden = !open || currentPage === 'home';
    talkEntry.setAttribute('aria-pressed', String(open));
    returnWorkspace.setAttribute(
      'aria-label',
      `Return to ${currentPage === 'connections' ? 'Settings' : currentPage[0].toUpperCase() + currentPage.slice(1)}`,
    );
    router.updateNavigation(currentPage, { talking: open && currentPage !== 'home' });
    syncHistoryLayout();
    const thread = dock.querySelector('.conversation-thread');
    const toggle = dock.querySelector('.dock-history');
    if (thread) thread.hidden = !open;
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.querySelector('.dock-history-label').textContent = open ? 'Hide replies' : 'Replies';
      toggle.setAttribute('aria-label', open ? 'Hide replies' : 'Show replies');
      toggle.title = open ? 'Hide replies' : 'Show replies';
    }
    if (open && (!wasOpen || presentedChatId !== current.snapshot?.workspace?.active_chat_id)) {
      presentedChatId = current.snapshot?.workspace?.active_chat_id;
      const input = dock.querySelector('.live-input');
      const saved =
        talkPositions.get(current.snapshot?.workspace?.active_chat_id) || savedPresentation;
      if (input && saved?.draft === input.value)
        input.setSelectionRange(saved.start || 0, saved.end || 0, saved.direction || 'none');
      if (focus) {
        if (historyOpen && compactHistory.matches)
          libraryHost.querySelector('input')?.focus({ preventScroll: true });
        else input?.focus({ preventScroll: true });
      }
      const log = dock.querySelector('.live-messages');
      if (log)
        requestAnimationFrame(() => {
          log.scrollTop = saved?.scroll ?? log.scrollHeight;
        });
    }
    if (!open && wasOpen && focus) {
      if (workspaceFocus?.isConnected && workspaceFocus.getClientRects().length)
        workspaceFocus.focus({ preventScroll: true });
      else header.focus({ preventScroll: true });
    }
    rememberPresentation();
    unified?.update(current, currentPage, open);
    placeOrb();
    if (current.snapshot) updates.update(current);
  }
  const data = () => homeData(current.snapshot);
  function talk(text) {
    if (inspector.open) closeInspector();
    if (typeof text === 'string' && text && !current.draft) client.setDraft(text);
    if (dialog.open) dialog.close();
    setThreadOpen(true);
    dock.querySelector('.live-input')?.focus();
  }
  const openGoogleAuthorization = async (url) => {
    if (window.eiloDesktop?.openGoogleAuthorization)
      return window.eiloDesktop.openGoogleAuthorization(url);
    const target = new URL(url);
    if (target.origin !== 'https://accounts.google.com' || target.pathname !== '/o/oauth2/v2/auth')
      return false;
    return !!window.open(url, '_blank', 'noopener,noreferrer');
  };
  const openBriefingAuthorization = async (url) => {
    if (window.eiloDesktop?.openBriefingAuthorization)
      return window.eiloDesktop.openBriefingAuthorization(url);
    return openGoogleAuthorization(url);
  };
  const openBriefingSource = async (run, source) => {
    const url = new URL(source.url);
    if (
      url.protocol !== 'https:' ||
      !['https://mail.google.com', 'https://calendar.google.com'].includes(url.origin)
    )
      return true;
    if (window.eiloDesktop?.openBriefingSource)
      return window.eiloDesktop.openBriefingSource(run.id, source.id);
    return false;
  };
  const clearWorkflow = () => {
    workflowPanel?.destroy();
    workflowPanel = null;
    workflowHost.hidden = true;
  };
  const cancelWorkflow = async (run) => {
    try {
      const response = await fetch('/api/workflow/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Eilo-Client': 'local-chat' },
        body: JSON.stringify({ request_id: run.id }),
      });
      if (!response.ok) throw new Error('Briefing cancellation could not be confirmed.');
      await client.refresh();
    } catch (error) {
      desktopNotice = error.message || 'Briefing cancellation could not be confirmed.';
      renderConversation(dock);
    }
  };
  function renderWorkflow(run) {
    if (!run || dismissedWorkflowRunIds.has(run.id)) {
      clearWorkflow();
      return;
    }
    if (!workflowPanel)
      workflowPanel = mountWorkflowProgress(workflowHost, {
        onCancel: cancelWorkflow,
        onConnect: () => openDetail('connections'),
        onOpenSource: openBriefingSource,
        onDismiss: (finished) => {
          if (
            ['completed', 'partial', 'failed', 'cancelled', 'interrupted'].includes(finished.status)
          ) {
            dismissedWorkflowRunIds = new Set(
              rememberWorkflowDismissal(storage, [...dismissedWorkflowRunIds], finished.id),
            );
            clearWorkflow();
          }
        },
      });
    workflowHost.hidden = false;
    workflowPanel.update(run);
  }
  const liveWidgets = createLiveWidgetRenderer({
    getCurrent: () => current,
    getData: data,
    talk,
    openDetail,
  });
  const { renderBody, taskRow, miniMessage } = liveWidgets;
  function renderConversation(body) {
    if (!body.querySelector('.live-chat')) {
      messageFingerprint = '';
      const chat = node('div', 'live-chat');
      const thread = node('div', 'conversation-thread');
      thread.id = 'eilo-conversation-thread';
      thread.hidden = !threadOpen;
      const log = node('div', 'live-messages');
      log.setAttribute('role', 'log');
      log.setAttribute('aria-label', 'Conversation');
      log.setAttribute('aria-live', 'polite');
      log.tabIndex = 0;
      log.addEventListener('scroll', rememberPresentation, { passive: true });
      thread.append(node('div', 'conversation-presence'), log);
      const form = node('form', 'live-composer');
      const label = node('label', 'sr-only', 'Message eïlo');
      label.htmlFor = 'live-message-input';
      const input = node('textarea', 'live-input');
      input.id = label.htmlFor;
      input.placeholder = 'Tell eïlo what’s on your mind…';
      input.maxLength = 12000;
      input.rows = 1;
      input.addEventListener('select', rememberPresentation);
      input.addEventListener('blur', rememberPresentation);
      const fitInput = () => {
        input.style.height = 'auto';
        input.style.height = Math.min(100, Math.max(28, input.scrollHeight)) + 'px';
      };
      input.addEventListener('input', () => {
        commandsHidden = false;
        fitInput();
        client.setDraft(input.value);
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' && !commands.hidden) {
          event.preventDefault();
          commands.querySelector('button')?.focus();
        }
        if (event.key === 'Escape' && !commands.hidden) {
          event.preventDefault();
          commandsHidden = true;
          renderCommands();
        }
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          form.requestSubmit();
        }
      });
      const footer = node('div', 'live-composer-footer');
      footer.append(node('span', 'live-chat-status'));
      const send = node('button', 'button primary live-send', 'Send');
      send.type = 'submit';
      footer.append(send);
      const commands = node('div', 'local-commands');
      commands.hidden = true;
      commands.setAttribute('role', 'group');
      commands.setAttribute('aria-label', 'Chat shortcuts');
      commands.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          commandsHidden = true;
          renderCommands();
          input.focus();
        }
      });
      form.append(commands, label, input, footer);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (current.draft.trim().startsWith('/')) {
          void runCommand(current.draft);
          return;
        }
        if (onboarding && !onboarding.prepareSend()) return;
        if (!client.canSend()) return;
        setThreadOpen(true);
        sound.prepare();
        unified?.dismiss();
        void client.send().then(() => {
          if (!client.view.error && client.view.localPending?.status !== 'unconfirmed')
            sound.play('sent');
        });
      });
      const status = node('p', 'live-chat-error');
      status.setAttribute('role', 'status');
      status.hidden = true;
      const controls = node('div', 'live-recovery');
      controls.append(
        status,
        action('Check connection', () => client.refresh(), 'button live-retry'),
        action('Recover saved reply', () => client.recover(), 'button live-recover'),
        action('Return to draft', () => client.returnToDraft(), 'button live-return-draft'),
      );
      chat.append(thread, form, controls);
      body.append(chat);
      speech = mountSpeechInput(form, client, {
        onSignal({ state, amplitude }) {
          speechState = state;
          sound.sync?.();
          presence?.update({
            state: orbState(current, speechState, speechOutput?.speaking === true),
            amplitude,
          });
        },
      });
      speechOutput = mountSpeechOutput(form, {
        getPreferences,
        isVisible: () =>
          threadOpen &&
          currentPage === 'home' &&
          document.visibilityState === 'visible' &&
          (typeof document.hasFocus !== 'function' || document.hasFocus()),
        onState: () => {
          sound.sync?.();
          placeOrb();
        },
      });
      chatContext = mountChatContext(form.querySelector('.speech-actions'), { client });
      const toggle = action('', () => setThreadOpen(!threadOpen), 'dock-history');
      toggle.setAttribute('aria-controls', thread.id);
      toggle.setAttribute('aria-expanded', String(threadOpen));
      toggle.innerHTML = '<span class="dock-history-label">Replies</span>';
      toggle.setAttribute('aria-label', 'Show replies');
      toggle.title = 'Show replies';
      const helpStart = action(
        'Help me start',
        () => {
          const goal = data().focus;
          talk(
            goal
              ? 'Help me start “' + goal.title + '”. Help me find one small first step.'
              : 'Help me choose one small thing to start. Suggest a first step; let me decide.',
          );
        },
        'text-button help-start',
      );
      form.querySelector('.speech-actions').prepend(toggle, helpStart);
      body.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && threadOpen && !event.defaultPrevented && !event.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          if (historyOpen) setHistoryOpen(false);
          else setThreadOpen(false);
        }
      });
    }
    const entries = conversationEntries(current.snapshot, current.localPending);
    const liveReply = current.snapshot?.reply_stream;
    const liveCheckIn = current.snapshot?.accountability?.check_in_stream;
    const streamEntry =
      liveReply?.status === 'writing' && liveReply.text
        ? { id: 'preview-' + liveReply.id, role: 'assistant', text: liveReply.text, preview: true }
        : liveCheckIn?.status === 'writing' && liveCheckIn.text
          ? {
              id: 'preview-event-' + liveCheckIn.id,
              role: 'assistant',
              text: liveCheckIn.text,
              origin: 'check_in',
              preview: true,
            }
          : null;
    const log = body.querySelector('.live-messages');
    const nextFingerprint = JSON.stringify(entries);
    if (messageFingerprint !== nextFingerprint) {
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 70;
      const oldScroll = log.scrollTop;
      log.replaceChildren();
      if (!entries.length) {
        const empty = node('div', 'conversation-empty-state');
        empty.append(node('p', 'live-empty', 'What’s getting in the way?'));
        log.append(empty);
      }
      entries.forEach((entry) => log.append(miniMessage(entry)));
      if (!messageFingerprint || atBottom) log.scrollTop = log.scrollHeight;
      else log.scrollTop = oldScroll;
      messageFingerprint = nextFingerprint;
    }
    const priorPreview = log.querySelector('.live-writing-preview');
    if (streamEntry) {
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 70;
      if (priorPreview) priorPreview.querySelector('p').textContent = streamEntry.text;
      else log.append(miniMessage(streamEntry));
      if (atBottom) log.scrollTop = log.scrollHeight;
    } else priorPreview?.remove();
    placeOrb();
    const input = body.querySelector('.live-input');
    if (input.value !== current.draft) {
      input.value = current.draft;
      input.style.height = 'auto';
      input.style.height = Math.min(100, Math.max(28, input.scrollHeight)) + 'px';
    }
    const command = localCommand(current.draft);
    body.querySelector('.live-send').disabled = command
      ? command.command === '/new' && !client.canManage()
      : !client.canSend();
    body.querySelector('.live-send').textContent = command ? 'Open' : 'Send';
    body.querySelector('.live-send').setAttribute('aria-label', command ? 'Open command' : 'Send');
    renderCommands();
    const busy = current.snapshot?.status === 'busy';
    body
      .querySelector('.live-chat-status')
      .classList.toggle('is-idle', !busy && !current.sending && current.connection === 'connected');
    body.querySelector('.live-chat-status').textContent = current.sending
      ? 'Sending…'
      : busy
        ? current.snapshot?.chat_context?.status === 'compressing'
          ? 'Summarizing older messages…'
          : 'eïlo is replying…'
        : current.connection === 'loading'
          ? 'Connecting…'
          : current.connection === 'offline'
            ? 'Reconnecting…'
            : 'Enter to send · Shift + Enter for a new line';
    body
      .querySelector('.live-chat')
      .classList.toggle('is-offline', current.connection === 'offline');
    const unconfirmed = current.localPending?.status === 'unconfirmed';
    const status = body.querySelector('.live-chat-error');
    status.textContent =
      desktopNotice ||
      (unconfirmed
        ? 'Delivery could not be confirmed. Check the conversation before sending again.'
        : current.connection === 'offline'
          ? 'Connection lost. Your draft is kept.'
          : current.error || current.snapshot?.error || '');
    status.hidden = !status.textContent;
    body.querySelector('.live-retry').hidden = current.connection === 'connected' && !unconfirmed;
    body.querySelector('.live-retry').disabled = current.sending;
    body.querySelector('.live-recover').hidden = !current.snapshot?.recovery_pending;
    body.querySelector('.live-recover').disabled =
      busy || current.sending || current.connection !== 'connected';
    body.querySelector('.live-return-draft').hidden = !unconfirmed;
    body.querySelector('.live-return-draft').disabled =
      busy || current.sending || current.connection !== 'connected';
  }
  function renderDetail(type, title, body) {
    if (!['today', 'goals', 'progress', 'activity', 'browser-setup', 'calendar-day'].includes(type))
      return false;
    title.textContent = {
      today: 'Your commitments',
      goals: 'Your goals',
      progress: 'Your progress',
      conversation: 'eïlo',
      activity: 'Conversation updates',
      connections: 'Connections & privacy',
    }[type];
    if (type === 'browser-setup' && body.querySelector('.chrome-setup')) {
      title.textContent = 'Set up Chrome activity';
      browserPanel?.update(current);
      return true;
    }
    browserPanel?.destroy();
    browserPanel = null;
    calendarPanel?.destroy();
    calendarPanel = null;
    briefingSourcesPanel?.destroy();
    briefingSourcesPanel = null;
    body.replaceChildren();
    const value = data();
    if (!value.supported) {
      body.append(
        node('p', '', 'Waiting for your local workspace.'),
        action('Check connection', () => client.refresh(), 'button'),
      );
      return true;
    }
    if (type === 'browser-setup') {
      title.textContent = 'Set up Chrome activity';
      const chromeBody = node('div');
      body.append(chromeBody);
      browserPanel = mountBrowserGuide(chromeBody);
    } else if (type === 'calendar-day') {
      title.textContent = 'Your day';
      const calendar = current.snapshot.integrations?.google_calendar,
        events = calendarAgenda(calendar);
      body.append(
        node(
          'p',
          'muted',
          calendar?.state === 'paused'
            ? 'Calendar sync is paused. These are your last synced events.'
            : 'Upcoming events from your selected calendars.',
        ),
      );
      const list = node('div', 'calendar-day-list');
      events.forEach((event) => {
        const row = node('div', 'calendar-day-event');
        row.append(
          node('span', '', calendarTime(event)),
          node('strong', '', event.title),
          node('small', 'muted', event.calendar_name),
        );
        list.append(row);
      });
      if (!events.length) list.append(node('p', '', 'No more calendar events today.'));
      body.append(
        list,
        action('Calendar connection', () => openDetail('connections'), 'button'),
      );
    } else if (type === 'activity') {
      title.textContent = 'Observed activity';
      const journal = current.snapshot.accountability?.observed_activity,
        sessions = journal?.recent_sessions || [];
      body.append(
        node(
          'p',
          'muted',
          'A record of approved browser activity. Observed time does not establish attention or task completion.',
        ),
      );
      if (!sessions.length)
        body.append(
          node(
            'p',
            'live-empty',
            'No activity recorded yet. Connect an approved source to let eïlo build this view automatically.',
          ),
          action('Connections & privacy', () => openDetail('connections'), 'button'),
        );
      const list = node('div', 'observed-sessions');
      [...sessions]
        .reverse()
        .slice(0, 20)
        .forEach((session) => {
          const item = node('div', 'observed-session'),
            minutes = Math.floor(session.observed_seconds / 60),
            duration = minutes
              ? `${minutes} min observed`
              : `${Math.floor(session.observed_seconds)} sec observed`;
          item.append(
            node('strong', '', new URL(session.origin).hostname),
            node(
              'p',
              '',
              `${duration} · ${new Date(session.start * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${session.end === null ? ' · ongoing' : ''}`,
            ),
          );
          if (session.related_task_revision === current.snapshot.tasks.revision) {
            const names = (session.related_task_ids || [])
              .map((id) => value.tasks.find((task) => task.id === id)?.title)
              .filter(Boolean);
            if (names.length) item.append(node('p', '', `May relate to ${names.join(', ')}`));
          }
          list.append(item);
        });
      body.append(
        list,
        action('Open conversation', () => talk(), 'button live-bottom'),
      );
    } else {
      const tasks =
        type === 'today'
          ? value.open
          : type === 'progress'
            ? value.tasks.filter(
                (task) =>
                  task.status === 'completed' || (task.status === 'open' && progressText(task)),
              )
            : value.tasks;
      body.append(
        node(
          'p',
          'muted',
          value.onBreak
            ? 'You are on a break. Your commitments are kept.'
            : type === 'progress'
              ? 'Saved progress across your commitments.'
              : 'Tell eïlo when something changes. It keeps this view in sync.',
        ),
      );
      const list = node('div', 'live-detail-tasks');
      tasks.forEach((task) => list.append(taskRow(task, { focus: task.id === value.focus?.id })));
      if (!tasks.length)
        list.append(
          node(
            'p',
            'live-empty',
            type === 'progress' ? 'No progress recorded yet.' : 'No saved commitments here yet.',
          ),
        );
      body.append(
        list,
        action('Talk to eïlo', () => talk(), 'button live-bottom'),
      );
    }
    return true;
  }
  function start() {
    document.title = 'eïlo — Home';
    document.querySelector('.app-window').setAttribute('aria-label', 'eïlo Home');
    document.querySelector('.account-name span').textContent = 'Local profile';
    for (const item of document.querySelectorAll('.nav-item')) {
      if (['today', 'progress'].includes(item.dataset.detail)) {
        item.remove();
        continue;
      }
      const name = { home: 'Home', goals: 'Goals', activity: 'Activity' }[item.dataset.detail];
      item.setAttribute('aria-label', name);
      item.title = name;
      item.append(node('span', 'nav-label', name));
    }
    for (const [page, label, icon] of [['settings', 'Settings', 'sliders']]) {
      const item = action('', () => showPage(page), 'nav-item');
      item.dataset.detail = page;
      item.setAttribute('aria-label', page === 'chats' ? 'Chats and projects' : label);
      item.title = page === 'chats' ? 'Chats and projects' : label;
      item.innerHTML = `<svg aria-hidden="true"><use href="#${icon}"/></svg>`;
      item.append(node('span', 'nav-label', label));
      document.querySelector('.nav-items').append(item);
    }
    document.querySelector('.nav-items').append(talkEntry);
    renderConversation(dock);
    onboarding = mountOnboarding({
      client,
      dock,
      workspace,
      setThreadOpen,
      applyWorkspace,
      getSoundEnabled,
      setSoundEnabled,
      soundController: sound,
      onStarted: (goal) => {
        unified?.dismiss();
        if (!current.draft) {
          talk('Help me start “' + goal + '”. Help me find one small first step.');
          if (client.canSend()) void client.send();
        } else talk();
      },
      isRecording: () => speechState !== 'idle',
      openAccount: () => accountHost.querySelector('.account-connect')?.click(),
      openSettings: (section = 'general') => showPage('settings', { settingsSection: section }),
    });
    // A different modal must never hide an active microphone control.
    const modalCapture = new MutationObserver(() => {
      if (document.querySelector('dialog[open]')) speech?.cancel();
    });
    document
      .querySelectorAll('dialog')
      .forEach((element) =>
        modalCapture.observe(element, { attributes: true, attributeFilter: ['open'] }),
      );
    const headline = document.querySelector('.home-header p');
    headline.setAttribute('role', 'status');
    const context = node('div', 'home-context');
    headline.before(context);
    context.append(headline);
    client.subscribe((next) => {
      if (next.snapshot?.workspace?.active_chat_id !== current.snapshot?.workspace?.active_chat_id)
        rememberPresentation();
      current = next;
      activity.update(next);
      updateConnectionStatuses();
      for (const guide of browserGuides) guide.update(next);
      updates.update(next);
      views.update(next);
      libraryPanel?.update(next.snapshot);
      if (
        ['settings', 'connections'].includes(currentPage) &&
        next.snapshot?.connections_revision !== connectionsRevision
      ) {
        connectionsRevision = next.snapshot?.connections_revision;
        connectionsPanel?.refresh({ quiet: true });
      }
      const value = data();
      headline.textContent =
        next.connection === 'loading'
          ? 'Connecting to your workspace…'
          : next.connection === 'offline'
            ? 'Reconnecting · saved state shown'
            : next.snapshot?.recovery_pending
              ? 'A saved reply needs recovery'
              : next.snapshot?.status === 'error'
                ? 'Conversation needs attention'
                : value.onBreak
                  ? 'On a break'
                  : '';
      context.hidden = !headline.textContent;
      renderWorkflow(next.snapshot?.workflow_run ?? null);
      const nextFingerprint = widgetFingerprint(next);
      if (nextFingerprint !== fingerprint) {
        fingerprint = nextFingerprint;
        refreshWidgets();
      }
      renderConversation(dock);
      onboarding?.update(next, currentPage);
      unified?.update(next, currentPage, threadOpen);
      speechOutput?.update(next);
      placeOrb();
      if (restorePresentation && next.snapshot) {
        restorePresentation = false;
        if (
          savedPresentation?.chat === next.snapshot.workspace?.active_chat_id &&
          savedPresentation.open === true &&
          !onboarding?.active
        ) {
          setThreadOpen(true, { focus: false });
          const log = dock.querySelector('.live-messages');
          if (Number.isFinite(savedPresentation.scroll) && savedPresentation.scroll >= 0)
            log.scrollTop = savedPresentation.scroll;
        }
        savedPresentation = null;
      }
      if (
        dialog.open &&
        ['today', 'goals', 'progress', 'activity', 'browser-setup', 'calendar-day'].includes(
          dialog.dataset.detail,
        ) &&
        detailFingerprint !== nextFingerprint
      ) {
        detailFingerprint = nextFingerprint;
        const body = dialog.querySelector('.detail-body'),
          top = dialog.scrollTop;
        renderDetail(dialog.dataset.detail, dialog.querySelector('#detail-title'), body);
        dialog.scrollTop = top;
      }
    });
    unified = mountUnifiedWorkspace({
      workspace,
      dock,
      client,
      getPreferences,
      storage,
      setOpen: setThreadOpen,
      isOpen: () => threadOpen,
      talk,
      showPage,
      openCalendar: () => openDetail('calendar-day'),
      onHistory: () => {
        setThreadOpen(true, { focus: false });
        setHistoryOpen(!historyOpen);
      },
    });
    unified.update(current, currentPage);
    router.start();
    const connectDesktop = () => {
      stopDesktop = window.eiloDesktop?.onOpenCheckIn(async (target) => {
        await client.refresh();
        const entry = notificationEntry(current.snapshot, target);
        desktopNotice = entry ? '' : 'This check-in is no longer in the current conversation.';
        if (dialog.open) dialog.close();
        setThreadOpen(true);
        renderConversation(dock);
        requestAnimationFrame(() => {
          const row =
            entry &&
            [...dock.querySelectorAll('.live-snippet')].find(
              (item) => item.dataset.messageId === entry.id,
            );
          if (row) {
            row.tabIndex = -1;
            row.focus({ preventScroll: true });
            row.scrollIntoView({ block: 'nearest', behavior: 'instant' });
          }
        });
      });
    };
    connectDesktop();
    client.start();
    window.addEventListener('pagehide', (event) => {
      if (event.persisted) presence?.pause(true);
      else {
        presence?.destroy();
        presence = null;
        onboarding?.destroy();
        unified?.destroy();
        sound.destroy();
        speechOutput?.destroy();
      }
      calendarPanel?.destroy();
      calendarPanel = null;
      briefingSourcesPanel?.destroy();
      briefingSourcesPanel = null;
      clearWorkflow();
      speech?.cancel();
      client.stop();
      stopDesktop?.();
      router.dispose();
    });
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        placeOrb();
        presence?.pause(false);
        connectDesktop();
        client.start();
        router.start();
      }
    });
  }
  return {
    client,
    sound,
    refreshPreferences() {
      sound.sync?.();
      speechOutput?.sync();
      unified?.refresh();
      updateConnectionStatuses();
    },
    settingsHost,
    settingsSections: [
      { id: 'connections', label: 'Connections', element: connectionsHost },
      { id: 'account', label: 'Account', element: accountSection },
    ],
    settingsSectionSelected(id) {
      if (['connections', 'sources'].includes(id)) {
        ensureConnections();
        connectionsPanel.show({ tab: 'apps' });
      }
    },
    renderBody,
    renderDetail,
    start,
    showPage,
    focusConversation: talk,
    ownsConversationFocus: () => dock.contains(document.activeElement),
  };
}

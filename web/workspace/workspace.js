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
import { mountWorkflowProgress } from '../chat/workflow-progress.js';
import { mountBriefingSources } from '../connections/briefing-sources.js';
import { mountConnectionsManager } from '../connections/manager.js';
import { mountAccount } from '../connections/account.js';
import { mountChatLibrary } from '../chat/library.js';
import { mountChatSwitcher } from '../chat/switcher.js';
import { localCommand, commandMatches } from '../chat/commands.js';
import { homeData, progressText, conversationEntries, notificationEntry } from '../home/data.js';
import { checkinView } from '../activity/checkin-data.js';
import { createWorkspaceRouter } from './router.js';

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
}) {
  let storage = null;
  try {
    storage = sessionStorage;
  } catch {
    /* In-page drafts still work. */
  }
  const client = createHomeClient({ storage });
  let current = client.view,
    fingerprint = '',
    messageFingerprint = '',
    detailFingerprint = '',
    speech = null;
  const activity = createActivitySession(client);
  const dock = node('section', 'conversation-dock');
  dock.setAttribute('aria-label', 'Talk to eïlo');
  dock.dataset.open = 'false';
  document.querySelector('.workspace').append(dock);
  let threadOpen = false,
    desktopNotice = '';
  let stopDesktop = null,
    calendarPanel = null,
    browserPanel = null,
    briefingSourcesPanel = null,
    workflowPanel = null;
  let dismissedWorkflowRunId = '';
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
    container: dock,
    isConversationOpen: () => threadOpen,
  });
  const workspace = document.querySelector('.workspace'),
    board = document.querySelector('.board-scroll');
  const pages = node('div', 'workspace-page');
  pages.hidden = true;
  board.after(pages);
  const header = document.querySelector('.home-header h1');
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

  header.tabIndex = -1;
  let currentPage = 'home';
  let connectionsPanel = null,
    libraryPanel = null,
    quickChats = null,
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
    onDiscuss: (text) => talk(text),
    onConnections: () => openDetail('connections'),
    onActivity: () => showPage('activity'),
    onManage: (operations, revision, context) => client.controlTasks(operations, revision, context),
    onRecord: (action, id, revision, context) =>
      client.controlRecord(action, id, revision, context),
    canManage: () => client.canManage(),
    onReply: (message) => talk(`About your check-in “${message.text}”: `),
    onCheckinToggle: (enabled) =>
      client.activityControl(enabled ? 'enable_check_ins' : 'pause_check_ins', crypto.randomUUID()),
    onActivitySetup: () => openDetail('browser-setup'),
    onContextCommand: (action, fields) => client.contextCommand(action, fields),
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
  pages.append(settingsHost, libraryHost);
  function ensureConnections() {
    if (!connectionsPanel)
      connectionsPanel = mountConnectionsManager(connectionsHost, {
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
          showPage('home');
          talk();
        },
      });
    libraryPanel.update(current.snapshot);
    libraryPanel.show();
  }
  const router = createWorkspaceRouter({
    onPageChange: (page) => {
      onViewChange(page);
      if (['settings', 'connections'].includes(page)) speech?.cancel();
      if (dialog.open) dialog.close();
      setThreadOpen(false);
      currentPage = page;
    },
    renderPage: (
      page,
      { goalFilter, connectionsTab, activityTab, settingsSection, connectionId } = {},
    ) => {
      workspace.dataset.page = page;
      board.hidden = page !== 'home';
      pages.hidden = page === 'home';
      views.show(page, { goalFilter, activityTab });
      settingsHost.hidden = !['settings', 'connections'].includes(page);
      libraryHost.hidden = !['chats', 'projects'].includes(page);
      if (page === 'connections' || page === 'settings') {
        onSettingsSection(settingsSection || (page === 'connections' ? 'connections' : 'general'));
        if (connectionsTab || connectionId) {
          ensureConnections();
          connectionsPanel.show({ tab: connectionsTab || 'apps', id: connectionId });
        }
      }
      if (['chats', 'projects'].includes(page)) ensureLibrary();
      document.querySelector('.home-header').hidden = ['chats', 'projects'].includes(page);
    },
  });
  function showPage(page, options) {
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
      if (command.page)
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

  function setThreadOpen(open) {
    const wasOpen = threadOpen;
    threadOpen = open;
    dock.dataset.open = String(open);
    workspace.classList.toggle('conversation-active', open);
    const back = dock.querySelector('.conversation-back');
    if (back)
      back.textContent = `← Back to ${currentPage === 'home' ? 'Home' : currentPage[0].toUpperCase() + currentPage.slice(1)}`;
    const thread = dock.querySelector('.conversation-thread');
    const toggle = dock.querySelector('.dock-history');
    if (thread) thread.hidden = !open;
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.querySelector('span').textContent = open ? 'Hide replies' : 'Replies';
      toggle.setAttribute('aria-label', open ? 'Hide replies' : 'Show replies');
      toggle.title = open ? 'Hide replies' : 'Show replies';
    }
    if (open && !wasOpen) {
      dock.querySelector('.live-input')?.focus();
      const log = dock.querySelector('.live-messages');
      if (log)
        requestAnimationFrame(() => {
          log.scrollTop = log.scrollHeight;
        });
    }
    if (current.snapshot) updates.update(current);
  }
  const data = () => homeData(current.snapshot);
  function talk(text) {
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
    if (!run || dismissedWorkflowRunId === run.id) {
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
            dismissedWorkflowRunId = finished.id;
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
      const close = action('← Back', () => setThreadOpen(false), 'conversation-back');
      close.addEventListener('click', () => input.focus());
      const context = node('div', 'conversation-context');
      context.append(node('span', 'conversation-context-mark', 'eïlo'));
      context.append(node('span', 'conversation-context-label', 'Conversation'));
      thread.append(close, context, log);
      const form = node('form', 'live-composer');
      const label = node('label', 'sr-only', 'Message eïlo');
      label.htmlFor = 'live-message-input';
      const input = node('textarea', 'live-input');
      input.id = label.htmlFor;
      input.placeholder = 'Tell eïlo what’s on your mind…';
      input.maxLength = 12000;
      input.rows = 1;
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
        if (!client.canSend()) return;
        setThreadOpen(true);
        client.send();
      });
      const status = node('p', 'live-chat-error');
      status.setAttribute('role', 'status');
      status.hidden = true;
      const controls = node('div', 'live-recovery');
      controls.append(
        action('Check connection', () => client.refresh(), 'button live-retry'),
        action('Recover saved reply', () => client.recover(), 'button live-recover'),
        action('Return to draft', () => client.returnToDraft(), 'button live-return-draft'),
      );
      chat.append(thread, form, status, controls);
      body.append(chat);
      speech = mountSpeechInput(form, client);
      const toggle = action('', () => setThreadOpen(!threadOpen), 'dock-history');
      toggle.setAttribute('aria-controls', thread.id);
      toggle.setAttribute('aria-expanded', String(threadOpen));
      toggle.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10h8M8 14h5M21 11a9 9 0 0 1-9 9 10 10 0 0 1-4-1l-5 2 2-5a9 9 0 1 1 16-5Z"/></svg><span>Replies</span>';
      toggle.setAttribute('aria-label', 'Show replies');
      toggle.title = 'Show replies';
      form.querySelector('.speech-actions').prepend(toggle);
      quickChats = mountChatSwitcher(form.querySelector('.speech-actions'), {
        canManage: () => client.canManage(),
        onBrowse: () => showPage('chats'),
        onSwitch: async (chatId) => {
          await client.controlCatalog('switch_chat', { chat_id: chatId });
          messageFingerprint = '';
          talk();
        },
        onNew: async () => {
          await client.controlCatalog('new_chat');
          messageFingerprint = '';
          talk();
        },
      });
      body.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && threadOpen && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          setThreadOpen(false);
          input.focus();
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
        const orb = node('span', 'conversation-empty-orb');
        orb.setAttribute('aria-hidden', 'true');
        empty.append(orb, node('p', 'live-empty', 'What matters right now?'));
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
    renderCommands();
    quickChats?.update(current.snapshot);
    const busy = current.snapshot?.status === 'busy';
    body
      .querySelector('.live-chat-status')
      .classList.toggle('is-idle', !busy && !current.sending && current.connection === 'connected');
    body.querySelector('.live-chat-status').textContent = current.sending
      ? 'Sending…'
      : busy
        ? 'eïlo is replying…'
        : current.connection === 'loading'
          ? 'Connecting…'
          : current.connection === 'offline'
            ? 'Reconnecting…'
            : 'Enter to send · Shift + Enter for a new line';
    const unconfirmed = current.localPending?.status === 'unconfirmed';
    const status = body.querySelector('.live-chat-error');
    status.textContent =
      desktopNotice ||
      current.error ||
      (unconfirmed
        ? 'Delivery could not be confirmed. Check the conversation before sending again.'
        : current.snapshot?.error || '');
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
    for (const [page, label, icon] of [
      ['chats', 'Chats', 'chat'],
      ['settings', 'Settings', 'sliders'],
    ]) {
      const item = action('', () => showPage(page), 'nav-item');
      item.dataset.detail = page;
      item.setAttribute('aria-label', page === 'chats' ? 'Chats and projects' : 'Settings');
      item.title = page === 'chats' ? 'Chats and projects' : 'Settings';
      item.innerHTML = `<svg aria-hidden="true"><use href="#${icon}"/></svg>`;
      item.append(node('span', 'nav-label', label));
      document.querySelector('.nav-items').append(item);
    }
    renderConversation(dock);
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
    const activityButton = action(
      'Check-in status',
      () => showPage('activity', { activityTab: 'overview' }),
      'activity-chip agent-status-chip',
    );
    context.append(activityButton);
    client.subscribe((next) => {
      current = next;
      activity.update(next);
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
      const checkins = checkinView(next);
      activityButton.textContent = checkins.chip;
      activityButton.dataset.tone = checkins.tone;
      activityButton.setAttribute('aria-label', `${checkins.chip}. Open check-in status`);
      activityButton.title = checkins.description;
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
                  : `${value.open.length} open commitment${value.open.length === 1 ? '' : 's'}`;
      renderWorkflow(next.snapshot?.workflow_run ?? null);
      const nextFingerprint = widgetFingerprint(next);
      if (nextFingerprint !== fingerprint) {
        fingerprint = nextFingerprint;
        refreshWidgets();
      }
      renderConversation(dock);
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
    window.addEventListener('pagehide', () => {
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
        connectDesktop();
        client.start();
        router.start();
      }
    });
  }
  return {
    client,
    settingsHost,
    settingsSections: [
      { id: 'connections', label: 'Connections', element: connectionsHost },
      { id: 'account', label: 'Account', element: accountSection },
    ],
    settingsSectionSelected(id) {
      if (id === 'connections') {
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

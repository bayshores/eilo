import { createInterfaceSound } from './sound.js';
import { mountOnboardingSupport } from './support.js';

const el = (tag, className, value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
};
const button = (label, className, handler) => {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
};
const requestId = () => globalThis.crypto?.randomUUID?.() || 'onboarding-' + Date.now();
const activeGoals = (proposal) =>
  (proposal?.tasks || []).filter(
    (task) => !['completed', 'cancelled', 'deleted'].includes(task.status),
  );
const progress = (task) =>
  Number.isFinite(task?.target_count) && task.target_count > 0
    ? `${Number.isFinite(task.completed_count) ? task.completed_count : 0} of ${task.target_count}${task.unit ? ' ' + task.unit : ''}`
    : '';
const signature = (value) => JSON.stringify(value || null);

/** A temporary Home arrangement that uses the existing conversation dock. */
export function mountOnboarding({
  client,
  dock,
  workspace,
  setThreadOpen,
  openAccount,
  openSettings,
  applyWorkspace,
  getSoundEnabled = () => true,
  soundController = null,
  onStarted = () => {},
  setSoundEnabled = () => {},
  isRecording = () => false,
}) {
  const shell = el('section', 'onboarding-shell');
  shell.hidden = true;
  shell.setAttribute('aria-label', 'Set up your felis workspace');
  const top = el('header', 'onboarding-top');
  const actions = el('div', 'onboarding-top-actions');
  const soundToggle = button('Sound off', 'onboarding-sound', () => {
    const enabled = !getSoundEnabled();
    setSoundEnabled(enabled);
    soundToggle.textContent = enabled ? 'Sound on' : 'Sound off';
    soundToggle.setAttribute('aria-pressed', String(enabled));
    if (enabled) {
      sound.prepare();
      sound.play('ready');
    } else sound.stop();
  });
  const skip = button('Skip setup', 'text-button onboarding-skip', () => void command('skip'));
  actions.append(soundToggle, skip);
  top.append(el('span', 'onboarding-mark', 'felis'), actions);
  const columns = el('div', 'onboarding-columns');
  const chat = el('section', 'onboarding-chat');
  const intro = el('div', 'onboarding-intro');
  const title = el('h1', '', 'What would you like help getting started on?');
  const examples = el('div', 'onboarding-examples');
  const unsure = button('I’m not sure yet', 'text-button onboarding-unsure', () =>
    setDraft('I’m not sure yet. Help me choose one thing to start with.'),
  );
  [
    ['Coding practice', 'Solve 100 LeetCode problems in three months.'],
    ['A creative project', 'Finish my portfolio before recruiting starts.'],
    ['Studying', 'Make steady progress on my biology course this quarter.'],
  ].forEach(([label, example]) =>
    examples.append(button(label, 'onboarding-example', () => setDraft(example))),
  );
  const stale = el('p', 'onboarding-stale');
  const welcomeOrb = el('span', 'onboarding-orb');
  welcomeOrb.setAttribute('aria-hidden', 'true');
  intro.append(welcomeOrb, title, stale);
  examples.append(unsure);
  const readinessRow = el('div', 'onboarding-readiness');
  readinessRow.id = 'onboarding-readiness';
  const readinessText = el('p');
  const readinessAction = button('', 'text-button', () => {
    if (readinessAction.dataset.action === 'refresh') client.refresh();
    else openAccount();
  });
  readinessRow.append(readinessText, readinessAction);
  const preview = el('aside', 'onboarding-preview');
  preview.setAttribute('aria-live', 'polite');
  chat.append(readinessRow, intro, examples);
  columns.append(chat, preview);
  shell.append(top, columns);
  workspace.append(shell);

  const originalParent = dock.parentElement;
  const originalNext = dock.nextSibling;
  const invitation = el('aside', 'onboarding-support-invitation');
  invitation.hidden = true;
  originalParent?.insertBefore(invitation, originalNext);
  let view,
    page = 'home',
    mounted = false,
    pendingAccept,
    commandBusy = false,
    commandError = '',
    previewFingerprint = '',
    invitationFingerprint = '',
    appliedRevision = null;
  const sound =
    soundController || createInterfaceSound({ enabled: getSoundEnabled, muted: isRecording });
  const support = mountOnboardingSupport({
    client,
    openSettings,
    onConfirmed: () => sound.play('confirmed'),
    onDismiss: () => void command('dismiss_support'),
    onFinish: () => void command('finish_support'),
  });
  const account = () => view?.snapshot?.account?.state;
  const blocked = () => {
    const snapshot = view?.snapshot;
    return Boolean(
      commandBusy ||
      view?.sending ||
      view?.changing ||
      view?.localPending ||
      snapshot?.status === 'busy' ||
      snapshot?.recovery_pending ||
      snapshot?.error ||
      view?.error,
    );
  };
  const canAccept = (onboarding) =>
    onboarding?.status === 'proposed' && account() === 'connected' && !blocked();
  function setDraft(value) {
    client.setDraft(value);
    requestAnimationFrame(() => dock.querySelector('.live-input')?.focus());
  }
  function moveDock(active) {
    if (active && dock.parentElement !== chat) chat.insertBefore(dock, examples);
    if (!active && dock.parentElement !== originalParent)
      originalParent?.insertBefore(
        dock,
        invitation.parentElement === originalParent ? invitation : originalNext,
      );
  }
  function readiness() {
    const snapshot = view?.snapshot;
    if (commandError) return [commandError];
    if (view?.connection === 'offline' || !snapshot)
      return [
        'Your local workspace is unavailable. Your draft is still here.',
        'Check connection',
        'refresh',
      ];
    if (account() === 'unknown')
      return ['Account status is unavailable.', 'Check connection', 'refresh'];
    if (account() !== 'connected')
      return ['Connect ChatGPT to talk with felis.', 'Connect ChatGPT', 'account'];
    if (view?.sending || view?.changing || snapshot.status === 'busy')
      return ['felis is updating your workspace.'];
    if (snapshot.recovery_pending)
      return ['A saved reply needs recovery before this workspace can be approved.'];
    return null;
  }
  function renderReadiness() {
    const current = readiness();
    readinessRow.hidden = !current;
    if (!current) return;
    readinessText.textContent = current[0];
    readinessAction.hidden = !current[1];
    if (current[1]) {
      readinessAction.textContent = current[1];
      readinessAction.dataset.action = current[2];
    }
  }
  function card(name, value) {
    const node = el('section', 'onboarding-preview-card onboarding-preview-' + name);
    node.append(el('h3', '', name === 'today' ? 'Today' : name[0].toUpperCase() + name.slice(1)));
    if (value) node.append(el('p', '', value));
    return node;
  }
  function renderPreview(onboarding) {
    const tasks = activeGoals(onboarding?.proposal);

    const fingerprint = signature({
      revision: onboarding?.revision,
      status: onboarding?.status,
      tasks,
      focus: onboarding?.proposal?.focus_id,
      canAccept: canAccept(onboarding),
    });
    if (fingerprint === previewFingerprint) return;
    previewFingerprint = fingerprint;
    preview.replaceChildren();
    if (!tasks.length) {
      preview.append(el('p', 'onboarding-preview-empty', 'Your workspace will take shape here.'));
      return;
    }
    const cards = el('div', 'onboarding-preview-cards');
    const focus = tasks.find((task) => task.id === onboarding.proposal.focus_id) || tasks[0];
    const goalCard = card('today');
    goalCard.querySelector('h3').textContent = 'Your goal';
    goalCard.append(el('p', 'onboarding-goal-title', focus.title));
    const detail = [focus.due_text, progress(focus)].filter(Boolean).join(' · ');
    if (detail) goalCard.append(el('p', 'context-caption', detail));
    goalCard.append(
      el('p', '', 'felis will help you find one small first step. You can change it as you go.'),
    );
    cards.append(goalCard);
    const accept = button(
      'Save goal & start',
      'button primary onboarding-accept',
      () => void acceptWorkspace(),
    );
    accept.disabled = !canAccept(onboarding);
    if (accept.disabled) accept.setAttribute('aria-describedby', 'onboarding-readiness');
    preview.append(cards, accept);
  }
  function renderInvitation(onboarding) {
    const show =
      page === 'home' &&
      !workspace.classList.contains('conversation-active') &&
      onboarding?.status === 'complete' &&
      onboarding.support_status === 'pending';
    const fingerprint = signature({
      show,
      source: onboarding?.support_source,
      commandBusy,
      commandError,
    });
    if (fingerprint === invitationFingerprint) return;
    invitationFingerprint = fingerprint;
    invitation.hidden = !show;
    if (!show) return;
    const source = onboarding.support_source;
    invitation.replaceChildren(
      button('Connect optional support', 'button onboarding-support-open', () => {
        sound.prepare();
        support.open(source);
      }),
      button(
        'Later',
        'text-button onboarding-support-later',
        () => void command('dismiss_support'),
      ),
    );
    for (const control of invitation.querySelectorAll('button')) control.disabled = commandBusy;
    if (commandError) {
      const error = el('p', 'onboarding-support-error', commandError);
      error.setAttribute('role', 'alert');
      invitation.append(error);
    }
  }
  function command(action) {
    if (!view || commandBusy) return Promise.resolve(null);
    commandError = '';
    commandBusy = true;
    render();
    return client
      .onboardingCommand(action, requestId(), view.snapshot?.onboarding?.revision)
      .then((next) => {
        if (next?.onboarding) {
          applyWorkspace(next.onboarding);
          requestAnimationFrame(() => {
            if (page === 'home') dock.querySelector('.live-input')?.focus({ preventScroll: true });
          });
        }
        return next;
      })
      .catch((error) => {
        commandError = error?.message || 'That change could not be confirmed. Try again.';
        return null;
      })
      .finally(() => {
        commandBusy = false;
        render();
      });
  }
  function acceptWorkspace() {
    const onboarding = view?.snapshot?.onboarding;
    if (!canAccept(onboarding)) return;
    sound.prepare();
    pendingAccept ||= { request: requestId(), revision: onboarding.revision };
    commandError = '';
    commandBusy = true;
    render();
    client
      .onboardingCommand('accept', pendingAccept.request, pendingAccept.revision)
      .then((next) => {
        if (next?.onboarding) applyWorkspace(next.onboarding);
        if (next?.onboarding?.status === 'complete') {
          sound.play('workspace');
          requestAnimationFrame(() => {
            if (page === 'home') dock.querySelector('.live-input')?.focus({ preventScroll: true });
          });
          pendingAccept = null;
          const goals = activeGoals(next.onboarding.proposal);
          onStarted(
            goals.find((goal) => goal.id === next.onboarding.proposal?.focus_id)?.title ||
              goals[0]?.title ||
              'my goal',
          );
          return;
        }
        pendingAccept = null;
        commandError = 'The workspace changed before approval. Review the current proposal.';
        client.refresh();
      })
      .catch((error) => {
        if (error?.status) {
          pendingAccept = null;
          commandError = error.message || 'The proposal changed. Refreshing it now.';
          client.refresh();
        } else commandError = 'Approval could not be confirmed. Try again with the same workspace.';
      })
      .finally(() => {
        commandBusy = false;
        render();
      });
  }
  function render() {
    const onboarding = view?.snapshot?.onboarding;
    if (onboarding?.status === 'complete' && appliedRevision !== onboarding.revision) {
      appliedRevision = onboarding.revision;
      applyWorkspace(onboarding);
    }
    const nextMounted = page === 'home' && ['draft', 'proposed'].includes(onboarding?.status);
    if (nextMounted !== mounted) {
      mounted = nextMounted;
      shell.hidden = !mounted;
      workspace.classList.toggle('onboarding-active', mounted);
      moveDock(mounted);
      setThreadOpen(mounted);
    }
    soundToggle.textContent = getSoundEnabled() ? 'Sound on' : 'Sound off';
    soundToggle.setAttribute('aria-pressed', String(getSoundEnabled()));
    skip.hidden = !mounted;
    if (mounted) {
      shell.classList.toggle(
        'has-conversation',
        Boolean(
          view?.snapshot?.messages?.length || view?.localPending || view?.snapshot?.pending_message,
        ),
      );
      shell.classList.toggle('has-proposal', Boolean(onboarding?.proposal?.tasks?.length));
      intro.classList.toggle('is-compact', Boolean(onboarding?.proposal?.tasks?.length));
      title.textContent = onboarding?.proposal?.tasks?.length
        ? 'A place to start'
        : 'What would you like help getting started on?';
      stale.hidden = !(onboarding?.status === 'draft' && onboarding?.proposal?.tasks?.length);
      if (!stale.hidden)
        stale.textContent = 'Your earlier workspace is visible while felis updates the plan.';
      renderReadiness();
      renderPreview(onboarding);
    }
    renderInvitation(onboarding);
    support.update(view);
  }
  return {
    update(next, nextPage = 'home') {
      view = next;
      page = nextPage;
      render();
    },
    get active() {
      return mounted;
    },
    prepareSend() {
      if (!mounted || account() === 'connected') return true;
      if (account() === 'unknown') client.refresh();
      else openAccount();
      return false;
    },
    destroy() {
      if (!soundController) sound.destroy();
      support.destroy();
      invitation.remove();
      moveDock(false);
      shell.remove();
      workspace.classList.remove('onboarding-active');
    },
  };
}

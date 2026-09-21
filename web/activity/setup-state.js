/** Setup facts stay separate from permission intent and recorded activity. */
export function browserSetupState({ online, current, extension, step = 0, inChrome = false } = {}) {
  const policy = current?.policy || {};
  const health = current?.capture_status?.browser || {};
  const verified =
    health.connected === true && health.setup_verified === true && health.grant_verified === true;
  if (!online)
    return {
      id: 'offline',
      title: 'Open felis to connect',
      copy: 'Your workspace needs to be running on this Mac.',
      action: 'retry',
      label: 'Try again',
      stage: 0,
    };
  if (health.status === 'error' && policy.enabled && policy.browser_enabled)
    return {
      id: 'error',
      title: 'Chrome needs attention',
      copy: 'felis couldn’t record the latest activity. We’ll try again.',
      action: 'retry',
      label: 'Check status',
      stage: 2,
    };
  if (verified) {
    if (!policy.browser_enabled)
      return {
        id: 'ready',
        title: 'Chrome is ready',
        copy: 'Connect to record website names and page titles on this Mac.',
        action: 'connect',
        label: 'Connect Chrome',
        stage: 2,
      };
    if (!policy.enabled)
      return {
        id: 'paused',
        title: 'Capture is paused',
        copy: 'Your source choices are saved. Resume when you’re ready.',
        action: 'resume',
        label: 'Resume capture',
        stage: 2,
      };
    const received =
      Number.isFinite(health.last_event_at) &&
      health.last_event_at >= (health.last_verified_at || 0);
    return {
      id: 'connected',
      title: 'Chrome connected',
      copy: received
        ? 'Website activity is arriving. You can see it in Activity.'
        : 'Visit a regular website. Its session will appear in Activity.',
      action: 'done',
      label: 'View activity',
      stage: 3,
      received,
    };
  }
  if (
    ['missing', 'invalid'].includes(health.registration) ||
    health.status === 'registration_required'
  )
    return {
      id: 'repair',
      title: 'Reopen felis to connect',
      copy: 'Chrome’s local connection needs to be prepared again.',
      action: 'retry',
      label: 'Check connection',
      stage: 2,
    };
  if (extension?.installed && extension.setup_protocol !== 2)
    return {
      id: 'update',
      title: 'Reload the felis extension once',
      copy: 'felis is already installed. In Chrome’s extensions, find felis and click Reload to use the updated connection flow.',
      action: 'reload',
      label: 'Open Chrome extensions',
      stage: 1,
    };
  if (extension?.installed && !extension.granted)
    return {
      id: 'grant',
      title: 'Allow Chrome access',
      copy: 'Share the active website and page title with felis.',
      action: 'grant',
      label: 'Open permission step',
      stage: 2,
    };
  if (extension?.installed && extension.granted)
    return {
      id: 'pair',
      title: 'Finish the desktop connection',
      copy: 'Chrome access is already allowed. Keep the felis desktop app open while we reconnect.',
      action: !policy.browser_enabled ? 'connect' : !policy.enabled ? 'resume' : 'retry',
      label: !policy.browser_enabled
        ? 'Connect Chrome'
        : !policy.enabled
          ? 'Resume capture'
          : 'Retry connection',
      stage: 2,
    };
  if (health.connected)
    return {
      id: 'pair',
      title: 'Checking the Chrome connection',
      copy: 'The extension has reached felis. Waiting for Chrome access to be verified.',
      action: 'retry',
      label: 'Check connection',
      stage: 2,
    };
  if (!inChrome)
    return {
      id: 'handoff',
      title: 'Connect Chrome',
      copy: 'Continue in Chrome to check your existing extension and finish any missing step.',
      action: 'open',
      label: 'Open Chrome setup',
      stage: 0,
    };
  if (step === 1)
    return {
      id: 'install',
      title: 'Add the felis extension',
      copy: 'Turn on Developer mode, then choose Load unpacked.',
      action: 'folder',
      label: 'Copy extension folder',
      stage: 1,
    };
  if (step >= 2)
    return {
      id: 'finish',
      title: 'Finish connecting in Chrome',
      copy: 'Choose Allow Chrome in the setup tab.',
      action: 'grant',
      label: 'Open Chrome setup',
      stage: 2,
    };
  return {
    id: 'extensions',
    title: 'Add felis to Chrome',
    copy: 'Open Chrome’s extensions page to install the local extension.',
    action: 'extensions',
    label: 'Copy extensions address',
    stage: 0,
  };
}

export function desktopSetupState(current, { text = false } = {}) {
  const policy = current?.policy || {};
  const health = current?.capture_status?.desktop || {};
  if (text && health.permissions?.accessibility_permission !== true)
    return {
      id: 'permission',
      title: 'Let felis read your work',
      copy: 'Allow Accessibility in the macOS prompt. Private browser windows stay protected.',
      action: 'permission',
      label: 'Continue to macOS',
      stage: 1,
    };
  if (!policy.desktop_enabled)
    return {
      id: 'off',
      title: 'Connect your Mac',
      copy: 'Record the app you’re using. Reading text is a separate choice.',
      action: 'connect',
      label: 'Connect desktop',
      stage: 0,
    };
  if (!policy.enabled)
    return {
      id: 'paused',
      title: 'Capture is paused',
      copy: 'Your source choices are saved.',
      action: 'resume',
      label: 'Resume capture',
      stage: 1,
    };
  if (['error', 'unsupported'].includes(health.status))
    return {
      id: 'error',
      title: 'Desktop needs attention',
      copy: 'Check the connection before continuing.',
      action: 'retry',
      label: 'Check again',
      stage: 1,
    };
  if (
    ['ready', 'sampling', 'permission_required'].includes(health.status) ||
    (health.status === 'waiting' && Number.isFinite(health.last_event_at))
  )
    return {
      id: 'connected',
      title: text ? 'Text access is ready' : 'Desktop connected',
      copy: text
        ? 'felis can use text from permitted apps.'
        : 'App sessions will appear in Activity.',
      action: 'done',
      label: 'Done',
      stage: 3,
    };
  return {
    id: 'checking',
    title: 'Connecting your Mac',
    copy: 'Waiting for the desktop helper to respond.',
    action: 'retry',
    label: 'Check again',
    stage: 1,
  };
}

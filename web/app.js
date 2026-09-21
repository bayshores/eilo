import { createInlineDialog } from './workspace/inline-dialog.js';
import './styles/focus.js';
import { createHomeStorage, HOME_STORAGE_KEYS, normalizeHomePreferences } from './home/storage.js';
import { createLiveHome } from './workspace/workspace.js';
import { mountSettingsController } from './adaptive/controller.js';

const detail = document.querySelector('.detail-dialog');
const openInlineDetail = createInlineDialog(detail);
const homeStorage = createHomeStorage();
const storedPreferences = homeStorage.read(HOME_STORAGE_KEYS.preferences, null);
const legacyPreferences =
  storedPreferences === null ? homeStorage.read(HOME_STORAGE_KEYS.legacyPreferences, null) : null;
const preferences = normalizeHomePreferences(storedPreferences ?? legacyPreferences ?? {});
if (legacyPreferences !== null && storedPreferences === null) {
  homeStorage.write(HOME_STORAGE_KEYS.preferences, preferences);
  homeStorage.remove(HOME_STORAGE_KEYS.legacyPreferences);
}
document.body.classList.toggle('reduce-motion', preferences.reducedMotion);

let live = null;
let settings = null;
let detailReturnFocus = null;

function savePreferences() {
  const saved = homeStorage.write(HOME_STORAGE_KEYS.preferences, preferences);
  window.dispatchEvent(new Event('eilo-preferences-changed'));
  live?.refreshPreferences();
  return saved;
}

function showDetail(type) {
  if (type === 'browser-setup') {
    live.showPage('connections', { connectionId: 'activity' });
    return;
  }
  if (['settings', 'profile', 'help'].includes(type)) {
    live.showPage('settings', { settingsSection: 'general' });
    return;
  }
  if (type === 'conversation') {
    live.focusConversation();
    return;
  }
  if (
    ['home', 'goals', 'activity', 'connections', 'settings', 'chats', 'projects'].includes(type)
  ) {
    live.showPage(type);
    return;
  }

  detailReturnFocus = document.activeElement;
  const body = detail.querySelector('.detail-body');
  const title = detail.querySelector('#detail-title');
  body.replaceChildren();
  detail.dataset.detail = type;
  detail.classList.remove('live-conversation-dialog');
  if (live.renderDetail(type, title, body)) openInlineDetail();
}

detail.querySelector('.detail-close').addEventListener('click', () => detail.close());
detail.addEventListener('close', () => {
  if (live?.ownsConversationFocus()) return;
  if (detailReturnFocus?.isConnected && !detailReturnFocus.closest('[hidden]'))
    detailReturnFocus.focus({ preventScroll: true });
});
detail.addEventListener('click', (event) => {
  if (event.target !== detail) return;
  const bounds = detail.getBoundingClientRect();
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    detail.close();
});

function group(title, elements) {
  const section = document.createElement('section');
  section.className = 'settings-group';
  const heading = document.createElement('h3');
  heading.textContent = title;
  section.append(heading, ...elements);
  return section;
}

function option(label, checked, onChange) {
  const row = document.createElement('label');
  row.className = 'check-option';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  row.append(input, document.createTextNode(label));
  return { row, input };
}

function createGeneralSettings() {
  const section = document.createElement('section');
  section.className = 'general-settings';

  const motion = option('Reduce motion', preferences.reducedMotion, (checked) => {
    preferences.reducedMotion = checked;
    document.body.classList.toggle('reduce-motion', checked);
    savePreferences();
  });
  const guidance = option('Daily welcome-back briefing', preferences.dailyGuidance, (checked) => {
    preferences.dailyGuidance = checked;
    savePreferences();
  });
  const spoken = option('Speak felis replies', preferences.spokenReplies, (checked) => {
    preferences.spokenReplies = checked;
    savePreferences();
  });
  const sounds = option('Interface sounds', preferences.soundEffects, (checked) => {
    preferences.soundEffects = checked;
    savePreferences();
  });

  const soundControls = document.createElement('div');
  soundControls.className = 'sound-settings-controls';
  const volume = document.createElement('input');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '1';
  volume.step = '0.05';
  volume.value = String(preferences.soundVolume);
  volume.setAttribute('aria-label', 'Sound volume');
  volume.addEventListener('input', () => {
    preferences.soundVolume = Number(volume.value);
    savePreferences();
  });
  const testSound = document.createElement('button');
  testSound.type = 'button';
  testSound.className = 'button';
  testSound.textContent = 'Play test sound';
  const soundStatus = document.createElement('span');
  soundStatus.setAttribute('role', 'status');
  testSound.addEventListener('click', async () => {
    if (!preferences.soundEffects || preferences.soundVolume <= 0) {
      soundStatus.textContent = 'Turn on interface sounds and raise the volume first.';
      return;
    }
    soundStatus.textContent = (await live.sound.playTest())
      ? 'Test sound played.'
      : 'Sound is unavailable while the microphone is active.';
  });
  soundControls.append(volume, testSound, soundStatus);

  const speechPreference = document.createElement('label');
  speechPreference.className = 'field speech-preference';
  speechPreference.append(document.createTextNode('Microphone mode'));
  const speechMode = document.querySelector('.speech-method select');
  if (speechMode) {
    speechPreference.append(speechMode);
    document.querySelector('.speech-mode-caret')?.remove();
  } else speechPreference.hidden = true;

  const manageCheckins = document.createElement('button');
  manageCheckins.type = 'button';
  manageCheckins.className = 'button settings-checkins';
  manageCheckins.textContent = 'Manage check-ins';
  manageCheckins.addEventListener('click', () =>
    live.showPage('activity', { activityTab: 'overview' }),
  );

  const profile = document.createElement('details');
  const profileTitle = document.createElement('summary');
  profileTitle.textContent = 'Your name';
  const profileForm = document.createElement('form');
  profileForm.className = 'profile-form';
  const nameLabel = document.createElement('label');
  nameLabel.className = 'field';
  nameLabel.append(document.createTextNode('Display name'));
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 40;
  nameInput.placeholder = 'Your name';
  nameInput.autocomplete = 'given-name';
  nameInput.required = true;
  nameInput.value = preferences.name;
  nameLabel.append(nameInput);
  const saveName = document.createElement('button');
  saveName.type = 'submit';
  saveName.className = 'button';
  saveName.textContent = 'Save name';
  const nameStatus = document.createElement('p');
  nameStatus.className = 'settings-feedback';
  nameStatus.setAttribute('role', 'status');
  profileForm.append(nameLabel, saveName, nameStatus);
  profile.append(profileTitle, profileForm);
  profileForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = nameInput.value.trim();
    if (!value) return;
    preferences.name = value;
    nameStatus.textContent = savePreferences() ? 'Name saved.' : homeStorage.message;
  });

  const namePrompt = document.createElement('button');
  namePrompt.type = 'button';
  namePrompt.className = 'button settings-name-prompt';
  namePrompt.textContent = 'Add your name';
  namePrompt.hidden = Boolean(preferences.name);
  namePrompt.addEventListener('click', () => {
    live.showPage('settings', { settingsSection: 'general' });
    profile.open = true;
    requestAnimationFrame(() => nameInput.focus());
  });
  document.querySelector('.header-actions').append(namePrompt);
  profileForm.addEventListener('submit', () => {
    namePrompt.hidden = Boolean(preferences.name);
  });

  section.append(
    group('Appearance', [motion.row]),
    group('Conversation', [guidance.row, spoken.row, speechPreference, manageCheckins]),
    group('Sound', [sounds.row, soundControls]),
    group('Personal', [profile]),
  );
  return section;
}

live = createLiveHome({
  openDetail: showDetail,
  dialog: detail,
  applyWorkspace: () => true,
  getSoundEnabled: () => preferences.soundEffects,
  getPreferences: () => preferences,
  setSoundEnabled: (enabled) => {
    preferences.soundEffects = enabled;
    savePreferences();
    return enabled;
  },
  onSettingsSection: (id) => settings?.selectSettings(id),
});
live.start();

settings = mountSettingsController({
  client: live.client,
  settingsHost: live.settingsHost,
  settingsSections: [
    { id: 'general', label: 'General', element: createGeneralSettings() },
    ...live.settingsSections,
  ],
  onSettingsSection: (id) => live.settingsSectionSelected(id),
  onOpenConnections: (source) =>
    source === 'browser' ? showDetail('browser-setup') : live.showPage('connections'),
});

if (!live.settingsHost.hidden)
  settings.selectSettings(location.hash === '#connections' ? 'connections' : 'general');
window.addEventListener('pagehide', () => settings?.destroy(), { once: true });

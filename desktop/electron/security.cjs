'use strict';
const ORIGIN = 'http://127.0.0.1:8765';
const GOOGLE_AUTH_ORIGIN = 'https://accounts.google.com';
const GOOGLE_AUTH_PATH = '/o/oauth2/v2/auth';
const AUTHORIZATION_FIELDS = Object.freeze([
  'client_id',
  'redirect_uri',
  'response_type',
  'scope',
  'code_challenge',
  'code_challenge_method',
  'state',
  'access_type',
  'prompt',
]);

// Each handoff is intentionally an exact allowlist. The main process only
// opens a provider URL after the local service supplied this validated shape.
const GOOGLE_AUTHORIZATION = Object.freeze({
  scopes: Object.freeze([
    'openid',
    'email',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.events.readonly',
  ]),
});
const BRIEFING_AUTHORIZATION = Object.freeze({
  scopes: Object.freeze(['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly']),
});

function localURL(value) {
  try {
    const url = new URL(value);
    return url.origin === ORIGIN && !url.username && !url.password;
  } catch {
    return false;
  }
}

function homeURL(value) {
  if (!localURL(value)) return false;
  return ['/home/', '/home/index.html'].includes(new URL(value).pathname);
}

function audioRequest({ permission, url, mainFrame, focused, mediaTypes }) {
  return (
    permission === 'media' &&
    homeURL(url) &&
    mainFrame === true &&
    focused === true &&
    Array.isArray(mediaTypes) &&
    mediaTypes.length === 1 &&
    mediaTypes[0] === 'audio'
  );
}

function checkInTarget(value) {
  if (!value || typeof value !== 'object') return null;
  const keys = ['conversationId', 'messageId', 'eventId'];
  if (
    !keys.every(
      (key) => typeof value[key] === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value[key]),
    )
  )
    return null;
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

function authorizationURL(value, { scopes }) {
  try {
    const url = new URL(value);
    const parameters = url.searchParams;
    const redirect = new URL(parameters.get('redirect_uri'));
    const expectedScopes = [...scopes].sort().join(' ');
    const requestedScopes = parameters.get('scope').split(' ').sort().join(' ');

    return (
      url.origin === GOOGLE_AUTH_ORIGIN &&
      url.pathname === GOOGLE_AUTH_PATH &&
      !url.hash &&
      !url.username &&
      !url.password &&
      [...parameters.keys()].length === AUTHORIZATION_FIELDS.length &&
      AUTHORIZATION_FIELDS.every((field) => parameters.has(field)) &&
      /^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(parameters.get('client_id')) &&
      requestedScopes === expectedScopes &&
      parameters.get('response_type') === 'code' &&
      parameters.get('access_type') === 'offline' &&
      parameters.get('prompt') === 'consent select_account' &&
      parameters.get('code_challenge_method') === 'S256' &&
      /^[A-Za-z0-9_-]{43}$/.test(parameters.get('code_challenge')) &&
      /^[A-Za-z0-9_-]{43}$/.test(parameters.get('state')) &&
      redirect.protocol === 'http:' &&
      redirect.hostname === '127.0.0.1' &&
      Number(redirect.port) >= 1024 &&
      Number(redirect.port) <= 65535 &&
      redirect.pathname === '/callback' &&
      !redirect.search &&
      !redirect.hash &&
      !redirect.username &&
      !redirect.password
    );
  } catch {
    return false;
  }
}

function googleAuthorizationURL(value) {
  return authorizationURL(value, GOOGLE_AUTHORIZATION);
}

function briefingAuthorizationURL(value) {
  return authorizationURL(value, BRIEFING_AUTHORIZATION);
}

function briefingSourceURL(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    if (u.hostname === 'mail.google.com')
      return (
        u.pathname === '/mail/u/' &&
        [...u.searchParams.keys()].join(',') === 'authuser' &&
        /^[^\s@]+@[^\s@]+$/.test(u.searchParams.get('authuser')) &&
        /^#all\/[A-Za-z0-9_-]{1,1024}$/.test(u.hash)
      );
    return u.href === 'https://calendar.google.com/calendar/u/0/r';
  } catch {
    return false;
  }
}

module.exports = {
  ORIGIN,
  localURL,
  homeURL,
  audioRequest,
  checkInTarget,
  googleAuthorizationURL,
  briefingAuthorizationURL,
  briefingSourceURL,
};

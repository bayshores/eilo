const { test } = require('node:test');
const assert = require('node:assert/strict');
const { localURL, homeURL, audioRequest, checkInTarget } = require('./security.cjs');

test('only the exact loopback service is trusted; home IPC excludes other pages', () => {
  assert.ok(homeURL('http://127.0.0.1:8765/home/#goals'));
  assert.ok(localURL('http://127.0.0.1:8765/activity-connect'));
  for (const url of [
    'https://127.0.0.1:8765/home/',
    'http://localhost:8765/home/',
    'http://127.0.0.1:8766/home/',
    'http://127.0.0.1:8765.evil.test/home/',
    'file:///tmp/page',
    'javascript:alert(1)',
    'http://user@127.0.0.1:8765/home/',
  ])
    assert.equal(localURL(url), false, url);
  assert.equal(homeURL('http://127.0.0.1:8765/api/state'), false);
});

test('microphone requests require focused trusted top-level Home and audio alone', () => {
  const request = {
    permission: 'media',
    url: 'http://127.0.0.1:8765/home/',
    mainFrame: true,
    focused: true,
    mediaTypes: ['audio'],
  };
  assert.equal(audioRequest(request), true);
  for (const change of [
    { permission: 'notifications' },
    { mainFrame: false },
    { focused: false },
    { url: 'https://example.test' },
    { mediaTypes: ['video'] },
    { mediaTypes: ['audio', 'video'] },
    { mediaTypes: undefined },
  ])
    assert.equal(audioRequest({ ...request, ...change }), false);
});

test('notification targets carry identifiers only and reject arbitrary commands/URLs', () => {
  assert.deepEqual(
    checkInTarget({
      conversationId: 'conversation_1',
      messageId: '123',
      eventId: 'event-1',
      text: 'never forwarded',
    }),
    { conversationId: 'conversation_1', messageId: '123', eventId: 'event-1' },
  );
  assert.equal(
    checkInTarget({ conversationId: 'a', messageId: 'file:///private', eventId: 'b' }),
    null,
  );
  assert.equal(
    checkInTarget({ conversationId: 'a', messageId: 'b', eventId: 'a'.repeat(129) }),
    null,
  );
  assert.equal(checkInTarget(null), null);
});

test('Google handoff admits only Calendar read scopes with PKCE and a local callback', () => {
  const { googleAuthorizationURL } = require('./security.cjs');
  const make = () =>
    new URL(
      'https://accounts.google.com/o/oauth2/v2/auth?' +
        new URLSearchParams({
          client_id: '12345-validation.apps.googleusercontent.com',
          redirect_uri: 'http://127.0.0.1:43125/callback',
          response_type: 'code',
          scope:
            'openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly',
          code_challenge: 'a'.repeat(43),
          code_challenge_method: 'S256',
          state: 'b'.repeat(43),
          access_type: 'offline',
          prompt: 'consent select_account',
        }),
    );
  assert.equal(googleAuthorizationURL(make().href), true);
  for (const [field, value] of [
    ['scope', 'https://www.googleapis.com/auth/calendar'],
    ['redirect_uri', 'https://example.com/callback'],
    ['redirect_uri', 'http://user@127.0.0.1:43125/callback'],
    ['redirect_uri', 'http://127.0.0.1:80/callback'],
    ['code_challenge_method', 'plain'],
    ['state', 'short'],
  ]) {
    const url = make();
    url.searchParams.set(field, value);
    assert.equal(googleAuthorizationURL(url.href), false, field);
  }
  const duplicate = make();
  duplicate.searchParams.append('scope', 'email');
  assert.equal(googleAuthorizationURL(duplicate.href), false);
  const other = make();
  other.hostname = 'accounts.google.com.evil.test';
  assert.equal(googleAuthorizationURL(other.href), false);
});

test('Briefing handoff admits only Gmail read scopes with PKCE and a local callback', () => {
  const { briefingAuthorizationURL } = require('./security.cjs');
  const make = () =>
    new URL(
      'https://accounts.google.com/o/oauth2/v2/auth?' +
        new URLSearchParams({
          client_id: '12345-validation.apps.googleusercontent.com',
          redirect_uri: 'http://127.0.0.1:43125/callback',
          response_type: 'code',
          scope: 'openid email https://www.googleapis.com/auth/gmail.readonly',
          code_challenge: 'a'.repeat(43),
          code_challenge_method: 'S256',
          state: 'b'.repeat(43),
          access_type: 'offline',
          prompt: 'consent select_account',
        }),
    );
  assert.equal(briefingAuthorizationURL(make().href), true);
  for (const [field, value] of [
    ['scope', 'https://www.googleapis.com/auth/calendar'],
    ['redirect_uri', 'https://example.com/callback'],
    ['redirect_uri', 'http://user@127.0.0.1:43125/callback'],
    ['redirect_uri', 'http://127.0.0.1:80/callback'],
    ['code_challenge_method', 'plain'],
    ['state', 'short'],
  ]) {
    const url = make();
    url.searchParams.set(field, value);
    assert.equal(briefingAuthorizationURL(url.href), false, field);
  }
  const duplicate = make();
  duplicate.searchParams.append('scope', 'email');
  assert.equal(briefingAuthorizationURL(duplicate.href), false);
  const other = make();
  other.hostname = 'accounts.google.com.evil.test';
  assert.equal(briefingAuthorizationURL(other.href), false);
});

test('briefing links accept only declared Google read destinations', () => {
  const { briefingSourceURL } = require('./security.cjs');
  assert.equal(
    briefingSourceURL('https://mail.google.com/mail/u/?authuser=test%40example.com#all/123abc'),
    true,
  );
  assert.equal(briefingSourceURL('https://calendar.google.com/calendar/u/0/r'), true);
  for (const u of [
    'javascript:alert(1)',
    'https://mail.google.com.evil.test/mail/u/',
    'https://mail.google.com/mail/u/?authuser=test@example.com&compose=new#all/abc',
    'https://calendar.google.com/calendar/u/0/r/eventedit',
    'https://user@mail.google.com/mail/u/?authuser=test@example.com#all/abc',
  ])
    assert.equal(briefingSourceURL(u), false, u);
});

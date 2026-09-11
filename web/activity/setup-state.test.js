import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSetupState, desktopSetupState } from './setup-state.js';

const browser = (overrides = {}) => ({
  online: true,
  current: {
    policy: { enabled: true, browser_enabled: true },
    capture_status: { browser: { connected: true } },
  },
  extension: { installed: true, granted: true },
  ...overrides,
});

test('Chrome is connected only after transport, setup, and grant have all been verified', () => {
  for (const status of [
    { connected: true },
    { connected: true, setup_verified: true },
    { connected: true, grant_verified: true },
  ]) {
    const state = browserSetupState(
      browser({
        current: {
          policy: { enabled: true, browser_enabled: true },
          capture_status: { browser: status },
        },
      }),
    );
    assert.notEqual(state.id, 'connected');
  }
  assert.equal(
    browserSetupState(
      browser({
        current: {
          policy: { enabled: true, browser_enabled: true },
          capture_status: {
            browser: { connected: true, setup_verified: true, grant_verified: true },
          },
        },
      }),
    ).id,
    'connected',
  );
});

test('verified Chrome is ready while browser recording is off and paused remains distinct', () => {
  const health = { connected: true, setup_verified: true, grant_verified: true };
  assert.equal(
    browserSetupState(
      browser({
        current: {
          policy: { enabled: true, browser_enabled: false },
          capture_status: { browser: health },
        },
      }),
    ).id,
    'ready',
  );
  assert.equal(
    browserSetupState(
      browser({
        current: {
          policy: { enabled: false, browser_enabled: true },
          capture_status: { browser: health },
        },
      }),
    ).id,
    'paused',
  );
});

test('Chrome reports an arriving event only from a real recorded receipt after verification', () => {
  const complete = {
    connected: true,
    setup_verified: true,
    grant_verified: true,
    last_verified_at: 100,
  };
  assert.equal(
    browserSetupState(
      browser({
        current: {
          policy: { enabled: true, browser_enabled: true },
          capture_status: { browser: complete },
        },
      }),
    ).received,
    false,
  );
  assert.equal(
    browserSetupState(
      browser({
        current: {
          policy: { enabled: true, browser_enabled: true },
          capture_status: { browser: { ...complete, last_event_at: 99 } },
        },
      }),
    ).received,
    false,
  );
  assert.equal(
    browserSetupState(
      browser({
        current: {
          policy: { enabled: true, browser_enabled: true },
          capture_status: { browser: { ...complete, last_event_at: 101 } },
        },
      }),
    ).received,
    true,
  );
});

test('desktop never requests Accessibility unless text access was explicitly chosen', () => {
  const current = {
    policy: { enabled: true, desktop_enabled: true },
    capture_status: {
      desktop: { status: 'permission_required', permissions: { accessibility_permission: false } },
    },
  };
  assert.equal(desktopSetupState(current).id, 'connected');
  assert.equal(desktopSetupState(current, { text: true }).id, 'permission');
});

test('desktop avoids fake capture readiness when the source is off or helper is still checking', () => {
  assert.equal(
    desktopSetupState({
      policy: { enabled: true, desktop_enabled: false },
      capture_status: { desktop: { status: 'ready' } },
    }).id,
    'off',
  );
  assert.equal(
    desktopSetupState({
      policy: { enabled: true, desktop_enabled: true },
      capture_status: { desktop: { status: 'unknown' } },
    }).id,
    'checking',
  );
});

test('verified transport cannot hide a capture error', () => {
  const state = browserSetupState(
    browser({
      current: {
        policy: { enabled: true, browser_enabled: true },
        capture_status: {
          browser: { connected: true, setup_verified: true, grant_verified: true, status: 'error' },
        },
      },
    }),
  );
  assert.equal(state.id, 'error');
  assert.equal(state.action, 'retry');
});

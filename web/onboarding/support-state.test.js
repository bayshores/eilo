import assert from 'node:assert/strict';
import test from 'node:test';
import {
  browserReady,
  calendarReady,
  calendarSharingReady,
  desktopReady,
  sourceReady,
  supportState,
} from './support-state.js';

const view = () => ({
  connection: 'connected',
  snapshot: {
    adaptive: {
      policy: { enabled: true, browser_enabled: true, desktop_enabled: true, ai_enabled: false },
      capture_status: {
        browser: { connected: true, setup_verified: true, grant_verified: true, status: 'ready' },
        desktop: { status: 'ready', permissions: { accessibility_permission: false } },
      },
    },
    accountability: { check_ins: { version: 1, enabled: false, phase: 'off' } },
    integrations: {
      google_calendar: { state: 'disconnected', selected_ids: [] },
      briefing_sources: { calendar: { available: true, enabled: false, selected_count: 0 } },
    },
  },
});

test('browser readiness requires every verified grant and active policy', () => {
  const current = view();
  assert.equal(browserReady(current), true);
  for (const key of ['connected', 'setup_verified', 'grant_verified']) {
    current.snapshot.adaptive.capture_status.browser[key] = false;
    assert.equal(browserReady(current), false, key);
    current.snapshot.adaptive.capture_status.browser[key] = true;
  }
  current.snapshot.adaptive.capture_status.browser.status = 'error';
  assert.equal(browserReady(current), false);
  current.snapshot.adaptive.capture_status.browser.status = 'ready';
  current.snapshot.adaptive.policy.browser_enabled = false;
  assert.equal(sourceReady(current, 'browser'), false);
  current.connection = 'offline';
  assert.equal(browserReady(current), false);
});

test('desktop setup accepts app metadata without text permission but rejects helper failures', () => {
  const current = view();
  assert.equal(desktopReady(current), true);
  current.snapshot.adaptive.capture_status.desktop.status = 'waiting';
  assert.equal(desktopReady(current), false);
  current.snapshot.adaptive.capture_status.desktop.status = 'permission_required';
  assert.equal(desktopReady(current), true);
  current.snapshot.adaptive.capture_status.desktop.status = 'error';
  assert.equal(desktopReady(current), false);
  current.snapshot.adaptive.capture_status.desktop.status = 'ready';
  current.snapshot.adaptive.policy.enabled = false;
  assert.equal(desktopReady(current), false);
});

test('calendar connection and calendar sharing have separate ready states', () => {
  const current = view();
  current.snapshot.integrations.google_calendar = { state: 'connected', selected_ids: ['primary'] };
  assert.equal(calendarReady(current), true);
  assert.equal(calendarSharingReady(current), false);
  current.snapshot.integrations.briefing_sources.calendar = {
    available: true,
    enabled: true,
    selected_count: 1,
  };
  assert.equal(calendarSharingReady(current), true);
  current.snapshot.integrations.google_calendar.state = 'reauth_required';
  assert.equal(calendarReady(current), false);
  current.snapshot.integrations.google_calendar.state = 'offline';
  assert.equal(calendarReady(current), false);
  current.snapshot.integrations.google_calendar.state = 'connected';
  current.snapshot.integrations.google_calendar.selected_ids = [];
  assert.equal(calendarReady(current), false);
});

test('check-in readiness means enabled status, not merely supported status', () => {
  const current = view();
  assert.equal(supportState(current, 'browser').checkinsReady, false);
  current.snapshot.accountability.check_ins.enabled = true;
  current.snapshot.accountability.check_ins.phase = 'awaiting_observation';
  assert.equal(supportState(current, 'browser').checkinsReady, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { isLiveWidget, widgetFingerprint } from './live-widgets.js';

test('source widgets use the same live-refresh eligibility as their renderer', () => {
  assert.equal(isLiveWidget('tracking'), true);
  assert.equal(isLiveWidget('usage'), true);
  assert.equal(isLiveWidget('notes'), false);
});
test('source and permission changes invalidate live widgets even when tasks are unchanged', () => {
  const view = {
    connection: 'connected',
    snapshot: {
      tasks: { revision: 1 },
      integrations: {
        briefing_sources: { calendar: { available: true, enabled: false }, accounts: [] },
      },
      accountability: {
        activity: { state: 'active', helper_available: true, chrome_available: false },
        observed_activity: { usage: { total_observed_seconds: 0 } },
      },
    },
  };
  const before = widgetFingerprint(view);
  const calendar = structuredClone(view);
  calendar.snapshot.integrations.briefing_sources.calendar.enabled = true;
  assert.notEqual(widgetFingerprint(calendar), before);
  const gmail = structuredClone(view);
  gmail.snapshot.integrations.briefing_sources.accounts = [{ enabled: true, state: 'connected' }];
  assert.notEqual(widgetFingerprint(gmail), before);
  const browser = structuredClone(view);
  browser.snapshot.accountability.activity.chrome_available = true;
  assert.notEqual(widgetFingerprint(browser), before);
  const usage = structuredClone(view);
  usage.snapshot.accountability.observed_activity.usage.total_observed_seconds = 5;
  assert.notEqual(widgetFingerprint(usage), before);
  assert.notEqual(widgetFingerprint({ ...view, connection: 'loading' }), before);
  assert.equal(widgetFingerprint(structuredClone(view)), before);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { contextPolicyPatch, sourcePolicyPatch } from './context-panel.js';

test('context setting changes preserve independently chosen permissions and exclusions', () => {
  const current = {
    policy: {
      enabled: true,
      desktop_enabled: true,
      browser_enabled: false,
      text_enabled: false,
      visuals_enabled: false,
      ai_enabled: false,
      excluded_domains: ['private.example'],
      excluded_bundle_ids: ['com.example.private'],
    },
  };
  const ai = contextPolicyPatch(current, { ai_enabled: true });
  assert.equal(ai.ai_enabled, true);
  assert.equal(ai.browser_enabled, false);
  assert.equal(ai.text_enabled, false);
  assert.equal(ai.visuals_enabled, false);
  const browser = contextPolicyPatch({ policy: ai }, { browser_enabled: true });
  assert.equal(browser.ai_enabled, true);
  assert.equal(browser.desktop_enabled, true);
  assert.deepEqual(browser.excluded_domains, ['private.example']);
  assert.deepEqual(browser.excluded_bundle_ids, ['com.example.private']);
  assert.equal(current.policy.ai_enabled, false);
  const paused = contextPolicyPatch({ policy: browser }, { enabled: false });
  assert.equal(paused.browser_enabled, true);
  assert.equal(paused.ai_enabled, true);
  assert.equal(paused.enabled, false);
});

test('adding a source preserves an intentional recording pause', () => {
  const paused = {
    policy: {
      enabled: false,
      desktop_enabled: true,
      browser_enabled: false,
      text_enabled: true,
      visuals_enabled: false,
      ai_enabled: true,
      excluded_domains: [],
      excluded_bundle_ids: [],
    },
  };
  const resumedSource = sourcePolicyPatch(paused, 'browser_enabled', true);
  assert.equal(resumedSource.browser_enabled, true);
  assert.equal(resumedSource.enabled, false);

  const firstSource = sourcePolicyPatch(
    { policy: { ...paused.policy, desktop_enabled: false, browser_enabled: false } },
    'browser_enabled',
    true,
  );
  assert.equal(firstSource.enabled, true);
});

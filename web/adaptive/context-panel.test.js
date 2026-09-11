import test from 'node:test';
import assert from 'node:assert/strict';
import { contextPolicyPatch, contextSummary, canSaveContextCorrection } from './context-panel.js';

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

test('Home context status does not imply that choosing adaptive layout enabled AI', () => {
  assert.deepEqual(contextSummary({ mode: 'adaptive', policy: { ai_enabled: false } }), {
    label: 'Off',
    tone: 'quiet',
  });
  assert.equal(
    contextSummary({ policy: { ai_enabled: true }, analysis: { status: 'updating' } }).label,
    'Updating',
  );
  assert.equal(
    contextSummary({ policy: { ai_enabled: true }, analysis: { status: 'error' } }).tone,
    'attention',
  );
  assert.equal(
    contextSummary({ policy: { ai_enabled: true }, current_work_context: { title: 'Writing' } })
      .label,
    'Ready',
  );
  assert.equal(contextSummary(null).label, 'Unavailable');
});

test('a correction cannot silently overwrite a different or changed work context', () => {
  const original = { id: 'writing', title: 'Draft a letter', return_point: 'Opening paragraph' };
  assert.equal(canSaveContextCorrection({ ...original, confidence: 'explicit' }, original), true);
  assert.equal(canSaveContextCorrection({ ...original, id: 'admin' }, original), false);
  assert.equal(
    canSaveContextCorrection({ ...original, title: 'Revise the ending' }, original),
    false,
  );
  assert.equal(
    canSaveContextCorrection({ ...original, return_point: 'Check the sources' }, original),
    false,
  );
  assert.equal(canSaveContextCorrection(null, original), false);
});

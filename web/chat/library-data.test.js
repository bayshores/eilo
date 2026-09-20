import assert from 'node:assert/strict';
import test from 'node:test';
import { chatDisplayName } from './library.js';

test('history keeps deliberate names but turns raw or generic labels into scannable conversations', () => {
  assert.equal(chatDisplayName({ name: 'Interview prep', updated_at: '' }), 'Interview prep');
  const generic = chatDisplayName({ name: 'New chat', updated_at: '2026-09-19T18:00:00Z' });
  assert.ok(generic.startsWith('Conversation'));
  const raw = chatDisplayName({
    name: 'Can you help me decide what to do after class today?',
    updated_at: '2026-09-19T18:00:00Z',
  });
  assert.ok(raw.startsWith('Conversation'));
});

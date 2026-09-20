import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpeechOutput, speechText } from './output.js';

const assistant = (id, text, origin = 'chat') => ({ id, role: 'assistant', text, origin });
const view = (messages, conversation_id = 'one') => ({ snapshot: { conversation_id, messages } });

function harness({ enabled = true, visible = true } = {}) {
  const spoken = [];
  const states = [];
  let active = null;
  let spokenReplies = enabled;
  class Utterance {
    constructor(text) {
      this.text = text;
    }
  }
  const speechSynthesis = {
    cancel() {
      active = null;
    },
    speak(utterance) {
      active = utterance;
      spoken.push(utterance);
    },
  };
  const output = createSpeechOutput({
    getPreferences: () => ({ spokenReplies, soundVolume: 0.7 }),
    speechSynthesis,
    SpeechSynthesisUtterance: Utterance,
    isVisible: () => visible,
    onState: (state) => states.push(state),
  });
  return {
    output,
    spoken,
    states,
    finish() {
      active?.onend?.();
    },
    setEnabled(value) {
      spokenReplies = value;
    },
    setVisible(value) {
      visible = value;
    },
  };
}

test('speech output seeds existing messages and speaks a new assistant reply once', () => {
  const h = harness();
  h.output.update(view([assistant('old', 'Older reply')]));
  assert.equal(h.spoken.length, 0);
  h.output.update(view([assistant('old', 'Older reply'), assistant('new', 'A new reply')]));
  assert.equal(h.spoken.length, 1);
  assert.equal(h.spoken[0].text, 'A new reply');
  assert.equal(h.spoken[0].volume, 0.7);
  h.output.update(view([assistant('old', 'Older reply'), assistant('new', 'A new reply')]));
  assert.equal(h.spoken.length, 1);
  h.finish();
  assert.deepEqual(h.states, [{ speaking: true, id: 'new' }, { speaking: false }]);
});

test('speech output respects foreground privacy and never replays missed replies', () => {
  const h = harness({ visible: false });
  h.output.update(view([]));
  h.output.update(view([assistant('hidden', 'Still quiet')]));
  h.setVisible(true);
  h.output.update(view([assistant('hidden', 'Still quiet')]));
  assert.equal(h.spoken.length, 0);
  h.output.update(view([assistant('hidden', 'Still quiet'), assistant('new', 'Speak this')]));
  assert.equal(h.spoken.length, 1);
});

test('speech output stops immediately after its preference changes', () => {
  const h = harness();
  h.output.update(view([]));
  h.output.update(view([assistant('long', 'word '.repeat(190) + 'Done.')]));
  assert.equal(h.output.speaking, true);
  h.setEnabled(false);
  assert.deepEqual(h.output.sync(), { available: true, speaking: false });
  assert.equal(h.output.speaking, false);
  assert.ok(speechText('word '.repeat(190) + 'Done.').length <= 900);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { commandMatches, localCommand } from './commands.js';

const slash = String.fromCharCode(47);

test('goal is discoverable from the slash menu', () => {
  const matches = commandMatches(slash + 'g');
  assert.deepEqual(
    matches.map(({ command }) => command),
    [slash + 'goal'],
  );
  assert.equal(matches[0].label, 'Create or update a goal');
});

test('goal accepts an editable natural-language request', () => {
  const command = localCommand(slash + 'GOAL  Finish the portfolio by Friday ');
  assert.equal(command?.command, slash + 'goal');
  assert.equal(command?.input, 'Finish the portfolio by Friday');
});

test('commands are recognized only at the beginning of the message', () => {
  assert.equal(localCommand('please ' + slash + 'GOAL finish the portfolio'), null);
  assert.deepEqual(commandMatches('please ' + slash + 'GOAL'), []);
});

test('deterministic commands reject trailing prompt text', () => {
  assert.equal(localCommand(slash + 'new ignore my draft'), null);
  assert.equal(localCommand(slash + 'new')?.input, '');
});

test('capability shortcuts open the exact per-chat filter', () => {
  const skills = localCommand(slash + 'skills');
  assert.equal(skills?.settingsSection, 'capabilities');
  assert.equal(skills?.capabilityKind, 'skill');
  const mcp = localCommand(slash + 'mcp');
  assert.equal(mcp?.page, 'settings');
  assert.equal(mcp?.capabilityKind, 'mcp');
});

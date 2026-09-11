import assert from 'node:assert/strict';
import test from 'node:test';
import { runDevelopment } from '../scripts/dev.mjs';

function runner(statuses = []) {
  const calls = [];
  return {
    calls,
    spawn(command, args, options) {
      calls.push({ command, args, cwd: options.cwd });
      return { status: statuses.shift() ?? 0 };
    },
  };
}

test('setup uses locked root dependencies and macOS Electron dependencies in order', () => {
  const { calls, spawn } = runner();
  runDevelopment('setup', { projectRoot: '/fixture/eilo', platform: 'darwin', spawn });
  assert.deepEqual(
    calls.map(({ command, args }) => [command, args]),
    [
      ['uv', ['sync', '--locked', '--group', 'dev']],
      ['npm', ['ci']],
      ['npm', ['ci', '--prefix', 'desktop/electron']],
      ['/fixture/eilo/scripts/install-source-guards', []],
    ],
  );
});

test('setup stops when a subprocess fails', () => {
  const { calls, spawn } = runner([1]);
  assert.throws(() => runDevelopment('setup', { projectRoot: '/fixture/eilo', spawn }), /uv sync/);
  assert.equal(calls.length, 1);
});

test('dev selects the isolated interactive activity fixture', () => {
  const { calls, spawn } = runner();
  runDevelopment('dev', { projectRoot: '/fixture/eilo', spawn, exists: () => true });
  assert.deepEqual(calls[0], {
    command: '/fixture/eilo/.venv/bin/python',
    args: ['scripts/preview-context.py', '--port', '8774', '--sample-activity'],
    cwd: '/fixture/eilo',
  });
});

test('desktop launch reports a missing runtime before starting Electron', () => {
  const { calls, spawn } = runner();
  assert.throws(
    () =>
      runDevelopment('start', {
        projectRoot: '/fixture/eilo',
        platform: 'darwin',
        spawn,
        exists: () => false,
      }),
    /npm run setup:runtime/,
  );
  assert.equal(calls.length, 0);
});

test('desktop launch builds only missing native helpers before Electron', () => {
  const { calls, spawn } = runner();
  runDevelopment('start', {
    projectRoot: '/fixture/eilo',
    platform: 'darwin',
    spawn,
    exists: (filename) => !/EiloContextCollector|EiloActivityHelper$/.test(filename),
  });
  assert.deepEqual(
    calls.map(({ command, args }) => [command, args]),
    [
      ['/fixture/eilo/scripts/build-context-collector', []],
      ['/fixture/eilo/scripts/build-activity-helper', []],
      ['/fixture/eilo/desktop/electron/node_modules/.bin/electron', ['.']],
    ],
  );
});

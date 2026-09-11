'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { copyTrackedWorkspace, readPolicy } = require('./source-boundary.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eilo-source-boundary-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'config/source-boundary.json'),
    JSON.stringify({
      version: 1,
      private_directories: ['.state', '.runtime', '.tmp', '.git'],
      private_files: ['auth.json', 'checkout.json'],
      private_suffixes: ['.db'],
      bundle_workspace_roots: ['app', 'config'],
    }),
  );
  childProcess.execFileSync('git', ['init', '--quiet', root]);
  childProcess.execFileSync('git', ['-C', root, 'add', '--', 'config/source-boundary.json']);
  return root;
}

function stage(root, relative, contents = 'public\n') {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  childProcess.execFileSync('git', ['-C', root, 'add', '--', relative]);
}

test('copies tracked public files and excludes nested ignored secrets', () => {
  const root = fixture();
  try {
    stage(root, 'app/public.py');
    fs.mkdirSync(path.join(root, 'app/nested'), { recursive: true });
    fs.writeFileSync(path.join(root, '.gitignore'), 'app/nested/.env\n');
    fs.writeFileSync(path.join(root, 'app/nested/.env'), 'never package');
    assert.equal(
      childProcess.execFileSync('git', ['-C', root, 'check-ignore', 'app/nested/.env'], {
        encoding: 'utf8',
      }),
      'app/nested/.env\n',
    );
    const workspace = path.join(root, 'stage');
    copyTrackedWorkspace(root, workspace, readPolicy(root));
    assert.equal(fs.readFileSync(path.join(workspace, 'app/public.py'), 'utf8'), 'public\n');
    assert.equal(fs.existsSync(path.join(workspace, 'config/source-boundary.json')), true);
    assert.equal(fs.existsSync(path.join(workspace, 'app/nested/.env')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects forced tracked private files', () => {
  const root = fixture();
  try {
    stage(root, 'config/auth.json', '{}');
    assert.throws(() => copyTrackedWorkspace(root, path.join(root, 'stage')), /Private path/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects source symlinks before staging', () => {
  const root = fixture();
  try {
    fs.mkdirSync(path.join(root, 'app'));
    fs.symlinkSync(os.tmpdir(), path.join(root, 'app/escape'));
    childProcess.execFileSync('git', ['-C', root, 'add', '--', 'app/escape']);
    assert.throws(() => copyTrackedWorkspace(root, path.join(root, 'stage')), /source symlink/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a tracked file whose parent is replaced by an external symlink', () => {
  const root = fixture();
  try {
    stage(root, 'app/public.py');
    const original = path.join(root, 'app');
    const external = path.join(root, 'external-app');
    fs.renameSync(original, external);
    fs.symlinkSync(external, original);
    assert.throws(() => copyTrackedWorkspace(root, path.join(root, 'stage')), /source symlink/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

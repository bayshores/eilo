'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  throw new Error(message);
}

function readPolicy(root) {
  let policy;
  try {
    policy = JSON.parse(fs.readFileSync(path.join(root, 'config', 'source-boundary.json'), 'utf8'));
  } catch (error) {
    fail(`Cannot read source-boundary policy: ${error.message}`);
  }
  if (
    policy.version !== 1 ||
    !['private_directories', 'private_files', 'private_suffixes', 'bundle_workspace_roots'].every(
      (key) => Array.isArray(policy[key]),
    )
  )
    fail('Unsupported source-boundary policy. Refusing to stage a beta workspace.');
  return policy;
}

function normalized(relative) {
  const value = relative.split(path.sep).join('/').replace(/^\.\//, '');
  if (!value || value.startsWith('/') || value === '..' || value.startsWith('../'))
    fail(`Invalid repository-relative path: ${relative}`);
  return value;
}

function isPrivatePath(relative, policy) {
  const value = normalized(relative);
  const parts = value.split('/');
  const name = parts.at(-1);
  return (
    parts.some((part) => policy.private_directories.includes(part)) ||
    policy.private_files.includes(name) ||
    policy.private_suffixes.some((suffix) => name.endsWith(suffix)) ||
    (name.includes('.env') && !name.endsWith('.example'))
  );
}

function gitPaths(root, args) {
  const result = childProcess.spawnSync('git', ['-C', root, ...args], { encoding: 'buffer' });
  if (result.status !== 0)
    fail(
      `Unable to inspect the Git index: ${result.stderr.toString('utf8').trim() || 'git failed'}`,
    );
  return result.stdout.toString('utf8').split('\0').filter(Boolean).map(normalized);
}

function trackedWorkspaceFiles(root, policy) {
  const indexPaths = gitPaths(root, ['ls-files', '-z']);
  const privatePaths = indexPaths.filter((relative) => isPrivatePath(relative, policy));
  if (privatePaths.length)
    fail(`Private path is tracked in the Git index: ${privatePaths.sort().join(', ')}`);

  return indexPaths.filter((relative) =>
    policy.bundle_workspace_roots.some(
      (allowed) => relative === allowed || relative.startsWith(`${allowed}/`),
    ),
  );
}

function stagedPrivatePaths(root, policy) {
  return gitPaths(root, ['diff', '--cached', '--name-only', '-z']).filter((relative) =>
    isPrivatePath(relative, policy),
  );
}

function rejectSourceSymlinkAncestors(root, relative) {
  let current = root;
  for (const part of normalized(relative).split('/')) {
    current = path.join(current, part);
    const info = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!info) fail(`Tracked beta input is missing from the checkout: ${relative}`);
    if (info.isSymbolicLink()) fail(`Refusing source symlink in beta workspace: ${relative}`);
  }
}

function copyTrackedWorkspace(root, workspace, policy = readPolicy(root)) {
  const stagedPrivate = stagedPrivatePaths(root, policy);
  if (stagedPrivate.length) fail(`Private path is staged: ${stagedPrivate.sort().join(', ')}`);

  const files = trackedWorkspaceFiles(root, policy);
  for (const relative of files) {
    const source = path.join(root, relative);
    rejectSourceSymlinkAncestors(root, relative);
    const sourceInfo = fs.lstatSync(source);
    if (!sourceInfo.isFile()) fail(`Tracked beta input is not a regular file: ${relative}`);
    const destination = path.join(workspace, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, sourceInfo.mode & 0o777);
  }
  return files;
}

module.exports = { copyTrackedWorkspace, isPrivatePath, readPolicy, trackedWorkspaceFiles };

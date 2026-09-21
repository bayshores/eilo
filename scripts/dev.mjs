/** Root launch commands keep development, the fixture, and private runtime separate. */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

function run(spawn, command, args, cwd) {
  const result = spawn(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed.`);
}

function requireFile(exists, filename, message) {
  if (!exists(filename)) throw new Error(message);
}

export function runDevelopment(
  action,
  { projectRoot = root, platform = process.platform, spawn = spawnSync, exists = existsSync } = {},
) {
  const atRoot = (...parts) => path.join(projectRoot, ...parts);
  if (action === 'setup') {
    run(spawn, 'uv', ['sync', '--locked', '--group', 'dev'], projectRoot);
    run(spawn, 'npm', ['ci'], projectRoot);
    if (platform === 'darwin')
      run(spawn, 'npm', ['ci', '--prefix', 'desktop/electron'], projectRoot);
    run(spawn, atRoot('scripts', 'install-source-guards'), [], projectRoot);
    return;
  }
  if (action === 'dev') {
    const python = atRoot('.venv', 'bin', 'python');
    requireFile(exists, python, 'Developer dependencies are missing. Run: npm run setup');
    run(
      spawn,
      python,
      ['scripts/preview-context.py', '--port', '8774', '--sample-activity'],
      projectRoot,
    );
    return;
  }
  if (action === 'start') {
    if (platform !== 'darwin')
      throw new Error('npm start is supported on macOS only. Use npm run dev for the fixture.');
    requireFile(
      exists,
      atRoot('.runtime', 'venv', 'bin', 'python'),
      'The project-local runtime is missing. Run: npm run setup:runtime',
    );
    const electron = atRoot('desktop', 'electron', 'node_modules', '.bin', 'electron');
    requireFile(exists, electron, 'Electron dependencies are missing. Run: npm run setup');
    const collector = atRoot('.runtime', 'eilo-context-collector', 'EiloContextCollector');
    const helper = atRoot(
      '.runtime',
      'eilo-activity-helper',
      'eilo-activity-helper.app',
      'Contents',
      'MacOS',
      'EiloActivityHelper',
    );
    if (!exists(collector) || !exists(helper)) {
      requireFile(
        exists,
        '/usr/bin/xcrun',
        'Xcode Command Line Tools are required. Run: xcode-select --install',
      );
      if (!exists(collector))
        run(spawn, atRoot('scripts', 'build-context-collector'), [], projectRoot);
      if (!exists(helper)) run(spawn, atRoot('scripts', 'build-activity-helper'), [], projectRoot);
    }
    run(spawn, electron, ['.'], atRoot('desktop', 'electron'));
    return;
  }
  throw new Error('Usage: node scripts/dev.mjs setup|dev|start');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runDevelopment(process.argv[2]);
  } catch (error) {
    process.stderr.write(`felis startup: ${error.message}\n`);
    process.exitCode = 1;
  }
}

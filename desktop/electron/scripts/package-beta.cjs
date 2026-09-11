'use strict';

// Stages an inspectable beta payload. It intentionally does not make the
// current checkout-launching Electron host look like a distributable release.
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const { packager } = require('@electron/packager');
const { copyTrackedWorkspace, readPolicy } = require('./source-boundary.cjs');

const root = path.resolve(__dirname, '../../..');
const output = path.join(root, '.runtime', 'beta-build');
const workspace = path.join(output, 'workspace');
const release = process.argv.includes('--release');

function fail(message) {
  throw new Error(message);
}
function write(relative, contents, mode = 0o600) {
  const target = path.join(output, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, contents, { mode });
}
function signingIdentity() {
  const identity = process.env.EILO_SIGNING_IDENTITY;
  if (!identity)
    fail(
      'Release requested without EILO_SIGNING_IDENTITY. No signing or notarization was attempted.',
    );
  const result = childProcess.spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8',
  });
  if (result.status !== 0 || !result.stdout.includes(identity))
    fail('Requested signing identity is unavailable. No release artifact was created.');
  return identity;
}
function runtimeStatus() {
  const manifestPath = path.join(root, '.runtime/beta-managed-python/runtime-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (
    manifest.target !== 'macos-14' ||
    manifest.architecture !== 'arm64' ||
    manifest.hermes_revision !== '2237be355906fbe6065ce1815711eee52b2d646e'
  )
    fail('The managed runtime does not match the beta contract.');
  return { ready: true };
}
function verifyStage() {
  const result = childProcess.spawnSync(
    'python3',
    [path.join(root, 'scripts', 'verify-beta-runtime.py'), '--stage', output],
    { encoding: 'utf8' },
  );
  if (result.status !== 0)
    fail(`Beta staging verification failed: ${(result.stderr || result.stdout).trim()}`);
}

async function main() {
  try {
    const identity = release ? signingIdentity() : null;
    if (process.platform !== 'darwin' || process.arch !== 'arm64')
      fail('This beta builder targets Apple Silicon Macs.');
    const notaryProfile = release ? process.env.EILO_NOTARY_KEYCHAIN_PROFILE : null;
    if (release && !notaryProfile)
      fail('Release requires EILO_NOTARY_KEYCHAIN_PROFILE. No notarization was attempted.');
    const runtime = runtimeStatus();
    fs.rmSync(output, { recursive: true, force: true });
    fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
    const copied = copyTrackedWorkspace(root, workspace, readPolicy(root));
    if (!copied.includes('config/source-boundary.json'))
      fail('source-boundary policy is not tracked; refusing to create a beta workspace.');
    const managedRuntime = path.join(root, '.runtime', 'beta-managed-python');
    if (!fs.existsSync(path.join(managedRuntime, 'run-python')))
      fail('Managed beta runtime is missing. Run scripts/build-beta-runtime first.');
    fs.cpSync(managedRuntime, path.join(output, 'runtime'), {
      recursive: true,
      dereference: false,
    });
    const collector = path.join(root, '.runtime', 'eilo-context-collector', 'EiloContextCollector');
    if (!fs.existsSync(collector))
      fail('Native context collector is missing. Run scripts/build-context-collector first.');
    fs.mkdirSync(path.join(output, 'runtime', 'eilo-context-collector'), { recursive: true });
    fs.copyFileSync(
      collector,
      path.join(output, 'runtime', 'eilo-context-collector', 'EiloContextCollector'),
    );
    write(
      'eilo-bundle.json',
      JSON.stringify(
        {
          workspace: 'workspace',
          runtime: 'runtime',
          target: 'macos-14',
          architecture: process.arch,
        },
        null,
        2,
      ) + '\n',
    );
    // Required notices are deliberately copied, rather than inferred from package metadata.
    const licenses = path.join(workspace, 'licenses');
    fs.mkdirSync(licenses, { recursive: true, mode: 0o700 });
    fs.copyFileSync(
      path.join(root, '.runtime', 'hermes-agent', 'LICENSE'),
      path.join(licenses, 'HERMES-LICENSE'),
    );
    fs.copyFileSync(
      path.join(root, 'desktop/electron/node_modules/electron/LICENSE'),
      path.join(licenses, 'ELECTRON-LICENSE'),
    );
    write(
      'beta-build.json',
      JSON.stringify(
        {
          format: 1,
          target: 'macos-14',
          architecture: process.arch,
          signing: identity ? 'pending' : 'unsigned-inspectable',
          runtime: runtime.ready ? 'managed' : 'blocked',
        },
        null,
        2,
      ) + '\n',
    );
    // Check copied sources and the managed runtime before packager can sign or notarize anything.
    verifyStage();
    const apps = await packager({
      dir: path.join(workspace, 'desktop/electron'),
      name: 'eïlo Beta',
      platform: 'darwin',
      arch: process.arch,
      electronVersion: require('../package.json').devDependencies.electron,
      out: path.join(output, 'app'),
      overwrite: true,
      asar: true,
      appBundleId: 'app.eilo.desktop.beta',
      icon: path.join(workspace, 'desktop/electron/assets/icon.icns'),
      extraResource: [
        path.join(output, 'workspace'),
        path.join(output, 'runtime'),
        path.join(output, 'eilo-bundle.json'),
      ],
      ignore: [/\.test\.cjs$/, /node_modules/],
      extendInfo: { LSMinimumSystemVersion: '14.0', NSHighResolutionCapable: true },
      ...(release
        ? {
            osxSign: { identity, optionsForFile: () => ({ hardenedRuntime: true }) },
            osxNotarize: { keychainProfile: notaryProfile },
          }
        : {}),
    });
    verifyStage();
    process.stdout.write(`${apps[0]}\n`);
    if (release) {
      const bundle = path.join(apps[0], 'eïlo Beta.app');
      for (const [command, args] of [
        ['codesign', ['--verify', '--deep', '--strict', bundle]],
        ['xcrun', ['stapler', 'validate', bundle]],
        ['spctl', ['--assess', '--type', 'execute', bundle]],
      ]) {
        const result = childProcess.spawnSync(command, args, { stdio: 'inherit' });
        if (result.status !== 0)
          fail(`${command} verification failed; do not distribute this build.`);
      }
      write(
        'beta-build.json',
        JSON.stringify(
          {
            format: 1,
            target: 'macos-14',
            architecture: 'arm64',
            runtime: 'managed',
            signing: 'notarized-verified',
          },
          null,
          2,
        ) + '\n',
      );
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
main();

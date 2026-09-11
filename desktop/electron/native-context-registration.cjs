'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ID = 'clbapkcnonmjmmkjfeaonpjcepelimae';
const quote = (value) => `'${String(value).replace(/'/g, `'"'"'`)}'`;
function extensionId(key) {
  return [
    ...crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16),
  ]
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
    .join('');
}
function write(file, value, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, value, { mode });
  fs.chmodSync(file, mode);
}
function registrationPaths({ resourcesPath, workspacePath, pythonPath }) {
  if (resourcesPath)
    return {
      workspace: path.join(resourcesPath, 'workspace'),
      python: path.join(resourcesPath, 'runtime', 'run-python'),
    };
  if (!path.isAbsolute(workspacePath || '') || !path.isAbsolute(pythonPath || ''))
    throw new Error('The eïlo native context host requires absolute local runtime paths.');
  return { workspace: workspacePath, python: pythonPath };
}
function registerNativeContext({
  userData,
  dataHome = userData,
  resourcesPath,
  workspacePath,
  pythonPath,
  home = process.env.HOME,
  manifestPath,
}) {
  const { workspace, python } = registrationPaths({ resourcesPath, workspacePath, pythonPath });
  const key = JSON.parse(
    fs.readFileSync(path.join(workspace, 'activity/extension/manifest.json')),
  ).key;
  if (extensionId(key) !== ID)
    throw new Error('Bundled extension identity does not match its public configuration.');
  const root = path.join(userData, 'native-host'),
    wrapper = path.join(root, 'app.eilo.context');
  write(
    wrapper,
    `#!/bin/sh\nset -eu\nEILO_DATA_HOME=${quote(dataHome)}\nexport EILO_DATA_HOME\nexec ${quote(python)} ${quote(path.join(workspace, 'scripts/native-context-host'))} "$@"\n`,
    0o700,
  );
  const origin = `chrome-extension://${ID}/`;
  const target =
    manifestPath ||
    path.join(
      home,
      'Library/Application Support/Google/Chrome/NativeMessagingHosts/app.eilo.context.json',
    );
  write(
    target,
    JSON.stringify(
      {
        name: 'app.eilo.context',
        description: 'eïlo local context bridge',
        path: wrapper,
        type: 'stdio',
        allowed_origins: [origin],
      },
      null,
      2,
    ) + '\n',
    0o600,
  );
  write(
    path.join(dataHome, 'context/allowed-origins.json'),
    JSON.stringify({ allowed_origins: [origin] }) + '\n',
    0o600,
  );
  return { status: 'registered' };
}
module.exports = { ID, extensionId, registerNativeContext };

'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  test = require('node:test');
const { ID, extensionId, registerNativeContext } = require('./native-context-registration.cjs');
test('registers only the fixed public extension identity in private temporary paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eilo native ')),
    resources = path.join(root, 'res q'),
    home = path.join(root, 'home');
  fs.mkdirSync(path.join(resources, 'workspace/activity/extension'), { recursive: true });
  fs.mkdirSync(path.join(resources, 'runtime'), { recursive: true });
  const key =
    'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAldLQInPgquaLKs5WcwuH1JdvyFC4eX+FTn5oU0ShwXZDfiVjLVlgjNXrNgitD8NQHukAmjW2Xii9VJuWXZtq3zUn67f5lyhSt0v8IXVivT9pAq2oxIqbARJ5yGJRfRGsW27mE+JlXo6LI1ofPjqq5tQWKAHh4YEvA8nkiJDFp8Syz0TYY+Amos8+FsiLpXf8C0fzPHFPgNaT96kLdMGWzfi5hyQLcQIvalfv6AC6GqRX0UvFxntgbGCdi6JmCvd6IHWBy543QA9QcUjR2MnFBW02vKD1iXagvpOqmAdaE5A2w6chry2wUp8xdzbDC298FD8+CiUZYGJlcMUrrdAIUQIDAQAB';
  assert.equal(extensionId(key), ID);
  fs.writeFileSync(
    path.join(resources, 'workspace/activity/extension/manifest.json'),
    JSON.stringify({ key }),
  );
  const target = path.join(root, 'manifest.json');
  registerNativeContext({
    userData: path.join(root, "user ' data"),
    resourcesPath: resources,
    home,
    manifestPath: target,
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(target)).allowed_origins, [
    `chrome-extension://${ID}/`,
  ]);
  assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  assert.ok(fs.existsSync(path.join(root, "user ' data", 'context/allowed-origins.json')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('registers the development checkout bridge with its project runtime and state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eilo native development ')),
    workspace = path.join(root, 'checkout'),
    userData = path.join(workspace, '.state', 'desktop', 'profile'),
    dataHome = path.join(workspace, '.state'),
    python = path.join(workspace, '.runtime', 'venv', 'bin', 'python'),
    manifestPath = path.join(root, 'manifest.json');
  fs.mkdirSync(path.join(workspace, 'activity/extension'), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, 'activity/extension/manifest.json'),
    JSON.stringify({
      key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAldLQInPgquaLKs5WcwuH1JdvyFC4eX+FTn5oU0ShwXZDfiVjLVlgjNXrNgitD8NQHukAmjW2Xii9VJuWXZtq3zUn67f5lyhSt0v8IXVivT9pAq2oxIqbARJ5yGJRfRGsW27mE+JlXo6LI1ofPjqq5tQWKAHh4YEvA8nkiJDFp8Syz0TYY+Amos8+FsiLpXf8C0fzPHFPgNaT96kLdMGWzfi5hyQLcQIvalfv6AC6GqRX0UvFxntgbGCdi6JmCvd6IHWBy543QA9QcUjR2MnFBW02vKD1iXagvpOqmAdaE5A2w6chry2wUp8xdzbDC298FD8+CiUZYGJlcMUrrdAIUQIDAQAB',
    }),
  );
  registerNativeContext({
    userData,
    dataHome,
    workspacePath: workspace,
    pythonPath: python,
    manifestPath,
  });
  const wrapper = fs.readFileSync(path.join(userData, 'native-host', 'app.eilo.context'), 'utf8');
  assert.match(wrapper, new RegExp(`EILO_DATA_HOME='${dataHome}'`));
  assert.match(
    wrapper,
    new RegExp(`exec '${python}' '${path.join(workspace, 'scripts/native-context-host')}'`),
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).allowed_origins, [
    `chrome-extension://${ID}/`,
  ]);
  assert.ok(fs.existsSync(path.join(dataHome, 'context', 'allowed-origins.json')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('rejects a development bridge without absolute runtime paths', () => {
  assert.throws(
    () =>
      registerNativeContext({
        userData: '/private/profile',
        workspacePath: 'checkout',
        pythonPath: 'python',
      }),
    /absolute local runtime paths/,
  );
});

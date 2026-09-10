/** Discover only owned test suites; never recurse into a runtime or dependency tree. */
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const suites = ['web', 'tests', 'desktop/electron'];
const files = [];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__pycache__') continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(target);
    else if (/\.test\.(?:js|mjs|cjs)$/.test(entry.name)) files.push(target);
  }
}

await Promise.all(suites.map((suite) => collect(path.join(root, suite))));
if (!files.length) throw new Error('No JavaScript tests found. Check the test suite paths.');
const result = spawnSync(process.execPath, ['--test', ...files.sort()], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const installed = JSON.parse(await readFile(new URL('node_modules/three/package.json', root)));
const project = JSON.parse(await readFile(new URL('package.json', root)));
if (installed.version !== project.dependencies.three)
  throw new Error('Three.js version must be pinned.');
const target = new URL('web/vendor/three/', root);
await mkdir(target, { recursive: true });
for (const file of ['three.core.min.js', 'three.module.min.js'])
  await copyFile(new URL('node_modules/three/build/' + file, root), new URL(file, target));
await copyFile(new URL('node_modules/three/LICENSE', root), new URL('LICENSE', target));
await writeFile(
  new URL('NOTICE.md', target),
  '# Three.js ' +
    installed.version +
    '\n\nUnmodified core and WebGL ES module builds from the pinned npm package.\nLoaded locally when the adapted noRot orb is visible.\n\n[Upstream source](https://github.com/mrdoob/three.js/tree/r183) · [MIT license](LICENSE)\n\nRefresh with: node scripts/vendor-orb.mjs\n',
);
process.stdout.write('Vendored Three.js ' + installed.version + '\n');

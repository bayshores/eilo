import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const installed = JSON.parse(await readFile(new URL('node_modules/gsap/package.json', root)));
const project = JSON.parse(await readFile(new URL('package.json', root)));
if (installed.version !== project.dependencies.gsap)
  throw new Error('GSAP version must be pinned.');
const target = new URL('web/vendor/gsap/', root);
await mkdir(target, { recursive: true });
for (const file of ['gsap.min.js', 'Flip.min.js'])
  await copyFile(new URL(`node_modules/gsap/dist/${file}`, root), new URL(file, target));
await writeFile(
  new URL('NOTICE.md', target),
  `# GSAP ${installed.version}\n\nUnmodified GSAP core and Flip distributions from the pinned public npm package.\nCopyright notices remain in the distributed files.\n\n[GSAP standard license](https://gsap.com/community/standard-license/)\n`,
);
process.stdout.write(`Vendored GSAP ${installed.version} in ${fileURLToPath(target)}\n`);

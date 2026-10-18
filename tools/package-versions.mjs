// The packages' versions of each other: each @moonbase-machines dependency set to the release's version, so
// that @moonbase-machines/c64 0.42.0 depends on @moonbase-machines/mos6502 0.42.0. Run by pk changelog after it stamps
// the packages' own versions (.pk.json changelog.hooks.postVersion, with $VERSION).
//
//   node tools/package-versions.mjs <version>
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2] ?? process.env.VERSION;
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error(`package-versions: a version, not ${version}`);
for (const name of ['mos6502', 'charset', 'files', 'c64', 'apple2e', 'vector', 'player']) {
  const file = new URL(`../packages/${name}/package.json`, import.meta.url), pkg = JSON.parse(readFileSync(file, 'utf8'));
  for (const dep of Object.keys(pkg.dependencies ?? {})) if (dep.startsWith('@moonbase-machines/')) pkg.dependencies[dep] = version;
  writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
}
console.log(`packages' @moonbase-machines dependencies: ${version}`);

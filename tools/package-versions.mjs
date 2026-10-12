// The packages' versions of each other: each @moonbase dependency set to the release's version, so
// that @moonbase/c64 0.42.0 depends on @moonbase/6502 0.42.0. Run by pk changelog after it stamps
// the packages' own versions (.pk.json changelog.hooks.postVersion, with $VERSION).
//
//   node tools/package-versions.mjs <version>
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2] ?? process.env.VERSION;
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error(`package-versions: a version, not ${version}`);
for (const name of ['6502', 'charset', 'c64', 'apple2e']) {
  const file = new URL(`../packages/${name}/package.json`, import.meta.url), pkg = JSON.parse(readFileSync(file, 'utf8'));
  for (const dep of Object.keys(pkg.dependencies ?? {})) if (dep.startsWith('@moonbase/')) pkg.dependencies[dep] = version;
  writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
}
console.log(`packages' @moonbase dependencies: ${version}`);

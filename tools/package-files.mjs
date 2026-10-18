// One file a package: packages/<name>/dist/moonbase-<name>.js for @moonbase-machines/mos6502, charset, c64 and
// apple2e, built by esbuild: the package's own modules, each a namespace of the file's exports as its
// index.js has them, minified, with a source map and the MIT notice; the other packages it uses
// imported by name ('@moonbase-machines/mos6502'), from their own files. A module of another package,
// '@moonbase-machines/mos6502/cpu.js', is answered from that package's file, its namespace there.
//
//   node tools/package-files.mjs [name ...]       the files, every package's unless named; each package's own
//                                                 before it is packed or published (its prepack script), so
//                                                 the file it is published with is its own code and version
//
// The same plugin, asFiles(), lets a page's bundle import the machines from their files by name.
import { build } from 'esbuild';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url).pathname;
export const PACKAGES = ['mos6502', 'charset', 'c64', 'apple2e', 'vector', 'player'];   // (files is Node's alone: no file of its own for a page)
const pkg = name => JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'));
export const MIT = name => `/*! @moonbase-machines/${name} ${pkg(name).version}: MIT, (c) 2026 Mark Wharton (its LICENSE) */`;
export const common = { bundle: true, format: 'esm', minify: true, sourcemap: 'linked', target: 'es2022', logLevel: 'warning', legalComments: 'inline', external: ['node:*'] };

// (a module of a package, '@moonbase-machines/c64/machine.js', answered from the package's one file: its
// namespace there, 'machine', each name the module exports taken from it; every name a module
// exports is a const, a function or a class, never a variable that changes)
const exported = new Map();
const names = async (name, file) => {
  const key = `${name}/${file}`;
  if (!exported.has(key)) exported.set(key, Object.keys(await import(join(root, 'packages', name, file))));
  return exported.get(key);
};
// (a module in a folder of its package named with it: remake/main.js, remakeMain)
const namespace = file => file.replace(/\.js$/, '').replace(/[-/](.)/g, (_, c) => c.toUpperCase()).replace(/^(\d)/, '_$1');
export const asFiles = except => ({
  name: 'moonbase-packages',
  setup(b) {
    b.onResolve({ filter: /^@moonbase-machines\/[^/]+(\/.+)?$/ }, a => {
      const [, name, file] = a.path.match(/^@moonbase-machines\/([^/]+)(?:\/(.+))?$/);
      if (name === except) return undefined;
      return file ? { path: `${name}/${file}`, namespace: 'moonbase-module' } : { path: `@moonbase-machines/${name}`, external: true };
    });
    b.onLoad({ filter: /.*/, namespace: 'moonbase-module' }, async a => {
      const [name, file] = [a.path.slice(0, a.path.indexOf('/')), a.path.slice(a.path.indexOf('/') + 1)];
      const ns = namespace(file), list = await names(name, file);
      return { contents: `import { ${ns} as m } from '@moonbase-machines/${name}';\n${list.length ? `export const { ${list.join(', ')} } = m;` : ''}`, loader: 'js', resolveDir: root };
    });
  },
});


export async function packageFiles(names = PACKAGES) {
  for (const name of names)
    await build({ ...common, entryPoints: [join(root, 'packages', name, 'index.js')], outfile: join(root, 'packages', name, 'dist', `moonbase-${name}.js`), banner: { js: MIT(name) }, plugins: [asFiles(name)] });
  return names.map(p => `packages/${p}/dist/moonbase-${p}.js`);
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const names = process.argv.slice(2);
  for (const n of names) if (!PACKAGES.includes(n)) throw new Error(`package-files: no file for ${n}`);
  console.log((await packageFiles(names.length ? names : PACKAGES)).join(', '));
}

#!/usr/bin/env node
// A title's scene scripts compiled to JavaScript (remake/compile.js): each <name>.scene in the title's folder written
// as compiled/<name>.js beside it, which the remake runs.
//
//   moonbase-compile <title folder> ...            every scene of each
//   moonbase-compile --check <title folder> ...    says which compiled script is not its scene's, and fails
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compile } from '../remake/compile.js';

const args = process.argv.slice(2), check = args.includes('--check'), folders = args.filter(a => a !== '--check');
if (!folders.length) { console.error('moonbase-compile [--check] <title folder> ...'); process.exit(1); }
let stale = 0, written = 0;
for (const folder of folders) {
  const dir = pathToFileURL(resolve(folder) + '/'), io = (await import(new URL('title.js', dir))).default.io;
  for (const f of readdirSync(dir).filter(f => f.endsWith('.scene'))) {
    const name = f.slice(0, -6), js = compile(readFileSync(new URL(f, dir), 'utf8'), name, io ? { io } : undefined), out = new URL('compiled/' + name + '.js', dir);
    if (existsSync(out) && readFileSync(out, 'utf8') === js) continue;
    if (check) { console.log(`${folder}/compiled/${name}.js is not compiled from ${f}`); stale++; } else { mkdirSync(new URL('compiled/', dir), { recursive: true }); writeFileSync(out, js); written++; }
  }
}
if (check) { if (stale) process.exit(1); } else console.log(`${written} compiled`);

// One way to start a title's remake, for the remake's page (main.js), a replay and Node (a pilot's observer): the
// title's title.js, from the folder it is in, with the modules it names (its problems, its paint); its scripts,
// compiled to JavaScript (bin/moonbase-compile.mjs) or, with `scenes`, the scene files themselves to run line by line;
// its game's data, from where the page keeps it; and an engine made from them.
//
//   const { title, scripts, disk, folder } = await loadTitle(folder, { data })
//     folder   the title's folder, an absolute URL (its title.js, its scenes, compiled/, its own modules)
//     data     its game's data, an absolute URL (<slug>.json: its disks' files, its kind, its saves)
//   title.disk = disk; title.seed = 17                 (the caller's: a data disk, the seed)
//   const engine = makeEngine(title, scripts)
// With `fixed`, a title that has a version with its bugs fixed (its title.js `fixed`, a script for each it replaces)
// runs those scripts in place of its own. A title whose engine is its own (its title.js `engine` the name of a module
// in its folder, not 'card' or 'vector') has no scripts here: its engine is loaded with its other modules, as
// `title.own`, and runs the game itself (main.js).
import { Engine } from './engine.js';
import { vectorRoutines } from './vector.js';
import { cardRoutines } from './card.js';
import { started } from '@moonbase-machines/apple2e/prodos.js';

const ENGINES = { vector: vectorRoutines, card: cardRoutines };

// a file read in the browser by fetch, and in Node from the disk (Node's own fs, asked of Node itself, so that the
// browser's files import nothing of Node's)
async function read(url, as) {
  if (url.protocol === 'file:') { const text = globalThis.process.getBuiltinModule('node:fs').readFileSync(url, 'utf8'); return as === 'json' ? JSON.parse(text) : text; }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url.pathname}: ${r.status}`);
  return as === 'json' ? r.json() : r.text();
}
const defaultOf = async url => (await import(url.href)).default;

export async function loadTitle(folder, { data, scenes = false, fixed = false } = {}) {
  folder = new URL(folder);
  const title = { ...(await defaultOf(new URL('title.js', folder))) };
  // the modules a title has of its own, as its title.js names them (problems.js, paint.js), and its view's own
  // drawing (view.js), where it says it has one
  for (const name of title.modules ?? []) title[name] = await defaultOf(new URL(name + '.js', folder));
  if (title.view) title.viewSteps = await defaultOf(new URL('view.js', folder));
  if (!ENGINES[title.engine]) {
    title.own = await import(new URL(title.engine + '.js', folder).href);
    return { title, scripts: {}, disk: null, folder };
  }
  const scripts = Object.fromEntries(await Promise.all(title.scripts.map(async n =>
    [n, scenes ? await read(new URL(n + '.scene', folder), 'text') : await defaultOf(new URL(`compiled/${(fixed && title.fixed?.[n]) || n}.js`, folder))])));
  const disk = await read(new URL(data), 'json');
  return { title, scripts, disk, folder };
}

export function makeEngine(title, scripts) {
  // (a ProDOS title's memory starts with what ProDOS leaves, as the original's does)
  const memory = { ...(title.disk?.kind === 'prodos' ? started(title.disk) : {}), ...title.memory };
  const engine = new Engine({ routines: ENGINES[title.engine](title), scripts, start: title.start, label: title.startLabel, memory });
  engine.title = title;
  return engine;
}

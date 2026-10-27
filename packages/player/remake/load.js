// One way to start a title's remake, for the player (play.js), a replay and Node (a pilot's observer): the
// title's title.js, from the folder it is in, with the modules it names (its problems, its paint); its scripts, each
// scene compiled as it arrives (compile.js), or with `interpret` the scene's text itself, run line by line, or a
// program the driver says the player makes from the disk (programs.js: a BASIC program, Blitz!'s or BASIC's own);
// its game's data, from where the page keeps it; and an engine made from them.
//
//   const title = await titleOf(folder)                 the title alone: its title.js and the modules it names
//   const { title, scripts, disk, folder } = await loadTitle(folder, { data })
//     folder   the title's folder, an absolute URL (its title.js, its scenes, its own modules)
//     data     its game's data, an absolute URL (<slug>.json: its disks' files, its kind, its saves)
//   title.disk = disk; title.seed = 17                 (the caller's: a data disk, the seed)
//   const engine = makeEngine(title, scripts)
// With `fixed`, a title that has a version with its bugs fixed (its title.js `fixed`, the name of the fixed version of
// each program it replaces, made with the title's `fixes`) runs that in place of its own. A title whose engine is its
// own (its title.js `engine` the name of a module in its folder, not 'card' or 'vector') has no scripts here: its
// engine is loaded with its other modules, as `title.own`, and runs the game itself (play.js).
import { Engine } from './engine.js';
import { vectorRoutines } from './vector.js';
import { cardRoutines } from './card.js';
import { started } from '@moonbase-machines/apple2e/prodos.js';
import { instantiate } from './compile.js';
import { program } from './programs.js';

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

export async function titleOf(folder) {
  folder = new URL(folder);
  const title = { ...(await defaultOf(new URL('title.js', folder))) };
  // the modules a title has of its own, as its title.js names them (problems.js, paint.js), and its view's own
  // drawing (view.js), where it says it has one
  for (const name of title.modules ?? []) title[name] = await defaultOf(new URL(name + '.js', folder));
  if (title.view) title.viewSteps = await defaultOf(new URL('view.js', folder));
  return title;
}

export async function loadTitle(folder, { data, interpret = false, fixed = false } = {}) {
  folder = new URL(folder);
  const title = await titleOf(folder);
  if (!ENGINES[title.engine]) {
    title.own = await import(new URL(title.engine + '.js', folder).href);
    return { title, scripts: {}, disk: null, folder };
  }
  const disk = await read(new URL(data), 'json');
  // a script the driver says is a BASIC program on the disk (its `basic[name].program`), made from the disk, with
  // `fixed` its fixed version; the rest the title's scenes, each compiled as it arrives, or with `interpret` the scene's
  // text, run line by line (the tools' per-line coverage)
  const io = title.io ? { io: title.io } : undefined;
  const scripts = Object.fromEntries(await Promise.all(title.scripts.map(async n => {
    const basic = title.basic?.[n];
    if (basic?.program) return [n, await program(title, disk, n, basic, (fixed && title.fixed?.[n]) || false, folder)];
    const scene = await read(new URL(n + '.scene', folder), 'text');
    return [n, interpret ? scene : instantiate(scene, n, io)];
  })));
  return { title, scripts, disk, folder };
}

export { read };

export function makeEngine(title, scripts) {
  // (a ProDOS title's memory starts with what ProDOS leaves, as the original's does)
  const memory = { ...(title.disk?.kind === 'prodos' ? started(title.disk) : {}), ...title.memory };
  const engine = new Engine({ routines: ENGINES[title.engine](title), scripts, start: title.start, label: title.startLabel, memory });
  engine.title = title;
  return engine;
}

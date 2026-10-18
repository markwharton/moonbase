// The remake in the browser: one player for every title. The page gives it the title's folder and its game's data;
// the player makes its part of the page, the stage the game is drawn on and the options line under it with the
// game's status, loads the title (load.js), puts its stylesheet in the page where it has one, and hands the game to
// its engine: the remake's own for a title of scenes, 'card' or 'vector' (scenes.js), or the title's own, a module in
// its folder (its title.js `engine`), given the same. A failure is said in the status line.
//
//   await play({ title, data, root, disk, preview, words, watch, claim, pace, route, mini, roms })
//     title      the title's folder, an absolute URL
//     data       its game's data, an absolute URL (for a title of its own engine, the folder its data is in)
//     root       the page's section the player is made in
//     disk       the title's player's disk (disk/disk.js), opened before the player starts
//     preview    the preview's build: what only it has may be used
//     words      the page's words the player shows: { printer: { line, print, tear } }
//     watch      called with the game, { engine, press, quick }, for a page that follows it
//     claim      k => true to take a key of the player's before the game does
//     pace       how much of the original's waits: 1 all (the default), 0 none, between a part of each; read at
//                each wait
//   and what only a workshop has, given by its pages, never looked for here:
//     route      a route to play first, { route, keys }: its keys, and the pilots' key handling (expand, give,
//                petscii, pollsAt)
//     mini       a mini view for a title with an `inset`, (at, { memory }) => { mode(m) }
//     roms       the makers' ROMs this machine has: { chargen } for a Commodore 64 title's characters
//
// What the engine is handed, its own engine's or the remake's, `game`: { title, scripts, disk, folder, stage,
// options, status, fail, kept, preview, words, ...the page's options }; `stage` is its to draw in, `options` the
// line its own controls go on, before the status.
import { loadTitle } from './load.js';
import { play as scenes } from './scenes.js';

export async function play(options) {
  const { title: folder, data, root, disk: kept, preview = false, words } = options;
  root.classList.add('remake');
  root.innerHTML = '<div class="stage"></div><p class="options"><span id="status">Loading.</span></p>';
  const stage = root.querySelector('.stage'), line = root.querySelector('.options'), status = root.querySelector('#status');
  const fail = err => { status.textContent = 'The remake stopped: ' + err.message; status.className = 'error'; console.error(err); };
  try {
    // ?fixed: the title with its bugs fixed, for one that has such a version (its title.js `fixed`)
    const fixed = new URLSearchParams(location.search).has('fixed');
    const { title, scripts, disk } = await loadTitle(folder, { data, fixed });
    title.disk = disk;
    // the title's own styles, where it has them (its title.js `style`, a file in its folder), in place before it
    // draws by them
    if (title.style && !document.querySelector(`link[data-title="${title.slug}"]`)) {
      const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL(title.style, folder).href });
      link.dataset.title = title.slug; document.head.append(link);
      await new Promise(done => { link.onload = link.onerror = done; });
    }
    const game = { ...options, title, scripts, disk, folder, data, stage, options: line, status, fail, kept, preview, words, fixed };
    await (title.own ?? { play: scenes }).play(game);
  } catch (err) { fail(err); }
}

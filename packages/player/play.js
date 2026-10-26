// The player: one way in for every title and every way to play it, the Original (the game's own disk on the machine
// it was made for) and the Remake (its scenes on the remake's engine, or the title's own engine). The player makes its
// part of the page and owns it, the same for all: the section and its classes, the stage and its size, the options
// line and the status, the keys, the sound, the printer, the saves on the title's disk, and what the page asks of it;
// the engine plays the game on the stage and does nothing of the page's. The page tells the player everything: the
// disk and the settings are the page's to give (its provider, provider.js), and the player reads no address and
// keeps nothing in the browser itself.
//
//   await play({ way, slug, title, data, root, disk, settings, preview, words, screen, watch, claim, pace, keys,
//                route, mini, roms, studies, downloadDisk })
//     way          'original' or 'remake' (the default)
//     slug         the title's name in addresses: its section's class, its disk
//     title        the title's folder, an absolute URL (title.js, its scenes, compiled/, its own modules), where it
//                  has one; a game without one (a study) has only its data
//     data         its game's data, an absolute URL (<name>.json: its disks' files, its kind, its saves), or for a
//                  title of its own engine the folder its data is in
//     root         the page's section the player is made in
//     disk         the title's disk (disk/disk.js `openDisk`, `title/<slug>`), the page's to open where it keeps files
//     settings     the person's settings, the page's typed store (settings.js): each declared setting's value, kept
//     preview      the preview's build: what only it has may be used
//     words        the page's words the player shows: { printer: { line, print, tear } }
//     screen       [width, height], the screen's shape in its own dots where the page draws its own over it
//   and what a page that follows the game asks:
//     watch        called with { engine, press, quick } once the game is ready: its engine (where it has one), a key
//                  pressed as the player presses one, and the game at full speed or not
//     claim        k => true to take a key of the player's before the game does
//     pace         how much of the original's waits: 1 all (the default), 0 none, between a part of each; a number or
//                  a function, read at each wait
//   and what only a workshop has, given by its pages, never looked for here:
//     keys         keys to press at the start, by name (space, return, left...), to go straight to a scene
//     route        a route to play first, { name, route, keys }: its keys, and the pilots' key handling
//     mini         a mini view for a title with an `inset`, (at, { memory }) => { mode(m) }
//     roms         the makers' ROMs this machine has (engines/original.js; a Commodore 64 remake's { chargen })
//     studies      files of its own for a Commodore 64 game's disk, in the drive, not kept
//     downloadDisk a Commodore 64 game's disk offered to download, with what is saved on it
//   and, from the game's data (data.js `demonstrations`), where the engine can type them: a button for each
//   demonstration, its name, typing its steps into the game as the keys would be; the person's first key ends it.
//
// An engine (engines/original.js, engines/scenes.js, or the title's own, its title.js `engine` a module in its folder)
// exports `play(game)`: given `game`, the player's own for it (below), it declares the settings it acts on
// (`game.setting(declaration)`, settings.js, each shown only so), makes what it draws on the stage and returns
// its handle, or nothing where it cannot start (and has said why in the status):
//   { run(), press(k)?, key(e, k)?, keys(list)?, route(route)?, start()?, sound(on)?, quick(on)?,
//     demonstrate(steps)?, engine?, diskImage()? }
// run() starts it; press(k) a key, the machine's code (none for a title of its own engine with no machine's keys,
// which reads the keyboard itself); key(e, k), for an engine that reads the keyboard itself, each
// keydown and keyup with its code (undefined where the machine has none); keys(list), the page's `keys` at the start;
// route, the page's route; start(), at the player's first gesture (sound may start only then); sound(on), the
// player's speaker on or off (the Sound setting; a game's own sound setting stays the game's); quick(on) the game at
// full speed; demonstrate(steps), a demonstration's steps typed into the game; engine, what `watch` gives a page;
// diskImage(), the disk to download.
import { titleOf, loadTitle, read } from './remake/load.js';
import { savesFor } from './saves.js';
import { code, named } from './keys.js';
import { paperBox, phoneKeys, KEYS_MARKUP } from './parts.js';

// each machine's screen, in its own dots: an Apple's hi-res page, a Commodore 64's frame, border and all
const SCREENS = { prodos: [280, 192], dos33: [280, 192], c64: [384, 272] };
const ENGINES = { original: () => import('./engines/original.js'), card: () => import('./engines/scenes.js'), vector: () => import('./engines/scenes.js') };
// the settings the player itself acts on (settings.js): the speaker; a Commodore 64's printer; a title's version with
// its bugs fixed
const SOUND = { name: 'sound', type: 'boolean', default: true, owner: 'person', words: 'Sound' };
const PRINTER = { name: 'printer', type: 'boolean', default: true, owner: 'person', words: 'Printer' };
const FIXED = { name: 'fixed', type: 'boolean', default: false, owner: 'person', words: 'Bugs fixed', title: 'The game with its bugs fixed: it starts again' };

export async function play(options) {
  const { way = 'remake', slug, root, disk, settings, preview = false, words } = options;
  root.classList.add('player', way);
  if (slug) root.classList.add(slug);
  root.innerHTML = `<div class="stage"></div><p class="options"><span id="status">Loading.</span>${KEYS_MARKUP}<span class="settings"></span>`
    + '<button id="disk" type="button" hidden>Download the disk</button></p>';
  root.append(paperBox(words.printer));
  const $ = id => root.querySelector('#' + id);
  const stage = root.querySelector('.stage'), status = $('status'), line = root.querySelector('.options .settings');
  const fail = err => { status.textContent = 'The game stopped: ' + err.message; status.className = 'error'; console.error(err); };
  // A setting the player or its engine acts on, by its declaration (settings.js): its value from the page's store,
  // and its control on the options line where the page offers it, a box for a boolean, a menu for an enum, each
  // change kept and told; `first`, before the others (the sound)
  const setting = (def, { first = false } = {}) => {
    const s = { value: settings.get(def), told: [], on(f) { this.told.push(f); return this; } };
    if (!settings.offered(def)) return s;
    const label = document.createElement('label'), choice = Array.isArray(def.type);
    if (def.title) label.title = def.title;
    const control = choice
      ? Object.assign(document.createElement('select'), { innerHTML: def.type.map((v, i) => `<option value="${v}">${def.labels[i]}</option>`).join('') })
      : Object.assign(document.createElement('input'), { type: 'checkbox' });
    control.id = def.name;
    if (choice) { control.value = s.value; label.append(def.words + ' ', control); } else { control.checked = s.value; label.append(control, ' ' + def.words); }
    control.addEventListener('change', () => { s.value = choice ? control.value : control.checked; settings.set(def, s.value); for (const f of s.told) f(s.value); });
    line[first ? 'prepend' : 'append'](label);
    return s;
  };
  try {
    if (!disk || !settings) throw new Error('the page gives the player its disk and its settings');
    // the title with its bugs fixed, for one that has such a version (its title.js `fixed`), a setting: its scripts
    // chosen as it loads, so a change loads the page again
    const fixed = settings.get(FIXED);
    const folder = options.title ? new URL(options.title) : null, data = new URL(options.data);
    // the title, and for its remake its scripts; the game's data (none here for a title of its own engine, which
    // reads its own from its folder)
    let title = null, scripts = {}, game = null;
    if (way === 'remake') ({ title, scripts, disk: game } = await loadTitle(folder, { data, fixed }));
    else if (folder) title = await titleOf(folder);
    if (!game && /\.json$/.test(data.pathname)) game = await read(data, 'json');
    const kind = game?.kind;
    // the title's own styles, where it has them (its title.js `style`), in place before it draws by them
    if (title?.style && !document.querySelector(`link[data-title="${title.slug}"]`)) {
      const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL(title.style, folder).href });
      link.dataset.title = title.slug; document.head.append(link);
      await new Promise(done => { link.onload = link.onerror = done; });
    }
    // (a save the disk's backend could not store, said, not lost)
    disk.failed = err => { status.textContent = 'A file was not kept: ' + err.message; status.className = 'error'; };
    const [dots, lines] = options.screen ?? title?.screen ?? SCREENS[kind] ?? SCREENS.prodos;
    fit(stage, root, dots, lines);

    const g = {
      way, slug, title, scripts, game, folder, data, stage, status, fail, disk, preview, words, fixed, $, setting,
      saves: game ? savesFor(game, disk) : null, roms: options.roms, studies: options.studies, mini: options.mini ?? null,
      chargen: null,   // (the engine's Commodore 64 characters, for the printer's paper)
      pace: () => { const p = options.pace; return typeof p === 'function' ? p() : p ?? 1; },
      // an engine's own part of the options line that is no setting (Aztlan's preview selector), after the settings
      control(html) { line.insertAdjacentHTML('afterend', html); },
    };
    // a printer on device 4, for a Commodore 64 game: on unless the setting is off, what it prints drawn below the
    // screen as a sheet of paper, until it is torn off
    if (kind === 'c64') {
      const { Printer, paper } = await import('@moonbase-machines/c64/printer.js');
      const on = setting(PRINTER);
      const printer = g.printer = new Printer({ on: on.value });
      on.on(v => { printer.on = v; });
      const sheet = $('paper'), shown = $('paper-box');
      printer.changed = () => { shown.hidden = !printer.lines.length; if (printer.lines.length) paper(sheet, printer, g.chargen); };
      $('tear').addEventListener('click', () => printer.tear());
      $('print-paper').addEventListener('click', () => window.print());   // (the sheet alone: its print style)
    }
    if (way === 'remake' && title?.fixed) setting(FIXED).on(() => location.reload());

    const engine = way === 'original' ? await ENGINES.original() : title.own ?? await ENGINES[title.engine]();
    const handle = await engine.play(g);
    if (!handle) return;

    // the sound, where the engine has it: the player's speaker, on or off
    if (handle.sound) { const on = setting(SOUND, { first: true }); handle.sound(on.value); on.on(v => handle.sound(v)); }
    // the keys, one listener for every engine: the machine's code for each (keys.js), offered to the page first
    // (`claim`), then the engine's: the event itself where it reads the keyboard, else the code pressed
    const keyed = e => {
      const k = code(e, kind), down = e.type === 'keydown';
      if (down && k !== undefined && !e.repeat && options.claim?.(k)) { e.preventDefault(); return; }
      if (down) handle.start?.();
      if (handle.key) { handle.key(e, k); return; }
      if (!down || k === undefined || e.repeat || !handle.press) return;   // (a held key is one key)
      e.preventDefault(); handle.press(k);
    };
    addEventListener('keydown', keyed); addEventListener('keyup', keyed);
    stage.addEventListener('pointerdown', () => handle.start?.());
    phoneKeys(root, stage);
    // the disk as it stands, its own files and those saved, to download where the page offers it (a .d64 that VICE
    // or a real 64 can use)
    if (options.downloadDisk && handle.diskImage) {
      const button = $('disk'), name = data.pathname.split('/').pop().replace(/\.json$/, '');
      button.hidden = false;
      button.addEventListener('click', () => {
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([handle.diskImage()], { type: 'application/octet-stream' })), download: name + '.d64' });
        a.click(); URL.revokeObjectURL(a.href);
      });
    }
    // the game's demonstrations (data.js), where the engine types them: a button each, named as the data names it
    if (handle.demonstrate) for (const d of game?.demonstrations ?? []) {
      const button = Object.assign(document.createElement('button'), { type: 'button', textContent: d.name });
      button.addEventListener('click', () => { handle.start?.(); handle.demonstrate(d.steps); });
      $('disk').before(button);
    }
    // a page that follows the game: its engine, a key pressed as the player presses one, the game at full speed
    options.watch?.({ engine: handle.engine, press: k => { handle.start?.(); handle.press?.(k); }, quick: on => handle.quick?.(on) });
    // a route the page gives, played first; then the game; then the page's keys, to go straight to a scene
    if (options.route) {
      if (!handle.route) throw new Error('a route cannot be played on the ' + way);
      await handle.route(options.route);
    }
    handle.run();
    if (options.keys?.length) { const list = options.keys.map(n => named(n, kind)); if (handle.keys) handle.keys(list); else for (const k of list) handle.press?.(k); }
  } catch (err) { fail(err); }
}

// The screen sized evenly: a whole number of the device's pixels to each of the screen's dots, so every dot is drawn
// the same size and a line one dot thick is as thick as any other; the next whole number up from the column's width,
// a little wider than it and centred on it, unless that is wider than the window or taller than the stage may be (its
// max-height, where the page sets one: a phone on its side); kept so as the window, or its zoom, changes. The scale,
// in the page's pixels to a dot, is the section's --scale too, for a title drawn in CSS.
function fit(stage, column, dots, lines) {
  const size = () => {
    const dpr = window.devicePixelRatio || 1, pad = parseFloat(getComputedStyle(column).paddingLeft) * 2;
    const room = column.clientWidth - pad, most = document.documentElement.clientWidth - 16, tall = parseFloat(getComputedStyle(stage).maxHeight);
    let k = Math.ceil(room * dpr / dots - 0.01);
    if (dots * k / dpr > most) k = Math.max(1, Math.floor(most * dpr / dots));
    if (tall && lines * k / dpr > tall) k = Math.max(1, Math.floor(tall * dpr / lines));
    const w = dots * k / dpr;
    Object.assign(stage.style, { width: w + 'px', height: lines * k / dpr + 'px', aspectRatio: 'auto', marginLeft: (room - w) / 2 + 'px' });
    column.style.setProperty('--scale', k / dpr);
  };
  size();
  addEventListener('resize', size);
}

// A title of scenes played, the remake's own engine (main.js hands it the game): its scripts on the engine, its events
// drawn by the view, on the stage; its controls on the options line, the sound, the old style text, a C64 title's
// printer, the bugs fixed where the title has a version so, the mini view where the page gives one. A run's events
// are drawn one after another, with a moment for each sound and flash, so that what the original took time over takes
// time here too.
import { Printer, paper } from '@moonbase-machines/c64/printer.js';
import { makeEngine } from './load.js';
import { Speaker } from '../audio.js';
import { SID } from '@moonbase-machines/c64/sid.js';
import { matrixOf } from '@moonbase-machines/c64/kernal.js';
import { standIn } from '@moonbase-machines/c64/rom.js';
import { withSaves, keepSaves } from '@moonbase-machines/apple2e/saves.js';
import { Drive } from '@moonbase-machines/c64/drive.js';
import { keepDrive } from '@moonbase-machines/c64/saves.js';
import { paperBox, phoneKeys, KEYS_MARKUP } from '../parts.js';
import { View } from './view.js';
import { CardView } from './card-view.js';
import { C64View } from './c64-view.js';

export async function play(game) {
  const { title, scripts, disk, root, stage, status, fail, kept, words, fixed } = game;
  root.classList.add('game');   // (the screen of a machine: the stage the game's own shape, player.css)
  stage.innerHTML = `<svg id="screen" preserveAspectRatio="xMidYMid meet" tabindex="0" aria-label="The game's screen"></svg>`;
  status.insertAdjacentHTML('afterend', `${KEYS_MARKUP}<label><input type="checkbox" id="sound"> Sound</label><label><input type="checkbox" id="old-style"> Old style text</label><label hidden><input type="checkbox" id="printer" checked> Printer</label><label hidden title="The game with its bugs fixed: it starts again"><input type="checkbox" id="fixed"> Bugs fixed</label><label hidden>Mini view <select id="mini"><option value="">Off</option><option value="live">Live</option><option value="pictures">Pictures</option></select></label>`);
  root.append(paperBox(words.printer));
  const $ = id => root.querySelector('#' + id);
  const svg = $('screen'), soundBox = $('sound');
  phoneKeys(root, stage);

try {
  // the choice of the fixed version, where there is one: the page again, with ?fixed or without
  const fixedBox = $('fixed');
  if (fixedBox && title.fixed) {
    fixedBox.checked = fixed; fixedBox.parentElement.hidden = false;
    fixedBox.addEventListener('change', () => { const u = new URL(location.href); if (fixedBox.checked) u.searchParams.set('fixed', ''); else u.searchParams.delete('fixed'); location.href = u.href.replace('fixed=&', 'fixed&').replace(/fixed=$/, 'fixed'); });
  }
  // its view's own drawing, for a title that has one (its title.js `view`, load.js)
  const extra = title.viewSteps ?? {};
  // a Commodore 64's character ROM, for its view: Commodore's where the page gives them (`roms`), else moonbase's own
  const chargen = disk.kind === 'c64' ? game.roms?.chargen ?? standIn().chargen : null;

  // A printer on device 4, for a Commodore 64 title (@moonbase-machines/c64/printer.js): on unless its box is off,
  // what it prints drawn below the screen as a sheet of paper, until it is torn off
  if (disk.kind === 'c64') {
    const box = $('printer'), sheet = $('paper'), shown = $('paper-box');
    try { box.checked = localStorage.getItem('remake-printer') !== '0'; } catch {}
    box.parentElement.hidden = false;
    const printer = title.printer = new Printer({ on: box.checked });
    box.addEventListener('change', () => { printer.on = box.checked; try { localStorage.setItem('remake-printer', box.checked ? '1' : '0'); } catch {} });
    printer.changed = () => { shown.hidden = !printer.lines.length; if (printer.lines.length) paper(sheet, printer, chargen); };
    $('tear').addEventListener('click', () => printer.tear());
    $('print-paper').addEventListener('click', () => window.print());   // (the sheet alone: its print style)
  }
  // what the game saves, on the player's disk: an Apple title's data disk (@moonbase-machines/apple2e/saves.js), a
  // Commodore 64 title's drive (@moonbase-machines/c64/saves.js, the drive card.js puts on the bus)
  title.disk = withSaves(disk, kept);
  if (disk.kind === 'c64') keepDrive(title.drive = new Drive(Uint8Array.from(atob(disk.image), ch => ch.charCodeAt(0))), kept);
  const engine = makeEngine(title, scripts);
  if (title.files) keepSaves(disk, title.files, kept);
  const queue = [];
  // The view, and every event it has drawn, so that it can be drawn again from the start when
  // the old style text is turned on or off. The choice is kept in this browser.
  const oldStyleBox = $('old-style'), history = [];
  const remember = { get() { try { return localStorage.getItem('remake-old-style') === '1'; } catch { return false; } }, set(v) { try { localStorage.setItem('remake-old-style', v ? '1' : '0'); } catch {} } };
  oldStyleBox.checked = remember.get() || new URLSearchParams(location.search).has('old-style');   // ?old-style, for a screenshot
  let onView = null;   // (the mini view's, given each view made)
  const makeView = () => { svg.replaceChildren(); const v = disk.kind === 'c64' ? new C64View(svg, { engine, chargen }) : title.engine === 'card' ? new CardView(svg, { engine, inset: game.mini ? title.inset : null }) : new View(svg, { disk, volume: Object.keys(disk.volumes)[0], engine, extra }); v.oldStyle = oldStyleBox.checked; onView?.(v); return v; };
  let view = makeView();
  engine.on(e => queue.push(view.snapshot({ ...e })));
  // The mini view, where the page gives one (`mini`) and the title has a place for it (its title.js `inset`): Off,
  // Live or Pictures, the choice kept in this browser; shown in the band at the top of the screen while the band is
  // there. A picture only: the game's screen otherwise as it is
  const miniBox = $('mini');
  if (title.inset && game.mini) {
    miniBox.parentElement.hidden = false;
    try { miniBox.value = localStorage.getItem('remake-mini') ?? ''; } catch {}
    const { top, bottom, view: [left, right] } = title.inset, at = document.createElement('div');
    at.className = 'mini'; at.hidden = true;
    Object.assign(at.style, { left: `${left / 5.6}%`, top: `${top / 3.84}%`, width: `${(right - left) / 5.6}%`, height: `${(bottom - top + 1) / 3.84}%` });
    svg.parentElement.append(at);
    const mini = await game.mini(at, { memory: () => engine.mem });
    // (each view's painting followed by the mini view shown or not, as the band is there or not)
    onView = v => { v.insetOn = !!miniBox.value; const prompts = v.prompts.bind(v); v.prompts = () => { prompts(); at.hidden = !(miniBox.value && v.banded); }; };
    onView(view);
    const show = () => { view.insetOn = !!miniBox.value; mini.mode(miniBox.value); view.prompts(); };
    miniBox.addEventListener('change', () => { try { localStorage.setItem('remake-mini', miniBox.value); } catch {} show(); });
    show();
  }
  oldStyleBox.addEventListener('change', () => {
    remember.set(oldStyleBox.checked);
    view = makeView();
    for (const e of history) view.apply(e);
    view.prompts();
  });

  // the sound: the original's are off until the teacher turns them on, at the engine's sound flag.
  // A title that keeps the original's time (a card title's, Engine.time) clicks the speaker as
  // the original did, and the clicks are played as the emulator plays them (audio.js), the
  // box the sound's on and off.
  const speaker = engine.timed ? new Speaker() : null;
  if (speaker) soundBox.checked = true;
  const hear = () => { if (disk.kind !== 'c64') speaker?.feed(soundBox.checked ? engine.clicks : [], engine.cycles); engine.clicks.length = 0; };
  const V = title.map?.vars ?? { sound: 0, soundOn: 0 };
  let audio = null;
  const tone = (from, to, ms) => {
    if (!(engine.mem[V.sound] & V.soundOn)) return;
    audio ??= new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
    o.type = 'square'; o.frequency.setValueAtTime(from, t); o.frequency.linearRampToValueAtTime(to, t + ms / 1000);
    g.gain.setValueAtTime(0.06, t); g.gain.linearRampToValueAtTime(0, t + ms / 1000);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + ms / 1000);
  };
  const pitch = p => 16000 / (p + 8);
  soundBox.addEventListener('change', () => { if (!speaker) engine.mem[V.sound] = soundBox.checked ? V.soundOn : 0; });

  // how long each step takes to be seen or heard, in milliseconds
  const PACE = { sound: 220, beep: 60, 'flash-box': 60, flash: 250, object: 30, 'object-keep': 30 };
  const pace = () => game.pace ?? 1;   // (the original's waits, a part of each: 1 all, 0 none; read at each wait)
  let drawing = false;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function runs() {
    if (drawing) return;
    drawing = true;
    try {
      for (;;) {
        const r = engine.run();
        hear();
        // the original took time here, a disk's read or a wait it counted out: the screen as it
        // is, for that long (card.js)
        if (r === 'pace') {
          for (const e of queue.splice(0)) { history.push(e); view.apply(e); }
          view.prompts(); if (!quick && pace()) await sleep(engine.delay * pace()); engine.delay = 0;
          continue;
        }
        engine.delay = 0;
        while (queue.length) {
          const e = queue.shift();
          history.push(e);
          view.apply(e);
          if (quick) continue;   // (at full speed: no sound, no wait)
          if (e.step === 'sound') { const [end, start] = e.words.split(' ').map(h => parseInt(h, 16)); tone(pitch(start), pitch(end), 180); }
          if (e.step === 'beep') tone(pitch(e.a & 31) * 2, pitch(e.a & 31) * 2, 50);
          if (!pace()) continue;   // (none of the original's waits: its sounds still)
          if (PACE[e.step]) await sleep(PACE[e.step] * pace());
          if (e.step === 'pause') await sleep(e.ms * pace());   // a delay the original counted out
        }
        view.prompts();
        status.textContent = r === 'end' ? 'The end.' : 'Waiting for a key.';
        if (!engine.keys.length || r === 'end') break;
      }
    } catch (err) { fail(err); }
    drawing = false;
  }

  // keys as the Apple's keyboard gave them
  // (a Commodore 64's in PETSCII: its cursor keys, DEL and RUN/STOP, and its letters capitals)
  const KEYS = disk.kind === 'c64'
    ? { ArrowLeft: 157, ArrowRight: 29, ArrowDown: 17, ArrowUp: 145, Enter: 13, Backspace: 20, Delete: 20, Escape: 3, ' ': 32 }
    : { ArrowLeft: 8, ArrowRight: 21, ArrowDown: 10, ArrowUp: 11, Enter: 13, Backspace: 127, Delete: 127, Escape: 27, ' ': 32 };
  let quick = false;
  const press = k => { engine.press(k); audio?.resume(); speaker?.start(); if (disk.kind !== 'c64') runs(); };
  // (a page that follows the game, the island's, given it: the engine, its memory, a key pressed as the
  // player presses one, and `quick(on)`, the game at full speed, none of its waits, to jump ahead in it)
  game.watch?.({ engine, press, quick: on => { quick = on; } });
  // A game that goes on without waiting for keys, as Nature Park's truck: each turn of its loop is
  // a step `tick`, which takes a key or none. A turn passes every 100 milliseconds, as the
  // original's took, with the key pressed since the last or still held, as the Apple's keyboard
  // told the game a key was down.
  const ticking = () => engine.waitingOn?.words?.[0] === 'tick';
  let held = null, tapped = null;
  setInterval(() => {
    if (!ticking() || drawing || engine.keys.length) return;
    const k = tapped ?? held ?? -1; tapped = null;
    press(k);
  }, 100);
  window.addEventListener('keydown', e => {
    if (e.metaKey || e.altKey) return;
    const k = e.ctrlKey ? (/^[a-z]$/i.test(e.key) ? e.key.toUpperCase().charCodeAt(0) & 0x1f : undefined) : KEYS[e.key] ?? (e.key.length === 1 ? (disk.kind === 'c64' ? e.key.toUpperCase() : e.key).charCodeAt(0) : undefined);
    if (k === undefined) return;
    e.preventDefault();
    if (ticking()) { tapped = held = k; return; }
    // a Commodore 64's key held down in its keyboard's matrix, which its KERNAL scans and repeats
    // as long as it is held, as the original's did (@moonbase-machines/c64/kernal.js); a character typed only
    // with shift into the buffer
    const m = disk.kind === 'c64' && !e.ctrlKey && matrixOf(k);
    if (m) { if (!e.repeat) { engine.clock.held = { ...m, key: e.key }; audio?.resume(); speaker?.start(); } return; }
    if (!e.repeat && !game.claim?.(k)) press(k);   // (the player's key offered to the page first: `claim`, main.js)
  });
  window.addEventListener('keyup', e => {
    held = null;
    const h = engine.clock?.held;
    if (h?.key === e.key) { if (h.seen) engine.clock.held = null; else h.up = true; }
  });
  svg.addEventListener('click', e => { const key = e.target.closest('.key')?.dataset.key; if (key) press(+key); });
  svg.focus();
  // A Commodore 64 title runs on the clock, as the original did, waiting for a key or not: a
  // sixtieth of a second of the original's cycles at a time (the engine's run stops at each 16 ms of
  // them), its raster and its interrupt at the time they come (card.js), and the screen
  // painted after each. And the SID, its writes played a sixtieth of a second at a time, as the
  // emulator plays a frame's (original.js).
  if (disk.kind === 'c64') {
    // a route the page gives (`route`, a workshop's pilots' route) played first as the pilots play it, each key when
    // the game waits for one, off the clock, so that it goes where it went on both sides; then the game goes on as
    // usual
    if (game.route) {
      const { route, name: routeName, keys: { expand, give, petscii, pollsAt } } = game.route;
      title.seed = route.seed;   // (RND's numbers from the route's seed, as the pilots have them)
      if (route.printer && title.printer) { title.printer.on = true; $('printer').checked = true; }
      status.textContent = 'Playing the route ' + routeName + '.';
      // (a key behind the one pressed goes into the KERNAL's buffer, as the pilots hold a key)
      const side = { press: k => engine.press(k), also: k => { const m = engine.mem, put = v => { if (m[0xc6] < 10) { m[0x277 + m[0xc6]] = v; m[0xc6]++; } }; if (engine.keys.length) put(engine.keys.shift()); put(k); } };
      const go = () => { let r; do { engine.delay = 0; r = engine.run(); } while (r === 'pace'); queue.length = 0; };
      go();
      for (const [i, [k]] of expand(route.keys).entries()) { give(side, k, petscii); engine.polls = pollsAt(route, i + 1) ?? undefined; go(); }
      engine.polls = undefined; view.prompts();
    }
    engine.sid = []; engine.clock = { irq: 0, ahead: [], since: 0 };
    let sid = null, from = null, sent = 0, stopped = false;
    status.textContent = 'Playing.';
    setInterval(() => {
      engine.delay -= 1000 / 60;   // a load's time, or the last run's
      if (!stopped && !engine.ended && engine.delay < 16) {
        engine.delay = Math.max(0, engine.delay);
        // a key of ?keys when the game is waiting for one, two seconds at least after the last, as
        // a player would press them (a wait the game counts out goes on by itself on the clock)
        if (engine.clock.ahead.length && engine.idle > (engine.routines.polls ?? 200) && !engine.keys.length && ++engine.clock.since > 120) { engine.press(engine.clock.ahead.shift()); engine.clock.since = 0; }
        try { engine.run(); queue.length = 0; view.prompts(); } catch (err) { stopped = true; fail(err); }
        if (engine.ended) status.textContent = 'The end.';
      }
      if (speaker?.node && soundBox.checked) {
        sid ??= new SID(speaker.rate); from ??= performance.now();
        const n = Math.floor((performance.now() - from) / 1000 * speaker.rate) - sent;
        if (n > 0) { const wave = sid.render(n, engine.sid.map(([, r, v]) => [0, r, v])); sent += n; speaker.node.port.postMessage(wave, [wave.buffer]); }
      }
      engine.sid.length = 0;
    }, 1000 / 60);
  }
  // ?keys=space,space,right,return presses keys at the start, to go straight to a scene
  const start = new URLSearchParams(location.search).get('keys');
  if (start) for (const k of start.split(',')) { const a = { space: 32, return: 13, escape: 27, delete: 127, left: 8, right: 21, down: 10, up: 11, 'control-e': 5, 'control-t': 20, none: -1 }[k] ?? k.charCodeAt(0); if (disk.kind === 'c64') engine.clock.ahead.push({ 8: 157, 21: 29, 10: 17, 11: 145, 127: 20, 27: 3 }[a] ?? a); else engine.press(a); }
  if (disk.kind !== 'c64') runs();
} catch (err) { fail(err); }
}

// The Remake's engine for a title of scenes, 'card' or 'vector' (play.js hands it the game): its scripts on the
// remake's engine (remake/engine.js), its events drawn by the view on the stage, the view the machine's (an Apple's
// hi-res page for a card title, CardView; a Commodore 64's, C64View; a vector title's pictures and text, View); its own
// control on the options line, the old style text; the mini view where the page gives one and the title has a place
// for it. A run's events are drawn one after another, with a moment for each sound and flash, so that what the
// original took time over takes time here too.
import { makeEngine } from '../remake/load.js';
import { Speaker } from '../audio.js';
import { SID } from '@moonbase-machines/c64/sid.js';
import { matrixOf } from '@moonbase-machines/c64/kernal.js';
import { standIn } from '@moonbase-machines/c64/rom.js';
import { Drive } from '@moonbase-machines/c64/drive.js';
import { View } from '../remake/view.js';
import { CardView } from '../remake/card-view.js';
import { C64View } from '../remake/c64-view.js';

export async function play(g) {
  const { title, scripts, game: disk, stage, status, fail, saves, $ } = g;
  const c64 = disk.kind === 'c64';
  stage.innerHTML = `<svg id="screen" preserveAspectRatio="xMidYMid meet" tabindex="0" aria-label="The game's screen"></svg>`;
  g.control('<label><input type="checkbox" id="old-style"> Old style text</label>');
  const svg = $('screen');

  // its view's own drawing, for a title that has one (its title.js `view`, load.js)
  const extra = title.viewSteps ?? {};
  // a Commodore 64's character ROM, for its view and the printer's paper: Commodore's where the page gives them
  // (`roms`), else moonbase's own
  const chargen = g.chargen = c64 ? g.roms?.chargen ?? standIn().chargen : null;
  // a Commodore 64 title's printer on device 4, the player's (play.js), on the bus card.js makes
  if (g.printer) title.printer = g.printer;
  // what the game saves, on the player's disk (play.js `saves`): an Apple title's data disk, a Commodore 64 title's
  // drive (the drive card.js puts on the bus)
  title.disk = saves.data;
  if (c64) saves.drive(title.drive = new Drive(Uint8Array.from(atob(disk.image), ch => ch.charCodeAt(0))));
  const engine = makeEngine(title, scripts);
  if (title.files) saves.keep(title.files);
  const queue = [];
  // The view, and every event it has drawn, so that it can be drawn again from the start when
  // the old style text is turned on or off. The choice is kept in this browser.
  const oldStyleBox = $('old-style'), history = [];
  const remember = { get() { try { return localStorage.getItem('remake-old-style') === '1'; } catch { return false; } }, set(v) { try { localStorage.setItem('remake-old-style', v ? '1' : '0'); } catch {} } };
  oldStyleBox.checked = remember.get() || new URLSearchParams(location.search).has('old-style');   // ?old-style, for a screenshot
  let onView = null;   // (the mini view's, given each view made)
  const makeView = () => { svg.replaceChildren(); const v = c64 ? new C64View(svg, { engine, chargen }) : title.engine === 'card' ? new CardView(svg, { engine, inset: g.mini ? title.inset : null }) : new View(svg, { disk, volume: Object.keys(disk.volumes)[0], engine, extra }); v.oldStyle = oldStyleBox.checked; onView?.(v); return v; };
  let view = makeView();
  engine.on(e => queue.push(view.snapshot({ ...e })));
  // The mini view, where the page gives one (`mini`) and the title has a place for it (its title.js `inset`): Off,
  // Live or Pictures, the choice kept in this browser; shown in the band at the top of the screen while the band is
  // there. A picture only: the game's screen otherwise as it is
  const miniBox = $('mini');
  if (title.inset && g.mini) {
    miniBox.parentElement.hidden = false;
    try { miniBox.value = localStorage.getItem('remake-mini') ?? ''; } catch {}
    const { top, bottom, view: [left, right] } = title.inset, at = document.createElement('div');
    at.className = 'mini'; at.hidden = true;
    Object.assign(at.style, { left: `${left / 5.6}%`, top: `${top / 3.84}%`, width: `${(right - left) / 5.6}%`, height: `${(bottom - top + 1) / 3.84}%` });
    svg.parentElement.append(at);
    const mini = await g.mini(at, { memory: () => engine.mem });
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
  let sounding = !!speaker;
  const hear = () => { if (!c64) speaker?.feed(sounding ? engine.clicks : [], engine.cycles); engine.clicks.length = 0; };
  const V = title.map?.vars ?? { sound: 0, soundOn: 0 };
  let audio = null;
  const tone = (from, to, ms) => {
    if (!(engine.mem[V.sound] & V.soundOn)) return;
    audio ??= new AudioContext();
    const o = audio.createOscillator(), gain = audio.createGain(), t = audio.currentTime;
    o.type = 'square'; o.frequency.setValueAtTime(from, t); o.frequency.linearRampToValueAtTime(to, t + ms / 1000);
    gain.gain.setValueAtTime(0.06, t); gain.gain.linearRampToValueAtTime(0, t + ms / 1000);
    o.connect(gain).connect(audio.destination); o.start(t); o.stop(t + ms / 1000);
  };
  const pitch = p => 16000 / (p + 8);

  // how long each step takes to be seen or heard, in milliseconds
  const PACE = { sound: 220, beep: 60, 'flash-box': 60, flash: 250, object: 30, 'object-keep': 30 };
  let drawing = false, quick = false;
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
          view.prompts(); if (!quick && g.pace()) await sleep(engine.delay * g.pace()); engine.delay = 0;
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
          if (!g.pace()) continue;   // (none of the original's waits: its sounds still)
          if (PACE[e.step]) await sleep(PACE[e.step] * g.pace());
          if (e.step === 'pause') await sleep(e.ms * g.pace());   // a delay the original counted out
        }
        view.prompts();
        status.textContent = r === 'end' ? 'The end.' : 'Waiting for a key.';
        if (!engine.keys.length || r === 'end') break;
      }
    } catch (err) { fail(err); }
    drawing = false;
  }

  const press = k => { engine.press(k); audio?.resume(); speaker?.start(); if (!c64) runs(); };
  // A game that goes on without waiting for keys, as Nature Park's truck: each turn of its loop is
  // a step `tick`, which takes a key or none. A turn passes every 100 milliseconds, as the
  // original's took, with the key pressed since the last or still held, as the Apple's keyboard
  // told the game a key was down.
  const ticking = () => engine.waitingOn?.words?.[0] === 'tick';
  let held = null, tapped = null;
  svg.addEventListener('click', e => { const key = e.target.closest('.key')?.dataset.key; if (key) press(+key); });

  // A Commodore 64 title runs on the clock, as the original did, waiting for a key or not: a
  // sixtieth of a second of the original's cycles at a time (the engine's run stops at each 16 ms of
  // them), its raster and its interrupt at the time they come (card.js), and the screen
  // painted after each. And the SID, its writes played a sixtieth of a second at a time, as the
  // emulator plays a frame's (engines/original.js).
  function clock() {
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
      if (speaker?.node && sounding) {
        sid ??= new SID(speaker.rate); from ??= performance.now();
        const n = Math.floor((performance.now() - from) / 1000 * speaker.rate) - sent;
        if (n > 0) { const wave = sid.render(n, engine.sid.map(([, r, v]) => [0, r, v])); sent += n; speaker.node.port.postMessage(wave, [wave.buffer]); }
      }
      engine.sid.length = 0;
    }, 1000 / 60);
  }
  setInterval(() => {
    if (!ticking() || drawing || engine.keys.length) return;
    const k = tapped ?? held ?? -1; tapped = null;
    press(k);
  }, 100);

  return {
    engine, press,
    run() { svg.focus(); if (c64) clock(); else runs(); },
    // the keys the player gives (play.js): a turn's key while the game ticks; a Commodore 64's held in its keyboard's
    // matrix, which its KERNAL scans and repeats as long as it is held, as the original's did
    // (@moonbase-machines/c64/kernal.js), a character typed only with shift into the buffer; else pressed
    key(e, k) {
      if (e.type === 'keyup') {
        held = null;
        const h = engine.clock?.held;
        if (h?.key === e.key) { if (h.seen) engine.clock.held = null; else h.up = true; }
        return;
      }
      if (k === undefined) return;
      e.preventDefault();
      if (ticking()) { tapped = held = k; return; }
      const m = c64 && !e.ctrlKey && matrixOf(k);
      if (m) { if (!e.repeat) { engine.clock.held = { ...m, key: e.key }; audio?.resume(); speaker?.start(); } return; }
      if (!e.repeat) press(k);
    },
    // ?keys at the start: a Commodore 64's into the KERNAL's buffer on the clock, as a player would press them; else
    // pressed
    keys(list) { if (c64) engine.clock.ahead.push(...list); else for (const k of list) press(k); },
    start() { audio?.resume(); speaker?.start(); },
    // the Sound box: the speaker's clicks, where the title keeps the original's time; else the game's own sound flag
    sound(on) { if (speaker) sounding = on; else engine.mem[V.sound] = on ? V.soundOn : 0; },
    soundOn: !!speaker,
    quick(on) { quick = on; },
    // A route the page gives (`route`, a workshop's pilots' route), played first as the pilots play it, each key when
    // the game waits for one, off the clock, so that it goes where it went on both sides; then the game goes on as
    // usual
    route({ route, name, keys: { expand, give, petscii, pollsAt } }) {
      title.seed = route.seed;   // (the random numbers from the route's seed, as the pilots have them)
      if (route.printer && title.printer) { title.printer.on = true; $('printer').checked = true; }
      status.textContent = 'Playing the route ' + name + '.';
      // (on a Commodore 64 a key behind the one pressed goes into the KERNAL's buffer, as the pilots hold a key)
      const side = { press: k => engine.press(k), also: k => { const m = engine.mem, put = v => { if (m[0xc6] < 10) { m[0x277 + m[0xc6]] = v; m[0xc6]++; } }; if (engine.keys.length) put(engine.keys.shift()); put(k); } };
      const go = () => { let r; do { engine.delay = 0; r = engine.run(); } while (r === 'pace'); if (c64) queue.length = 0; else for (const e of queue.splice(0)) { history.push(e); view.apply(e); } };
      go();
      for (const [i, [k]] of expand(route.keys).entries()) { give(side, k, c64 ? petscii : undefined); engine.polls = pollsAt(route, i + 1) ?? undefined; go(); }
      engine.polls = undefined; view.prompts();
    },
  };
}

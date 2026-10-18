// The original: a game's disk in the machine it was made for, its screen on a canvas, the keyboard passed
// on, and each picture the engine draws also given as SVG over the canvas. Each game's machine is loaded when its
// game asks for it, the Commodore 64 (@moonbase-machines/c64) or the Apple IIe (@moonbase-machines/apple2e), and not
// the other; on moonbase's own ROMs, which need nothing of the makers'.
//
//   await play({ data, root, disk, words, downloadDisk, roms, studies })
//     data          the game's data, an absolute URL (<name>.json: its disks' files, its kind, its saves)
//     root          the page's section the player is made in
//     disk          the title's player's disk (disk/disk.js), opened before the player starts
//     words         the page's words the player shows: { printer: { line, print, tear } }
//     downloadDisk  a C64 game's disk offered to download, with what is saved on it
//   and what only a workshop has, given by its pages, never looked for here:
//     roms          the makers' ROMs this machine has: an Apple game's line 1, Apple's own booting its disks,
//                   { apple: { system, disk2 }, image: async name => its disk image's bytes }; a C64 game's
//                   Commodore's, { choice ('commodore' or 'moonbase-petscii', @moonbase-machines/c64/start.js), load:
//                   async name => a ROM's bytes }
//     studies       files of its own for a C64 game's disk, a name to its bytes in base64, in the drive, not kept
import { Speaker } from './audio.js';
import { paperBox, phoneKeys, KEYS_MARKUP } from './parts.js';

export async function play({ data, root, disk, words, downloadDisk = false, roms = null, studies = null }) {
  root.classList.add('game');
  root.innerHTML = `<div class="stage"><svg id="vector" viewBox="0 0 140 192" preserveAspectRatio="none"></svg><canvas id="screen" width="560" height="384" tabindex="0"></canvas></div>
  <p class="options"><span id="status">Loading.</span>${KEYS_MARKUP}<label><input type="checkbox" id="vectors"> Draw the pictures as vectors</label><label hidden><input type="checkbox" id="printer" checked> Printer</label><button id="disk" type="button" hidden>Download the disk</button></p>`;
  root.append(paperBox(words.printer));
  const $ = id => root.querySelector('#' + id);
  const canvas = $('screen'), ctx = canvas.getContext('2d');
  phoneKeys(root, canvas.parentElement);
  // (the game's name, for a disk downloaded: its data's file's)
  const name = new URL(data).pathname.split('/').pop().replace(/\.json$/, '');
  const parts = { name, roms, studies, disk, downloadDisk, $, canvas, ctx, layer: $('vector'), status: $('status'), vectorToggle: $('vectors'), speaker: new Speaker() };
  const game = await (await fetch(data)).json();
  if (game.kind === 'c64') await c64(game, parts); else await apple(game, parts);
}

// the screen stretched evenly: a whole number of the device's pixels to each of the machine's dots
// (the 64's 384 by 272, the Apple's 280 by 192), so every dot is drawn the same size and a line one
// dot thick is as thick as any other; the next whole number up from the column's width, a little
// wider than it and centred on it, unless that is wider than the window; kept so as the window, or
// its zoom, changes
function evenly(canvas, dots, lines) {
  const stage = canvas.parentElement, column = stage.parentElement;
  const fit = () => {
    const dpr = window.devicePixelRatio || 1, pad = parseFloat(getComputedStyle(column).paddingLeft) * 2;
    const room = column.clientWidth - pad, most = document.documentElement.clientWidth - 16;
    let k = Math.ceil(room * dpr / dots - 0.01);
    if (dots * k / dpr > most) k = Math.max(1, Math.floor(most * dpr / dots));
    const w = dots * k / dpr;
    Object.assign(stage.style, { width: w + 'px', height: lines * k / dpr + 'px', aspectRatio: 'auto', marginLeft: (room - w) / 2 + 'px' });
  };
  fit();
  addEventListener('resize', fit);
}

// An Apple II game: the machine, the canvas, the keys, and the hooks for the vectors. With Apple's
// ROMs and the game's disk images, where the page gives them (`roms`), it is line 1, the Apple itself booting the
// disks; without them, moonbase's (line 2), the game started at once.
async function apple(game, { roms: makers, disk, canvas, ctx, layer, status, vectorToggle, speaker }) {
const [{ Machine }, { placed }, { withSaves, keepSaves, onDisks, driveFiles }, { screen }, { shapes }, { elements }] = await Promise.all([
  import('@moonbase-machines/apple2e/machine.js'), import('@moonbase-machines/apple2e/prodos.js'), import('@moonbase-machines/apple2e/saves.js'),
  import('@moonbase-machines/apple2e/screen.js'), import('@moonbase-machines/vector/pictures.js'), import('@moonbase-machines/vector/svg.js')]);
evenly(canvas, 280, 192);
// the title's saves on its own volume, the player's disk's (@moonbase-machines/apple2e/saves.js): on line 2 the
// machine's files; on line 1 written onto that volume's disk before it boots, and kept as the title's DOS writes it
const saving = withSaves(game, disk);
let roms = null, disks = null;
if (makers?.apple) try {
  roms = makers.apple;
  disks = onDisks(game, placed(saving, new Map(await Promise.all(game.images.map(async n => [n, await makers.image(n)])))), disk);
} catch { roms = null; }
const m = new Machine(saving, { log: (...a) => console.log(...a), ...roms ? { roms, disks } : {} });
console.log(roms ? "line 1: Apple's ROMs, the disks booted" : "line 2: moonbase's machine");
keepSaves(game, roms ? driveFiles(m, disks, game) : m.disk, disk);
m.diskTime = true;   // reads from the disk take the time a disk took, as the games' loading screens expect

// Where the engine is hooked, found in PART0 once it is loaded, in whichever bank the game runs
// in. The picture routine's loop draws the shapes the loader has put at $E000 one by one, so on
// its first shape the whole picture is read for the SVG, and from there to the routine's exit,
// which sets X to 0 and Y to $E0, the machine marks every screen byte written as the picture's.
// The box routine, which clears the picture window, starts by keeping its three colors, and
// there the SVG and the marks are cleared, and the window's color, in A, is kept to go under
// the next pictures' polygons.
let hooked = false, window_ = 0;
function hook() {
  const find = (bytes, code) => { outer: for (let a = 0x4000; a < 0x8000 - bytes.length; a++) { for (let i = 0; i < bytes.length; i++) if (bytes[i] !== null && code[a + i] !== bytes[i]) continue outer; return a; } return -1; };
  for (const code of [m.aux, m.main]) {
    const shape = find([0x20, null, null, 0x20, null, null, 0xee, null, null, 0x4c], code);   // JSR fill; JSR outline; INC count; JMP loop
    const exit = find([0xa2, 0x00, 0xa0, 0xe0, 0x18, 0x60], code);   // LDX #0; LDY #$E0; CLC; RTS
    const box = find([0x8d, null, null, 0x8e, null, null, 0x8c, null, null, 0xad, null, null, 0xc9, 0x80, 0xf0], code);
    if (shape < 0 || exit < 0 || box < 0) continue;
    m.cpu.hooks.set(shape, c => { if (c.read16(0x60) === 0xe000) { layer.insertAdjacentHTML('beforeend', elements(shapes(a => m.read(a), 0xe000), { background: window_ })); m.marking = 1; } return false; });
    m.cpu.hooks.set(exit, () => { m.marking = 0; return false; });
    m.cpu.hooks.set(box, c => { if (c.a !== 0x80) window_ = c.a & 15; layer.innerHTML = ''; m.owner.fill(0); return false; });
    hooked = true;
    return;
  }
}

// the keys, as the Apple II's keyboard gives them
const KEYS = { Escape: 27, Enter: 13, Backspace: 127, Delete: 127, ArrowLeft: 8, ArrowRight: 21, ArrowUp: 11, ArrowDown: 10, Tab: 9 };
window.addEventListener('keydown', e => {
  speaker.start();
  if (e.metaKey || e.altKey || e.repeat) return;   // a held key is one key
  // control with a letter is the Apple's control character: control-E opens Animal Rescue's main menu
  const k = e.ctrlKey ? (/^[a-z]$/i.test(e.key) ? e.key.toUpperCase().charCodeAt(0) & 0x1f : undefined) : KEYS[e.key] ?? (e.key.length === 1 ? e.key.charCodeAt(0) : undefined);
  if (k === undefined) return;
  console.log('key', JSON.stringify(e.key), '->', k, 'at pc $' + m.cpu.pc.toString(16));
  m.press(k); e.preventDefault();
});

const rgba = new Uint8ClampedArray(560 * 384 * 4);
const image = new ImageData(rgba, 560, 384);
const cols = new Uint8Array(140 * 192);
let mode = '';
function frame() {
  if (!m.halted) m.runCycles(17030);   // a frame's worth of the Apple's clock, at 60 a second
  const now = `text ${m.sw.text} page2 ${m.sw.page2} hires ${m.sw.hires} dhires ${m.sw.dhires}`;
  if (now !== mode) { console.log('screen:', now, 'at pc $' + m.cpu.pc.toString(16), 'cycles', m.cpu.cycles); mode = now; }
  speaker.feed(m.clicks, m.cpu.cycles); m.clicks.length = 0;
  if (!hooked) hook();
  const text = m.sw.text;
  screen(m, rgba, { cols, owner: vectorToggle.checked && layer.innerHTML ? m.owner : null });
  ctx.putImageData(image, 0, 0);
  layer.style.visibility = vectorToggle.checked && !text ? 'visible' : 'hidden';
  status.textContent = m.halted ? 'The game has stopped: ' + m.halted + '.' : (m.idle > 2000 ? 'Waiting for a key.' : 'Running.');
  requestAnimationFrame(frame);
}
canvas.addEventListener('pointerdown', () => { speaker.start(); canvas.focus(); });
canvas.focus();
frame();
}

// A C64 game: on moonbase's own ROMs (@moonbase-machines/c64/rom.js), as the site has it everywhere, or on
// Commodore's where the page gives them (`roms`) and asks for them; the machine autostarted
// with LOAD"name",8,1, and RUN for a BASIC program, typed into the KERNAL's buffer, the frame on a canvas of
// 384 by 272 doubled, the keys as the matrix and the arrows as the joystick.
async function c64(game, { name, roms: makers, studies, disk, downloadDisk, $, canvas, layer, status, vectorToggle, speaker }) {
  const [{ C64 }, { Printer, paper }, { WIDTH, HEIGHT }, { keyboard, painter }, { SID }, { c64Roms, typed: startTyped }, { add }, { keepDrive }] = await Promise.all([
    import('@moonbase-machines/c64/machine.js'), import('@moonbase-machines/c64/printer.js'), import('@moonbase-machines/c64/vic.js'), import('@moonbase-machines/c64/browser.js'),
    import('@moonbase-machines/c64/sid.js'), import('@moonbase-machines/c64/start.js'), import('@moonbase-machines/c64/d64.js'), import('@moonbase-machines/c64/saves.js')]);
  evenly(canvas, WIDTH, HEIGHT);
  const roms = await c64Roms(makers?.choice ?? null, makers?.load);
  if (!roms) { status.textContent = 'Commodore\'s ROMs, asked for, are not here.'; return; }
  // a printer on device 4 (@moonbase-machines/c64/printer.js): on unless its box is off, what it prints drawn
  // below the screen as a sheet of paper, until it is torn off
  const box = $('printer'), sheet = $('paper'), shown = $('paper-box');
  try { box.checked = localStorage.getItem('printer') !== '0'; } catch {}
  box.parentElement.hidden = false;
  const printer = new Printer({ on: box.checked });
  box.addEventListener('change', () => { printer.on = box.checked; try { localStorage.setItem('printer', box.checked ? '1' : '0'); } catch {} });
  printer.changed = () => { shown.hidden = !printer.lines.length; if (printer.lines.length) paper(sheet, printer, roms.chargen); };
  $('tear').addEventListener('click', () => printer.tear());
  $('print-paper').addEventListener('click', () => window.print());   // (the sheet alone: its print style)
  const m = new C64(game, roms, { log: (...a) => console.log(...a), printer });
  // What the game SAVEs to its disk, kept on the player's disk and given back to the drive the next time
  // (@moonbase-machines/c64/saves.js)
  keepDrive(m.drive, disk);
  // (and, where the page gives them, `studies`, files of its own for the disk, a name to a file: in the drive, not
  // kept)
  const raw = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
  for (const [file, data] of Object.entries(studies ?? {})) m.drive.saved.set(file, raw(data));
  // the disk as it now stands, its own files and those saved, to download where the title offers it
  // (Crayon's): a .d64 that VICE or a real 64 can use (@moonbase-machines/c64/d64.js `add`)
  if (downloadDisk) {
    const download = $('disk');
    download.hidden = false;
    download.addEventListener('click', () => {
      const image = add(m.drive.image, [...m.drive.saved].map(([name, data]) => ({ name, data })));
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([image], { type: 'application/octet-stream' })), download: name + '.d64' });
      a.click(); URL.revokeObjectURL(a.href);
    });
  }
  layer.style.display = 'none'; vectorToggle.parentElement.style.display = 'none';
  const draw = painter(canvas);
  let typing = null, typed = 0;
  const keys = keyboard(m, { onKey: () => speaker.start(), log: true });
  // once BASIC is ready, the start typed in; the KERNAL's buffer takes ten characters at a time.
  // The C64 runs 50 frames a second, so frames are run to keep up with the clock, two at most.
  let frames = 0, sid = null, started = performance.now();
  function frame() {
    const due = Math.min(2, Math.floor((performance.now() - started) / 20) - frames);
    for (let i = 0; i < due; i++) {
      m.runFrame(); frames++; keys.frame();
      if (speaker.node) {
        if (!sid) sid = new SID(speaker.rate);
        const n = Math.round(19656 / 985248 * speaker.rate), first = m.cpu.cycles - 19656;
        const wave = sid.render(n, m.sidWrites.map(([c, r, v]) => [Math.floor((c - first) / 19656 * n), r, v]));
        speaker.node.port.postMessage(wave, [wave.buffer]);
      }
      m.sidWrites.length = 0;
    }
    // (LOAD, and RUN for a BASIC program: @moonbase-machines/c64/start.js)
    if (frames >= 120 && typing === null && !typed) { typing = startTyped(m, game); typed = 1; }
    if (typing !== null && !m.ram[0xc6]) { typing = m.type(typing); if (!typing.length) typing = null; }
    draw(m.vic.frame);
    status.textContent = m.halted ? 'The game has stopped: ' + m.halted + '.' : 'Running.';
    requestAnimationFrame(frame);
  }
  canvas.focus(); frame();
}

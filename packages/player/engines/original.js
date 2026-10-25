// The Original's engine (play.js hands it the game): the game's disk in the machine it was made for, its screen on a
// canvas on the stage, and each picture the engine draws also given as SVG over the canvas. Each game's machine is
// loaded when its game asks for it, the Commodore 64 (@moonbase-machines/c64) or the Apple IIe
// (@moonbase-machines/apple2e), and not the other; on moonbase's own ROMs, which need nothing of the makers'.
//
// Of the player's `game` it reads: the game's data (`game`), its saves (`saves`), the stage, the status, and what only
// a workshop has (play.js): `roms`, the makers' ROMs this machine has, an Apple game's line 1, Apple's own booting its
// disks, { apple: { system, disk2 }, image: async name => its disk image's bytes }, a Commodore 64 game's Commodore's,
// { choice ('commodore' or 'moonbase-petscii', @moonbase-machines/c64/start.js), load: async name => a ROM's bytes };
// and `studies`, files of its own for a Commodore 64 game's disk, a name to its bytes in base64, in the drive, not kept.
import { Speaker } from '../audio.js';

// the setting the Apple's engine acts on (play.js `setting`): its pictures drawn as vectors over the screen
const VECTORS = { name: 'vectors', type: 'boolean', default: false, owner: 'person', words: 'Draw the pictures as vectors' };

export async function play(g) {
  g.stage.innerHTML = '<svg id="vector" viewBox="0 0 140 192" preserveAspectRatio="none"></svg><canvas id="screen" width="560" height="384" tabindex="0"></canvas>';
  const canvas = g.stage.querySelector('canvas'), ctx = canvas.getContext('2d'), layer = g.stage.querySelector('#vector');
  return g.game.kind === 'c64' ? c64(g, { canvas, layer, speaker: new Speaker() }) : apple(g, { canvas, ctx, layer, speaker: new Speaker() });
}

// An Apple II game: the machine, the canvas, the keys, and the hooks for the vectors. With Apple's
// ROMs and the game's disk images, where the page gives them (`roms`), it is line 1, the Apple itself booting the
// disks; without them, moonbase's (line 2), the game started at once.
async function apple({ game, saves, roms: makers, status, setting }, { canvas, ctx, layer, speaker }) {
const [{ Machine }, { placed }, { screen }, { shapes }, { elements }] = await Promise.all([
  import('@moonbase-machines/apple2e/machine.js'), import('@moonbase-machines/apple2e/prodos.js'),
  import('@moonbase-machines/apple2e/screen.js'), import('@moonbase-machines/vector/pictures.js'), import('@moonbase-machines/vector/svg.js')]);
const vectors = setting(VECTORS);
// the title's saves on its own volume, the player's disk's (play.js `saves`): on line 2 the machine's files; on line 1
// written onto that volume's disk before it boots, and kept as the title's DOS writes it
const saving = saves.data;
let roms = null, disks = null;
if (makers?.apple) try {
  roms = makers.apple;
  disks = saves.disks(placed(saving, new Map(await Promise.all(game.images.map(async n => [n, await makers.image(n)])))));
} catch { roms = null; }
const m = new Machine(saving, { log: (...a) => console.log(...a), ...roms ? { roms, disks } : {} });
console.log(roms ? "line 1: Apple's ROMs, the disks booted" : "line 2: moonbase's machine");
saves.keep(roms ? saves.driveFiles(m, disks) : m.disk);
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


const rgba = new Uint8ClampedArray(560 * 384 * 4);
const image = new ImageData(rgba, 560, 384);
const cols = new Uint8Array(140 * 192);
let mode = '';
function frame() {
  if (!m.halted) m.runCycles(17030);   // a frame's worth of the Apple's clock, at 60 a second
  const now = `text ${m.sw.text} page2 ${m.sw.page2} hires ${m.sw.hires} dhires ${m.sw.dhires}`;
  if (now !== mode) { console.log('screen:', now, 'at pc $' + m.cpu.pc.toString(16), 'cycles', m.cpu.cycles); mode = now; }
  speaker.feed(sound ? m.clicks : [], m.cpu.cycles); m.clicks.length = 0;
  if (!hooked) hook();
  const text = m.sw.text;
  screen(m, rgba, { cols, owner: vectors.value && layer.innerHTML ? m.owner : null });
  ctx.putImageData(image, 0, 0);
  layer.style.visibility = vectors.value && !text ? 'visible' : 'hidden';
  status.textContent = m.halted ? 'The game has stopped: ' + m.halted + '.' : (m.idle > 2000 ? 'Waiting for a key.' : 'Running.');
  requestAnimationFrame(frame);
}
canvas.addEventListener('pointerdown', () => canvas.focus());
// (the keys, the Apple's codes, given by the player: play.js, keys.js)
let sound = true;
return {
  run() { canvas.focus(); frame(); },
  press(k) { console.log('key', k, 'at pc $' + m.cpu.pc.toString(16)); m.press(k); },
  start() { speaker.start(); },
  sound(on) { sound = on; },
  engine: m,
};
}

// A C64 game: on moonbase's own ROMs (@moonbase-machines/c64/rom.js), as the site has it everywhere, or on
// Commodore's where the page gives them (`roms`) and asks for them; the machine autostarted
// with LOAD"name",8,1, and RUN for a BASIC program, typed into the KERNAL's buffer, the frame on a canvas of
// 384 by 272 doubled, the keys as the matrix, the arrows its cursor keys, and a gamepad the joystick.
async function c64(g, { canvas, layer, speaker }) {
  const { game, saves, roms: makers, studies, status, printer } = g;
  const [{ C64 }, { keyboard, painter }, { SID }, { c64Roms, typed: startTyped }, { add }] = await Promise.all([
    import('@moonbase-machines/c64/machine.js'), import('@moonbase-machines/c64/browser.js'),
    import('@moonbase-machines/c64/sid.js'), import('@moonbase-machines/c64/start.js'), import('@moonbase-machines/c64/d64.js')]);
  const roms = await c64Roms(makers?.choice ?? null, makers?.load);
  if (!roms) { status.textContent = 'Commodore\'s ROMs, asked for, are not here.'; return null; }
  g.chargen = roms.chargen;   // (the printer's paper in the machine's characters: play.js)
  const m = new C64(game, roms, { log: (...a) => console.log(...a), printer });
  // What the game SAVEs to its disk, kept on the player's disk and given back to the drive the next time (play.js
  // `saves`)
  saves.drive(m.drive);
  // (and, where the page gives them, `studies`, files of its own for the disk, a name to a file: in the drive, not
  // kept)
  const raw = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
  for (const [file, data] of Object.entries(studies ?? {})) m.drive.saved.set(file, raw(data));
  layer.style.display = 'none';
  const draw = painter(canvas);
  let typing = null, typed = 0, sound = true;
  // the keys as the 64's matrix (@moonbase-machines/c64/browser.js), given them by the player (play.js)
  const listeners = { keydown: [], keyup: [] };
  const keys = keyboard(m, { log: true, listen: (type, f) => listeners[type].push(f) });
  // once BASIC is ready, the start typed in; the KERNAL's buffer takes ten characters at a time.
  // The C64 runs 50 frames a second, so frames are run to keep up with the clock, two at most.
  let frames = 0, sid = null, started = performance.now();
  function frame() {
    const due = Math.min(2, Math.floor((performance.now() - started) / 20) - frames);
    for (let i = 0; i < due; i++) {
      m.runFrame(); frames++; keys.frame();
      if (speaker.node && sound) {
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
  return {
    run() { canvas.focus(); frame(); },
    press(k) { m.type(String.fromCharCode(k)); },   // (into the KERNAL's buffer, as typed)
    key(e) { for (const f of listeners[e.type]) f(e); },
    start() { speaker.start(); },
    sound(on) { sound = on; },
    engine: m,
    // the disk as it now stands, its own files and those saved: a .d64 that VICE or a real 64 can use
    // (@moonbase-machines/c64/d64.js `add`)
    diskImage: () => add(m.drive.image, [...m.drive.saved].map(([name, data]) => ({ name, data }))),
  };
}

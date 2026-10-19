// The routines of a card title, for the remake engine, as its title.js `map` names them (cards.js):
// what each step of a script does. The toolkit's own code is lifted into scripts too, the
// libraries beside the scenes, and a step that is one of its entries runs that code inside
// itself, so that only the step is in the transcript, as the original's observer sees only the
// call. What cannot be a script is here: the routines that take their data inline (fill, copy
// and print), Applesoft's and the Monitor's routines in ROM (@moonbase-machines/apple2e/rom.js), ProDOS's calls
// (@moonbase-machines/apple2e/mli.js), and the keyboard and the soft switches. The screen is the hi-res pages in the
// engine's own memory, $2000 and $4000, written byte for byte as the original writes them.
import { describe, result, TAKES, GIVES } from './events.js';
import { INLINE, sectionName } from './cards.js';
import { Files, BLOCK, CLOCK } from '@moonbase-machines/apple2e/mli.js';
import { install as installRom } from '@moonbase-machines/apple2e/rom.js';
import { install as installKernal, VIC, VECTORS, kernalByte, KEY_TABLES } from '@moonbase-machines/c64/kernal.js';
import { Drive } from '@moonbase-machines/c64/drive.js';
import { Printer, bus } from '@moonbase-machines/c64/printer.js';
import { Basic } from '@moonbase-machines/c64/basic.js';
import { BasicError } from '@moonbase-machines/c64/numbers.js';
import { install as installBasicRom, printError } from '@moonbase-machines/c64/basic-rom.js';
import { lift, script as scriptOf, readers } from './lift.js';

const hex4 = n => n.toString(16).toUpperCase().padStart(4, '0');

// The inputs of a step: numbers for the registers it takes, the carry among them, or a
// register's own name for what it holds already. A number is a load the lifter folded into the
// step, and the load set the flags, which a routine may test before anything sets them again
// ($74FA tests A's): they are set as A's load set them, or else as the last register's.
function inputs(e, name, args) {
  const takes = TAKES[name] || '';
  let k = 0, loaded = null;
  for (const r of takes) {
    const v = args[k++];
    if (v === undefined || v === r || typeof v === 'object') continue;
    const n = v.startsWith('$') ? e.mem[parseInt(v.slice(1), 16)] : +v;
    if (r === 'c') e.c = n & 1; else { e[r] = n & 0xff; if (loaded !== 'a') loaded = r; }
  }
  if (loaded) e.flags(e[loaded]);
  return args.slice(k);
}

export function cardRoutines(title) {
  const toolkit = title.map;
  const c64 = title.disk.kind === 'c64';
  const files = c64 ? null : title.files ??= new Files(title.disk);
  // the soft switches: what the screen shows
  const screen = title.screen ??= { text: 1, mixed: 0, page2: 0, hires: 0 };
  // the keyboard's latch, its high bit set until $C010 is read
  let latch = 0;

  // The I/O page. The keyboard is read as the machine counts its reads (@moonbase-machines/apple2e/machine.js), every
  // read of $C000 and every touch of $C010 with no key waiting, and two thousand in a run stop it
  // to wait for a key (Engine.polled): so the remake waits where the original's run stopped, and
  // a scene that animates while it polls has run as many frames.
  // The language card, $C080 to $C08F: which of its two 4K banks is at $D000, and whether the card
  // or the ROM is read there. The engine has one memory, so the bank not there is kept aside and
  // swapped in when it is switched to (Pieces of Eight keeps its descriptions in one and its map
  // in the other). The card's write-protect, and the ROM's own bytes, are not kept.
  const lc = { bank: 2, read: 0, aside: new Uint8Array(0x1000) };
  const bankTo = (e, bank) => {
    if (bank === lc.bank) return;
    const here = e.mem.slice(0xd000, 0xe000); e.mem.set(lc.aside, 0xd000); lc.aside = here; lc.bank = bank;
  };
  // The Commodore 64's I/O page, $D000 to $DFFF while the 6510's port at $01 shows it there (and
  // its RAM while not): the VIC's registers, the SID's, the colours, and the two CIAs. The games
  // read the first CIA's timer and clock for their random numbers, which are the seed, as the
  // observer makes them (the pilots' observer); its keyboard and joystick lines read nothing
  // held, since the keys come through GETIN.
  const chip = title.chip = new Uint8Array(0x1000);   // (the view paints from it: @moonbase-machines/c64/paint.js)
  const SEEDED = { 4: s => s & 0xff, 5: s => s >> 8 & 0xff, 8: s => (s * 7) & 0xff, 9: s => (s * 13) & 0xff };
  function io64(e, at, v) {
    const r = at & 0xfff;
    if (r < 0x400) {   // the VIC, its 64 registers again every 64
      const reg = r & 0x3f;
      // the raster line, which a game waits on (Feeding Time for line 256, Petra's Dream for $D011's
      // top bit) and takes random numbers from with the CIA's: a line on at each read of $D012 or
      // $D011, whose top bit is its ninth, as the observer makes them (the pilots' observer), so
      // that both sides read the same. On the page's clock (`e.clock`), the line the original's
      // time has reached, 63 cycles each, so that a wait for one takes the time it took.
      if (v === undefined && (reg === 0x11 || reg === 0x12)) {
        e.raster = e.clock ? Math.floor(e.cycles / 63) % 312 : ((e.raster ?? 0) + 1) % 312;
        return reg === 0x12 ? e.raster & 0xff : (chip[0x11] & 0x7f) | (e.raster >> 1 & 0x80);
      }
      // which interrupt it is ($D019): the raster's, or none of the VIC's (the CIA's timer)
      if (v === undefined && reg === 0x19) return e.vicFlags ?? 0x70;
      if (v === undefined) return chip[reg];
      chip[reg] = v;
      // a raster interrupt's writes, kept by its line for the view (@moonbase-machines/c64/paint.js), until the
      // raster interrupt is turned off
      // (on the page's clock, the last whole frame's: a frame's writes are kept apart until its
      // raster comes round, routines.before, so that none lingers from a screen before)
      if (e.splitLine !== undefined && reg !== 0x19) { const s = e.clock ? (e.clock.splits ??= new Map()) : (title.splits ??= new Map()); (s.get(e.splitLine) ?? s.set(e.splitLine, new Map()).get(e.splitLine)).set(reg, v); }
      if (reg === 0x1a && !(v & 1)) title.splits?.clear();
      return;
    }
    if (r < 0x800) { const reg = 0x400 | (r & 0x1f); if (v === undefined) return chip[reg]; chip[reg] = v; e.sid?.push([e.cycles, r & 0x1f, v]); return; }   // the SID
    if (r < 0xc00) { if (v === undefined) return chip[r] | 0xf0; chip[r] = v & 15; return; }   // the colours
    if (r < 0xd00) {   // CIA 1
      const reg = r & 15;
      if (v === undefined) return SEEDED[reg] ? SEEDED[reg](title.seed ?? 0x11) : reg < 2 ? 0xff : reg === 0x0d ? 0 : chip[0xc00 | reg];
      chip[0xc00 | reg] = v; return;
    }
    if (v === undefined) return chip[r]; chip[r] = v;   // CIA 2, its first port the VIC's bank
    // (a raster interrupt's change of the bank kept with its line too, as $100: a map in a
    // bitmap above, text below, Goldfields' horse ride)
    if ((r & 15) === 0 && e.splitLine !== undefined) { const s = e.clock ? (e.clock.splits ??= new Map()) : (title.splits ??= new Map()); (s.get(e.splitLine) ?? s.set(e.splitLine, new Map()).get(e.splitLine)).set(0x100, v); }
  }
  const ioShown = e => (e.mem[1] & 3) !== 0 && (e.mem[1] & 4) !== 0;
  function io(e, at, v) {
    if (c64 && at >= 0xe000) { if (v === undefined) return kernalByte(at); e.mem[at] = v; return; }   // the KERNAL's keyboard tables, RAM under them written
    if (c64) return io64(e, at, v);
    if ((at & 0xfff0) === 0xc080) { const b = at & 15; bankTo(e, b & 8 ? 1 : 2); lc.read = (b & 1) === ((b >> 1) & 1) ? 1 : 0; return 0; }
    if (at >= 0xc050 && at <= 0xc057) { const s = ['text', 'mixed', 'page2', 'hires'][(at - 0xc050) >> 1]; screen[s] = at & 1; return 0; }
    if (at === 0xc000 && v === undefined) {
      // (none, -1, read here and not at a tick, is no key, as on the original, where it is pressed as nothing)
      if (!(latch & 0x80)) { const k = e.key(); if (k !== undefined && k >= 0) latch = k | 0x80; }
      if (++e.idle > 2000) e.polled = true;
      return latch;
    }
    if (at === 0xc010) { const r = latch; if (!(latch & 0x80) && ++e.idle > 2000) e.polled = true; latch &= 0x7f; return r; }
    // the speaker, a click at the cycle it came (Engine.time)
    if (at === 0xc030) { e.clicks.push(e.cycles); return 0; }
    return 0;
  }

  // Applesoft's and the Monitor's routines, as the machine has them (@moonbase-machines/apple2e/rom.js), on a stand-in
  // for its processor that reads and writes the engine's memory
  let engine = null;
  const cpu = { hooks: new Map(), cycles: 0, a: 0, x: 0, y: 0, z: 0, c: 0, n: 0, v: 0, read: a => engine.mem[a], write: (a, v) => { engine.mem[a] = v & 0xff; }, nz(v) { this.n = v >> 7 & 1; this.z = v ? 0 : 1; } };
  // the bell's clicks, at their cycles from the routine's start, the engine's then (`romFrom`)
  let romFrom = 0;
  if (c64) installKernal({ cpu, read: a => engine.read(a), write: (a, v) => engine.write(a, v), drive: title.bus ??= bus(title.drive ??= new Drive(Uint8Array.from(atob(title.disk.image), ch => ch.charCodeAt(0))), title.printer ??= new Printer({ on: false })),   // (the drive and a printer, device 4, on the bus: @moonbase-machines/c64/printer.js)
    // (a key let go before any scan saw it is seen once, as a tap)
    held: () => { const h = engine?.clock?.held; if (h?.up) engine.clock.held = null; if (h) h.seen = true; return h ?? null; },
    call: at => { runNow(engine, at, 'the keyboard read'); Object.assign(cpu, { a: engine.a, x: engine.x, y: engine.y, c: engine.c, z: engine.z, n: engine.n, v: engine.v }); },
    loaded: (name, from, to) => { (title.files64 ??= []).push({ name, from, to }); const script = title.fileScripts?.[name]; if (script) { const l = { script, from, to }; loaded.splice(0, Infinity, ...loaded.filter(k => k.from < l.from || k.to > l.to), l); } } });
  else installRom({ cpu, game: title.disk, sw: { lcRead: 0 }, io: a => io(engine, a), file: n => files.file(n), get files() { return files.files; }, put: (path, f) => files.put(path, f), remove: path => files.remove(path), clicks: { push: c => engine.clicks.push(engine.cycles + c - romFrom) }, log() {}, halted: false });
  const rom = (e, at) => {
    const f = cpu.hooks.get(at);
    // a Commodore 64's BASIC, which MENU runs NOTEBOOK (compiled BASIC) and ZOOTIME (BASIC) with
    if (!f && c64 && at >= 0xa000 && at < 0xc000) throw new Error('a BASIC program (Zoopak\'s NOTEBOOK or ZOOTIME): not written yet in the remake');
    if (!f) throw new Error('no ROM routine at $' + hex4(at));
    engine = e;
    // (the stack pointer as the call to the routine left it: the frames' place, less the call's two bytes)
    Object.assign(cpu, { a: e.a, x: e.x, y: e.y, c: e.c, z: e.z, n: e.n, v: e.v, pc: at, sp: e.sp() - 2 & 0xff });
    // a routine that reads the keyboard (RDKEY) waits, with no key, and the step runs again
    const start = romFrom = cpu.cycles;
    const r = f(cpu);
    if (r === 'wait') return 'wait';
    // the time a routine takes, which the original took: the Monitor's WAIT counts out
    // (26 + 27A + 5A²) / 2 cycles, and the bell its 192 clicks
    // and its RTS, as the machine's hook takes it
    e.delay += (cpu.cycles - start + 6) / CLOCK * 1000; e.cycles += cpu.cycles - start + 6;
    Object.assign(e, { a: cpu.a & 0xff, x: cpu.x & 0xff, y: cpu.y & 0xff, c: cpu.c, z: cpu.z, n: cpu.n });
    if (r === 'return') return r;   // (a routine that returns from its caller too: $E206 at a statement's end)
    // a routine that goes on elsewhere, not back: DOS 3.3's error exit, from a command printed through COUT, to where
    // DOS goes on (rom.js `dosError`)
    if (r === false && cpu.pc !== at) return { to: cpu.pc };
  };

  // Where an address of the lifted code is: a label in a script. The scenes all run at $AD00,
  // and PETPUZZLE is read over SCHOOL's end, so where scripts share an address the script is the
  // file read over it last (`loaded`, each ProDOS read of a script's file, its first and last
  // address, the newest last).
  const loaded = [];
  let index = null;
  // the scripts with a label at an address
  const labelled = (e, at) => {
    if (!index) {
      index = new Map();
      for (const name of Object.keys(e.sources)) {
        const p = e.script(name);
        for (const l of Object.keys(p.labels)) if (/^L[0-9A-F]{4}$/.test(l)) { const a = parseInt(l.slice(1), 16); (index.get(a) ?? index.set(a, []).get(a)).push(name); }
      }
    }
    return index.get(at) ?? [];
  };
  // Code a scene's lift missed, reached through a table or a vector its walk could not follow: on
  // a Commodore 64, lifted at need from the file's bytes in memory where it was loaded, with the
  // same lifter (lift.js), and said, so that the entry goes into the scene's lift.
  const atNeed = (e, at) => {
    // (or code no file put there, which a file's own code made: Goldfields' TITLE unpacks its
    // picture and code to $8000 and jumps to $7F40; from the RAM below BASIC's ROM)
    const f = title.files64?.findLast(f => f.from <= at && at <= f.to) ?? (at >= 0x0200 && at < 0xa000 ? { name: 'MEMORY', from: 0x0200, to: 0x9fff } : null);
    if (!f) return null;
    const bytes = e.mem.slice(f.from, f.to + 1), name = (title.fileScripts?.[f.name] ?? f.name) + '@' + hex4(at);
    const lifted = lift(bytes, f.from, [at], toolkit.routines, new Set(), readers(INLINE));
    e.sources[name] = scriptOf(lifted, bytes, f.from, { selfModified: true });
    index = null;
    loaded.push({ script: name, from: f.from, to: f.to });
    (title.liftedAtNeed ??= []).push(f.name + ' $' + hex4(at));
    console.warn(`lifted at need: ${f.name} from $${hex4(at)} (an entry for its scene's lift)`);
    return name;
  };
  // (on a Commodore 64, a file's scene only while that file is what is loaded there: Goldfields'
  // CODE is at $8018 when the boot calls it, and TEXT/CODE, loaded over it later, has a label there)
  const fileScripts = new Set(Object.values(title.fileScripts ?? {}));
  const present = (names, at) => !c64 ? names : names.filter(n => !fileScripts.has(n) || loaded.some(l => l.script === n && l.from <= at && at <= l.to));
  const find = (e, at) => {
    let names = present(labelled(e, at), at);
    if (!names.length && c64 && atNeed(e, at)) names = present(labelled(e, at), at);
    const over = loaded.findLast(l => names.includes(l.script) && l.from <= at && at <= l.to);
    const name = names.length > 1 ? over?.script : names[0];
    if (!name) throw new Error('no script has $' + hex4(at));
    return [name, 'L' + hex4(at)];
  };
  // an address the ROM's routine answers: above $D000, unless the card is read there and a script
  // has its code there (Pieces of Eight's PO8:BLINK, over HPOSN and DRAW), or below where rom.js answers DOS's own
  // (INITIOHK, $A851) and no script has code; on a Commodore 64, where
  // the 6510's port shows the KERNAL ($E000 on) or BASIC ($A000 to $BFFF: Tell-A-Tale's numbers,
  // over MENU's code in the RAM under it)
  const romAt = (e, a) => c64 ? (a >= 0xe000 ? (e.mem[1] & 2) !== 0 : a >= 0xa000 && a < 0xc000 ? (e.mem[1] & 3) === 3 : a === 0x73 || a === 0x79) : a >= 0xd000 ? !(lc.read && labelled(e, a).length) : cpu.hooks.has(a) && !labelled(e, a).length;
  // the stir of START.SYSTEM's wait: its calls are no steps
  const stirring = step => toolkit.stir && step?.at >= toolkit.stir.from && step.at <= toolkit.stir.to;
  const emit = (e, ev, quiet) => { if (quiet) e.inside++; e.emit(ev); if (quiet) e.inside--; };

  // a return, as the engine's: to the caller, and out of a routine run inside a step
  const back = x => { const f = x.stack.pop(); if (f.name !== x.name) x.enter(f.name); x.pc = f.pc; if (f.inside) { x.inside--; f.done?.(x); } f.after?.(x); };
  // the town's loop, the restart and escape (into LIB4's screens) are the game going on, and run
  // as it, with no return
  const through = new Set(['town', 'restart', 'escape']);
  // The data a step takes inline, read from memory after its call as the original reads it,
  // since a scene may write into it (the name, into the text LIB.VARS prints); the script's own
  // words are what the file held, for a step with no address
  const inline = (e, step, n, args) => {
    if (step?.at == null) return args.map(h => parseInt(h, 16));
    const b = []; for (let i = 0; i < n; i++) b.push(e.mem[(step.at + 3 + i) & 0xffff]); return b;
  };
  const words = b => b.map(v => v.toString(16)).join(' ');
  // an event without where in memory its data is, for a title whose strings are not where the
  // original's are (its map's `unplaced`: Goldfields' SETNAM, its name in BASIC's strings)
  const unplaced = ev => { if (toolkit.unplaced?.includes(ev.step)) { delete ev.x; delete ev.y; } return ev; };
  // a step of the original's ROM: its event, then the routine
  // The KERNAL's calls that go through a vector in RAM, as the KERNAL's jump table does (JMP
  // ($0326) for CHROUT): where the game has pointed one at a routine of its own (Zoopak's MENU
  // draws its text into its bitmap), that routine runs, its lifted code inside the step.
  // (Not LOAD's: the emulator answers LOAD at $F49E, past its vector, as the 1541 does in
  // @moonbase-machines/c64/drive.js, so MENU's fast loader, which talks to a drive's own processor over the
  // serial lines, is set up and never run; the remake does the same.)
  const VECTORED = { chrout: [0x326, 0xf1ca], chrin: [0x324, 0xf157], getin: [0x32a, 0xf13e], save: [0x332, 0xf5ed] };
  const inRom = (name, at) => (e, args, step) => {
    inputs(e, name, args); emit(e, unplaced(describe(name, [], e, undefined, undefined, a => e.mem[a])), stirring(step));
    const v = c64 && VECTORED[name], to = v && (e.mem[v[0]] | e.mem[v[0] + 1] << 8);
    if (v && to !== v[1]) { const [script, label] = find(e, to); e.callInside(script, label, x => { if (GIVES[name]) x.emit(result(name, { a: x.a, x: x.x, y: x.y, c: x.c })); }, step?.at == null ? undefined : (step.at + 2) & 0xffff); return; }
    const r = rom(e, at);
    if (r === 'wait') return 'wait';
    // (gone on elsewhere: the code there run inside the step, the routine's return still on the stack, as the
    // original's is, until that code drops it, as Pieces of Eight's handler ($93F0) does with a TXS to the frames
    // under it, kept at their place for it (Engine.stackPage))
    if (r?.to !== undefined) {
      e.stackPage();
      e.stack.push({ name: e.name, pc: e.pc, inside: true, ret: step?.at == null ? undefined : (step.at + 2) & 0xffff }); e.inside++;
      return routines['goto-engine'](e, ['$' + hex4(r.to)], step);
    }
    if (GIVES[name] && c64) e.emit(result(name, { a: e.a, x: e.x, y: e.y, c: e.c }));
  };

  const routines = {
    // fill, copy, print and say, which take their data inline after the call, run their lifted
    // code as the other entries do: the call's frame gives the code its return address to read
    // the data from, and the code returns past it (Engine.pull, Engine.ret)
    // ProDOS: the call and its parameters' address inline; a read of a script's file is noted,
    // where it went, for the scripts that share addresses
    prodos: (e, args, step) => {
      const b = inline(e, step, 3, args), [cmd, lo, hi] = b, params = lo | hi << 8;
      emit(e, describe('prodos', [], e, words(b)), stirring(step));
      const mem = { read: a => e.mem[a], write: (a, v) => { e.mem[a] = v & 0xff; } };
      if (cmd === 0xca) {
        const ref = e.mem[params + 1], o = files.open.get(ref), to = e.mem[params + 2] | e.mem[params + 3] << 8;
        const n = o ? Math.min(e.mem[params + 4] | e.mem[params + 5] << 8, o.f.body.length - o.at) : 0;
        const script = o && title.fileScripts?.[sectionName(toolkit, a => e.mem[a], o.f.path, o.at)];
        if (script && n) {
          const l = { script, from: to, to: to + n - 1 };
          loaded.splice(0, Infinity, ...loaded.filter(k => k.from < l.from || k.to > l.to), l);
        }
        // a disk's time for the blocks read
        e.delay += Math.ceil(n / 512) * BLOCK / CLOCK * 1000;
      }
      let err = files.call(cmd, params, mem);
      e.cycles += 6;   // the RTS, as the machine's hook at $BF00 takes it
      if (err === null) err = 1;
      e.a = err === 'quit' ? 0 : err; e.c = e.a ? 1 : 0; e.z = e.a ? 0 : 1;
      if (err === 'quit') e.ended = true;
    },
    // START.SYSTEM's stirring wait is over: the counts it leaves are the seed, as on the original
    stirred: e => { for (const a of toolkit.stir.counts) e.mem[a] = title.seed & 0xff; },
    hposn: inRom('hposn', 0xf411), hlin: inRom('hlin', 0xf53a), hcolor: inRom('hcolor', 0xf6f0), 'clear-page': inRom('clear-page', 0xf3f4),
    pause: inRom('pause', 0xfca8), home: inRom('home', 0xfc58), outport: inRom('outport', 0xfe95),
    // a call or a jump to an address outside the script: into the lifted code where it is, or
    // into the ROM
    'call-engine': (e, [at], step) => {
      const a = parseInt(at.slice(1), 16);
      if (romAt(e, a)) { const r = rom(e, a); if (r === 'return') { back(e); return; } return r; }
      // (code the game has made a bare RTS since: back at once, the RTS's time taken, as
      // Detect-A-Pet's room hook at $AD03, which it sets to RTS in most rooms)
      if (!c64 && e.mem[a] === 0x60) { e.cycles += 6; return; }
      const [name, label] = find(e, a);
      e.stack.push({ name: e.name, pc: e.pc, ret: step?.at == null ? undefined : (step.at + 2) & 0xffff }); e.enter(name, label);
    },
    // a jump to one of the toolkit's entries is that step: the town's loop and the restart, which
    // never come back
    'goto-engine': (e, [at], step) => {
      const a = parseInt(at.slice(1), 16), entry = toolkit.routines[a];
      if (entry) {
        if (through.has(entry)) return routines[entry](e, [], step);
        // a jump to a routine that comes back: it returns for the code that jumped, to its caller
        // (the ROM's SYS, on a Commodore 64, which makes it the ROM's call, and no event)
        const quiet = c64 && e.stack.at(-1)?.rom;
        if (quiet) e.inside++;
        let r; try { r = routines[entry](e, [], step); } finally { if (quiet) e.inside--; }
        const f = e.stack.at(-1);
        if (f?.inside) { const done = f.done; f.done = x => { done?.(x); back(x); }; } else back(e);
        return r;
      }
      if (romAt(e, a)) {
        if (rom(e, a) === 'wait') return 'wait';
        if (c64 && ENDS.has(a)) pullRegisters(e);   // the end of an interrupt: the registers back, then its RTI
        back(e); return;   // as its RTS: out of a routine it ends
      }
      // (code the game has written since, a JMP: on through it, as Pieces of Eight's at $A6D8, into DOS's error exit)
      if (!c64 && e.mem[a] === 0x4c && !labelled(e, a).length) return routines['goto-engine'](e, ['$' + hex4(e.mem[a + 1] | e.mem[a + 2] << 8)], step);
      e.enter(...find(e, a));
    },
  };

  // A Commodore 64 title's BASIC (Goldfields: its boot, GOLDFIELDS, BASIC's text, and its game,
  // GAME, Blitz!'s code), compiled to scripts whose steps the library in @moonbase-machines/c64/basic.js does,
  // the engine's `basic`. SYS runs the machine code at its address, with BASIC's text pointer
  // ($7A) at the text after it and the registers from $030C, as the ROM's SYS does; the machine
  // code reads its parameters from that text with the ROM's routines, which are answered here
  // from the parameters' expressions, compiled with the program (`params`).
  if (c64 && title.basic) {
    routines.sys = (e, at, text, step) => {
      e.mem[0x7a] = text & 0xff; e.mem[0x7b] = text >> 8;
      const m = e.mem; Object.assign(e, { a: m[0x30c], x: m[0x30d], y: m[0x30e], c: m[0x30f] & 1, z: m[0x30f] >> 1 & 1, n: m[0x30f] >> 7 });
      // and as it returns, the registers kept at $030C, as the ROM's SYS keeps them (Goldfields'
      // map reads where the digger may go from them, C = PEEK(780))
      const keep = x => { m[0x30c] = x.a; m[0x30d] = x.x; m[0x30e] = x.y; m[0x30f] = x.c | x.z << 1 | (x.i ?? 0) << 2 | (x.d ?? 0) << 3 | x.v << 6 | x.n << 7; };
      if (romAt(e, at)) { const r = rom(e, at); keep(e); return r; }
      // (the frame is the ROM's SYS, as the machine code's return address is: a jump from the
      // code to the KERNAL is the ROM's call then, as the observer sees it)
      const [name, label] = find(e, at);
      e.stack.push({ name: e.name, pc: e.pc, rom: true, after: keep }); e.enter(name, label);
    };
    // the boot's LOAD: the file, as BASIC loads it from a program, which then runs again from its
    // start with its variables kept; or, for a BASIC program loaded over it (GAME, at $0801),
    // that program from its start
    routines['basic-load'] = (e, [name, device = 1, sa = 0]) => {
      const m = e.mem; for (let k = 0; k < name.length; k++) m[0x200 + k] = name.charCodeAt(k);
      Object.assign(m, { 0xb7: name.length, 0xbb: 0x00, 0xbc: 0x02, 0xba: device, 0xb9: sa, 0xb8: 0 });
      Object.assign(e, { a: 0, x: 0x01, y: 0x08 });
      e.basic.call('load');
      const program = Object.entries(title.basic).find(([, p]) => p.file === name);
      if (sa === 0 && program) { startBasic(e, program[0]); e.enter(program[0]); return; }
      e.pc = 0;
    };
    // BASIC's routines the machine code reads its parameters with, and the rest it calls
    // (@moonbase-machines/c64/basic-rom.js), the parameters' values from the expressions compiled with the program
    installBasicRom({ cpu, read: a => engine.read(a), write: (a, v) => engine.write(a, v),
      evaluate: at => {
        const p = engine.sources[engine.basic.script]?.params?.[at];
        if (!p) throw new Error('no parameter compiled at $' + hex4(at));
        const [end, f, place] = p;
        return { value: f(engine.basic), end, place };
      } });
  }
  // A BASIC error, as the ROM's routine gives it ($A43A, through the vector at $0300 Goldfields
  // leaves the ROM's): the output back to the screen, a new line, ? and the message, ERROR, IN and
  // the "line", which for Blitz!'s code is its program counter at the instruction that failed,
  // then READY.; the program is over. Its output is the ROM's, through CHROUT, and no events.
  if (c64 && title.basic) routines.error = (e, err) => {
    if (!(err instanceof BasicError) || !e.basic) return false;
    engine = e;
    return printError({ cpu, write: (a, v) => { e.mem[a] = v; } }, err.message, e.basic.at);
  };
  const startBasic = (e, name) => { e.basic = new Basic(e, title.basic[name]); e.basic.script = name; };
  // every other entry of the toolkit runs its lifted code inside its step
  for (const [at, name] of Object.entries(toolkit.routines).map(([a, n]) => [+a, n])) {
    // a routine of the ROM's, above $D000, is its step in @moonbase-machines/apple2e/rom.js
    if (!routines[name] && at >= 0xd000) routines[name] = inRom(name, at);
    if (routines[name] || at >= 0xbf00) continue;
    routines[name] = (e, args, step) => {
      inputs(e, name, args);
      // the game going on from inside a routine (Escape read by the key reader): what it was
      // inside is the game's own code now, as the observer's count of calls starts again, and
      // the returns still to come give nothing
      if (through.has(name) && e.inside) { for (const f of e.stack) if (f.inside) { delete f.inside; delete f.done; } e.inside = 0; }
      // its code where the call goes, when another of the same name is elsewhere (LIB4 says its
      // messages by its own $8046, the scenes by LIB2's $144B, a JMP to $1C11): the operand of
      // the call, or else the first of that name
      const to = step?.at != null ? e.mem[(step.at + 1) & 0xffff] | e.mem[(step.at + 2) & 0xffff] << 8 : null;
      const quiet = stirring(step), entry = toolkit.routines[to] === name ? to : parseInt(Object.entries(toolkit.routines).find(([, n]) => n === name)[0]);
      if (name === 'read-key') { e.mem[toolkit.seed] = title.seed & 0xff; e.mem[toolkit.seed + 1] = title.seed >> 8; }
      // the data after the call, as the observer reads it (cards.js)
      const data = INLINE[name] && step?.at != null ? INLINE[name](a => e.mem[a & 0xffff], step.at + 3).value : undefined;
      emit(e, describe(name, [], { a: e.a, x: e.x, y: e.y, c: e.c }, data, undefined, a => e.mem[a]), quiet);
      const [script, label] = find(e, entry);
      // (escape is called, as the original's JSR: LIB4 keeps the stack with its return (TSX at
      // $8E63), and Return to present game goes back through it to where Escape was read)
      if (name === 'escape' && step?.at != null) e.stack.push({ name: e.name, pc: e.pc, ret: (step.at + 2) & 0xffff });
      if (through.has(name)) { e.enter(script, label); e.entered = entry; return; }
      // the key reader's counts of its wait are the seed again as it returns, as on the original
      const seed = x => { x.mem[toolkit.seed] = title.seed & 0xff; x.mem[toolkit.seed + 1] = title.seed >> 8; };
      e.callInside(script, label, x => { if (name === 'read-key') seed(x); if (GIVES[name] && !quiet) x.emit(result(name, { a: x.a, x: x.x, y: x.y, c: x.c })); }, step?.at == null ? undefined : (step.at + 2) & 0xffff);
    };
  }
  // A call or a jump to a label of the script's own that a file read since covers with another
  // script's code: SCHOOL's $B670 on, once PETPUZZLE is read there
  routines.elsewhere = (e, label) => {
    const at = parseInt(label.slice(1), 16), over = loaded.findLast(l => l.from <= at && at <= l.to);
    return over !== undefined && over.script !== e.name && /^L[0-9A-F]{4}$/.test(label);
  };
  // A tick (its map's `ticks`): before the scene's read of the keyboard, the run stops for a key
  // or none (-1), and the read takes it.
  // the original's code is in memory where its lines came from: the engine counts their time
  routines.timed = true;
  // how many polls with no key are a wait (its map's `polls`; a pilot's route can set the
  // engine's own, `e.polls`, for a stretch of keys: the pilots' `pollsAt`)
  routines.polls = toolkit.polls;
  routines.reads = toolkit.reads;   // and how many reads of the clock are a tick of it (basic.js `ti`)
  // GETIN on the Commodore 64: the key pressed, or none; called without end while the game waits,
  // so many in a row with no key is the wait, as the observer counts them (the pilots' observer).
  // The KERNAL's buffer first, where the interrupt puts a key it holds down (MENU's), then the
  // page's keys.
  if (c64) routines.getin = e => {
    if (!e.clock && !e.i) { routines.poll(e); e.polledSince = true; }
    let k;
    if (e.mem[0xc6]) { k = e.mem[0x277]; e.mem.copyWithin(0x277, 0x278, 0x277 + e.mem[0xc6]); e.mem[0xc6]--; } else k = e.key();
    e.c = 0;
    if (k === undefined || k < 0) { e.a = e.flags(0); if (++e.idle > (e.polls ?? toolkit.polls ?? 200) && !e.clock) e.polled = true; return; }
    e.a = e.flags(k); e.idle = 0; e.emit(result('getin', { a: k }));
    // (on the page's clock the game runs on as the original did, waiting or not)
  };
  // The Commodore 64's interrupt, through $0314 sixty times a second: the KERNAL's own (the clock),
  // or a game's, which does what the game shows in time (Petra's Dream cycles its flames' colour
  // and plays its sounds; MENU's, which it goes on to, flips its title's two screens and reads the
  // joystick) and goes on to the KERNAL's end of an interrupt, its RTI, where the registers and
  // flags come back. The remake keeps no time of the machine's: it takes one at each call of GETIN,
  // as the observer has the original take it (the pilots' observer), and then the VIC's raster
  // interrupt, where the game has turned it on ($D01A), at the line it set (Find Me's split of its
  // screen into two character sets), $D019 saying which it is. On the page's clock (
  // scenes.js sets `e.clock`), each is taken as the original's chips took it: the CIA's every 16,421
  // cycles of the original's time, the raster's when its line comes (routines.before). Not while
  // the game has them masked (SEI). The routine starts as the KERNAL's own entry ($FF48) leaves
  // it, with A, X and Y pushed, and the KERNAL's end ($EA31, $EA7B, $EA7E, $EA81), or its own PLAs
  // and RTI, pulls them.
  const ENDS = new Set([0xea31, 0xea7b, 0xea7e, 0xea81]);
  // a poll's interrupts, as the observer takes them: the CIA's, then the raster's where it is on
  routines.poll = e => { routines.interrupt(e); if (chip[0x1a] & 1) routines.interrupt(e, true); };
  const pullRegisters = e => {
    for (const r of ['y', 'x', 'a']) { const f = e.stack.pop(); if (f?.a === undefined || f.name !== undefined) throw new Error('the end of an interrupt with its registers not on the stack'); e[r] = f.a; }
  };
  if (c64) routines.interrupt = (e, raster = false) => {
    if (e.i) return;
    const to = e.mem[0x314] | e.mem[0x315] << 8, kept = { a: e.a, x: e.x, y: e.y, n: e.n, z: e.z, c: e.c, v: e.v, d: e.d };
    e.vicFlags = raster ? 0xf1 : 0x70;
    if (raster) e.splitLine = chip[0x12] | (chip[0x11] & 0x80) << 1;
    try {
      if (romAt(e, to)) rom(e, to);   // the KERNAL's own routine ($EA31, or past its clock, $EA34)
      else { e.i = 1; runNow(e, to, 'the interrupt routine', x => x.stack.push({ a: kept.a }, { a: kept.x }, { a: kept.y })); }
    } finally { Object.assign(e, kept); e.i = 0; e.vicFlags = e.splitLine = undefined; }
  };
  // the game's code at an address run now to its return, inside whatever is running: the
  // interrupt's routine, or one the KERNAL calls through a vector
  function runNow(e, at, what, then) {
    let over = false;
    e.callInside(...find(e, at), () => { over = true; });
    then?.(e);
    for (let n = 0; !over; n++) {
      if (n > 1e6) throw new Error(what + ' at $' + hex4(at) + ' runs on without end');
      if (e.exec(e.program.steps[e.pc]) === 'wait') throw new Error(what + ' at $' + hex4(at) + ' waits');
    }
  }
  // the length of the data after a step's call, the lifted lines leave out (Engine.cost)
  routines.inline = (e, step) => INLINE[step.words[0]] ? INLINE[step.words[0]](a => e.mem[a & 0xffff], step.at + 3).length : 0;
  // And a routine of the title's, reached by a jump or a branch with nothing running (Pieces of
  // Eight jumps to its description routine, $0A59): its step, as the observer's hook makes it
  // wherever the routine is reached from, and the frame on top, the caller of the code that
  // jumped, which the routine returns through, ends it.
  routines.before = (e, step) => {
    if (c64 && e.clock && !e.i) {
      if (e.cycles >= e.clock.irq) { e.clock.irq = Math.max(e.clock.irq + 16421, e.cycles); routines.interrupt(e); }
      // the raster's, when the line it waits for has come since the last step
      const line = Math.floor(e.cycles / 63) % 312, last = e.clock.line ?? line, target = chip[0x12] | (chip[0x11] & 0x80) << 1;
      e.clock.line = line;
      if (line < last) { title.splits = e.clock.splits ?? new Map(); e.clock.splits = new Map(); }   // a frame round: its splits the view's
      if (chip[0x1a] & 1 && (last <= line ? last < target && target <= line : target > last || target <= line)) routines.interrupt(e, true);
    }
    // (the town's, the restart's and escape's own steps go on into their code: not twice)
    const at = step.start ?? step.at, named = at != null && e.inside === 0 ? toolkit.routines[at] : undefined, own = e.entered === at;
    e.entered = null;
    if (named && !own && !stirring(step)) {
      emit(e, describe(named, [], { a: e.a, x: e.x, y: e.y, c: e.c }, undefined, undefined, a => e.mem[a]));
      const f = e.stack.at(-1);
      if (f?.name !== undefined && !f.inside) { f.inside = true; f.done = x => { if (GIVES[named]) x.emit(result(named, { a: x.a, x: x.x, y: x.y, c: x.c })); }; e.inside++; }
    }
    const t = toolkit.ticks?.find(t => t.at === step.at && e.name === title.fileScripts?.[t.scene]);
    if (!t) return;
    if (e.ticking === step) { e.ticking = null; if (e.keys[0] === -1) e.keys.shift(); return; }
    e.emit({ step: 'tick' }); e.ticking = step;
    return 'wait';
  };
  // before the start: the files the machine puts in memory itself (START.SYSTEM, where ProDOS
  // would have read it), the bytes it gives (MACHID), and the I/O page
  routines.setup = e => {
    // a Commodore 64 as it is when the game's boot program starts: the 6510's port showing the
    // ROMs and the I/O page, the VIC as the KERNAL set it up and its bank the first, the screen at
    // $0400 in light blue, device 8 and secondary address 1 the last used; and the boot loaded where it goes, over the stack
    if (c64) {
      // (the compiled scenes reach only the title's `io` through the hook: it must hold all this)
      if (!title.io || title.io[0] > 0xd000 || title.io[1] < KEY_TABLES[1] - 1) throw new Error('a Commodore 64 title\'s io must cover $D000 to the KERNAL\'s keyboard tables');
      e.ioAt = at => (at >= 0xd000 && at <= 0xdfff && ioShown(e)) || (at >= KEY_TABLES[0] && at < KEY_TABLES[1] && (e.mem[1] & 2) !== 0);
      Object.assign(e.mem, { 0: 0x2f, 1: 0x37, 0x99: 0, 0x9a: 3, 0xb9: 1, 0xba: 8, 0x288: 4, 0x286: 14 });   // (input from the keyboard, output to the screen; LOAD"ZOOPAK",8,1 left device 8, secondary address 1)
      // the keyboard as the KERNAL keeps it: no key down, the cursor not blinking, a buffer of ten,
      // the repeat's counts, and the decode's vector its own
      Object.assign(e.mem, { 0xc5: 0x40, 0xcb: 0x40, 0xcc: 1, 0x289: 10, 0x28a: 0, 0x28b: 4, 0x28c: 0x10, 0x28f: 0x48, 0x290: 0xeb });
      VIC.forEach((v, i) => { chip[i] = v; }); chip[0xd00] = 0x97;
      VECTORS.forEach((v, i) => { e.mem[0x314 + 2 * i] = v & 0xff; e.mem[0x315 + 2 * i] = v >> 8; });   // the KERNAL's own vectors
      for (let i = 0; i < 1000; i++) { e.mem[0x400 + i] = 0x20; chip[0x800 + i] = 14; }
      for (const [name, at] of Object.entries(title.load ?? {})) { const raw = title.drive.find(Uint8Array.from(name, ch => ch.charCodeAt(0))).raw; e.mem.set(raw.subarray(2), at); }
      e.io = (at, v) => io(e, at, v);
      // a program in BASIC starts from BASIC's READY, RUN typed: the cursor's blink as it was then
      if (title.basic) { Object.assign(e.mem, { 0xcd: 2, 0xce: 0x20, 0xcf: 0, 0x287: 0xfe }); startBasic(e, title.start); }
      return;
    }
    for (const [path, at] of Object.entries(title.load ?? {})) e.mem.set(files.file('/' + files.volumes[0] + '/' + path).body, at);
    // a DOS 3.3 disk: what its Applesoft program did, as the machine does it (@moonbase-machines/apple2e/machine.js boot):
    // each file loaded where the program puts it, the language card's bank as it says, then the
    // card read and written in bank 1, the screen cleared, the text window from row 16, and the
    // CALL; in the time the disk took
    if (title.disk.kind === 'dos33') {
      for (let r = 0; r < 24; r++) e.mem.fill(0xa0, 0x400 + (r & 7) * 0x80 + (r >> 3) * 40, 0x400 + (r & 7) * 0x80 + (r >> 3) * 40 + 40);
      for (const [name, at, bank] of title.disk.loads) {
        if (bank) bankTo(e, bank);
        e.mem.set(files.file(name).body, at);
      }
      bankTo(e, 1); lc.read = 1;
      Object.assign(e.mem, { 0x20: 0, 0x21: 40, 0x22: 16, 0x23: 24, 0x32: 0xff });
      e.delay = 2500;
    }
    e.io = (at, v) => io(e, at, v);
  };
  return routines;
}

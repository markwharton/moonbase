// The remake engine: it runs a title's scene scripts, and everything a scene does is an event.
// It draws nothing itself. A view listens to the events and draws them however it likes, and a
// pilot reads them as the transcript to hold against the original's.
//
// A script's statements act on three registers, a, x and y, four flags, a stack, and 64K of
// memory, as the lines they were lifted from did, so the logic of a scene is kept exactly. Its
// steps are the engine's work, which the title's routines do: a text, a picture, a wait.
//
//   const e = new Engine({ routines, scripts, start })
//   e.run()          runs until the title waits for a key: 'idle', or 'end'
//   e.press(key)     a key, as a character code; the waiting step takes it on the next run
//   e.on(event => ...)
//   e.onKey(key => ...)   each key as the title's keyboard takes it (key()), apart from the events, which stay the
//                         transcript; returns a function that stops it
import { parse, operand, words, branchTaken } from './script.js';
import { CYCLES } from '@moonbase-machines/mos6502/cpu.js';

// what a routine throws when the title leaves what it was doing (Engine.leave)
const LEFT = { left: true };
// the words that start a statement rather than a routine's step
const STATEMENTS = new Set(['if', 'goto', 'call', 'return', 'compare', 'test', 'asm', 'push', 'pull']);
const STATEMENT = step => STATEMENTS.has(step.words[0]) || /^(=|\+=|-=|&=|\|=|\^=|<<=|>>=|rotate)$/.test(step.words[1]);
const CYCLES_PER_MS = 1020.484;
// an instruction's size by its opcode, the 6502's: by the addressing mode its bits give
function size(op) {
  if (op === 0x20) return 3;
  if (op === 0x00 || op === 0x40 || op === 0x60) return 1;
  const b = op >> 2 & 7, cc = op & 3;
  if (cc === 1) return b === 3 || b === 6 || b === 7 ? 3 : 2;
  if (b === 0) return cc === 2 || (op & 0xe0) >= 0xa0 ? 2 : 1;
  if (b === 2 || b === 6) return cc === 0 || cc === 2 ? 1 : 2;
  if (b === 4) return cc === 0 ? 2 : 2;
  return b === 3 || b === 7 ? 3 : 2;
}
// what the lifter leaves out of its lines: a NOP, and a load of A, X or Y, immediate, zero page
// or absolute, or CLC or SEC, that it takes into the step after as its input
const LEFT_OUT = new Set([0xea, 0xa9, 0xa2, 0xa0, 0xa5, 0xa6, 0xa4, 0xad, 0xae, 0xac, 0x18, 0x38]);
const COMPARED = step => step.words[0] === 'if' && step.words.length === 6;
// the return address a call leaves on the 6502's stack, its JSR's last byte
const returnOf = step => step?.at == null ? undefined : (step.at + 2) & 0xffff;
// an address as a script's label, L8157
export const label16 = at => 'L' + at.toString(16).toUpperCase().padStart(4, '0');

export class Engine {
  constructor({ routines, scripts, start, label, memory = {} }) {
    this.routines = routines; this.sources = scripts;
    this.mem = new Uint8Array(0x10000);
    for (const [at, v] of Object.entries(memory)) this.mem[at] = v;
    this.a = 0; this.x = 0; this.y = 0;
    this.n = 0; this.z = 0; this.c = 0; this.v = 0; this.d = 0;
    this.stack = []; this.keys = []; this.listeners = []; this.takers = []; this.ended = false;
    // the time the original took, in its cycles, for a title whose code is in memory where its
    // lines came from (`timed`): each line its instruction's, and the speaker's clicks by it
    this.timed = !!routines.timed; this.cycles = 0; this.clicks = []; this.delay = 0;
    this.programs = {};
    // what the title's routines set up before the start: memory, the I/O page (`io`)
    routines.setup?.(this);
    this.enter(start, label, true);
  }

  on(f) { this.listeners.push(f); }
  // An event made while `inside` is above nought is part of a routine's own work, as the choice
  // PROB2 draws while its ask waits: the view draws it, but it is no step of the transcript.
  emit(event) { if (this.inside) event.inside = true; for (const f of this.listeners) f(event); }
  inside = 0;
  press(key) { this.keys.push(key); }
  key() { const k = this.keys.shift(); if (k !== undefined) for (const f of this.takers) f(k); return k; }
  onKey(f) { this.takers.push(f); return () => { this.takers = this.takers.filter(g => g !== f); }; }

  // start a script from its first step, or from a label in it; when it is loaded, as the original
  // loads its file, its data goes into memory, and otherwise memory is as the game left it
  enter(name, label, load = false) {
    const p = this.script(name);
    if (load) for (const d of p.data) this.mem.set(d.bytes, d.at);
    this.program = p; this.name = name; this.pc = label === undefined ? 0 : this.label(label);
  }
  // a script by its name, as written (a scene, run line by line) or compiled (compile.js)
  script(name) {
    if (this.programs[name]) return this.programs[name];
    const src = this.sources[name];
    if (src === undefined) throw new Error('no script ' + name);
    const p = this.programs[name] = typeof src === 'string' ? parse(src, name) : {
      labels: src.labels,
      data: src.data.map(([at, bytes]) => ({ at, bytes })),
      steps: src.steps.map(([at, line, text], k) => ({ at, text, where: name + ':' + line, run: src.run[k], words: words(text), index: k })),
    };
    // a step whose label is before it starts there: the lines the lifter took into it (Engine.cost)
    for (const [l, k] of Object.entries(p.labels)) { const at = /^L[0-9A-F]{4}$/.test(l) ? parseInt(l.slice(1), 16) : null; if (at !== null && p.steps[k]?.at > at) p.steps[k].start = at; if (at !== null && p.steps[k]?.at === at) p.steps[k].entered = true; }
    return p;
  }
  // Leave everything running, the scripts called and a problem with them, for a label: as the
  // original jumps to its Main Menu from the key reader, and resets the stack. The routine that
  // leaves goes no further.
  // A routine of the title's own code, run inside the step that calls it: its steps are part of
  // that step's work, and no steps of the transcript; `done` is called as it returns.
  callInside(name, label, done, ret) {
    this.stack.push({ name: this.name, pc: this.pc, inside: true, done, ret });
    this.inside++;
    this.enter(name, label);
  }
  leave(name, label) {
    this.stack = []; this.problem = null; this.waitingOn = null; this.visited = null;
    this.enter(name, label);
    throw LEFT;
  }
  // Nature Park's menus, from a key reader on control-E or control-T ($4C28): the routine that
  // read the key asks for them and waits, so that a problem it is inside goes on living; then what
  // was running is kept, with the screen, and the menus run as a routine, the A it gives them 2.
  // When they return, all is put back and the routine waits for a key again, as the original's
  // key reader comes back with none ($4C51). A visit from inside the menus keeps what was kept.
  visit(key) { this.visiting = key; }
  startVisit(here) {
    const [name, label] = this.title.visit[this.visiting];
    this.visiting = undefined;
    if (!this.visited) {
      this.visited = { name: this.name, pc: here, stack: this.stack, problem: this.problem, waitingOn: this.waitingOn, asked: this.asked, askMode: this.askMode, regs: [this.a, this.x, this.y, this.n, this.z, this.c, this.v] };
      // $4C5D: the screen kept, cleared, and the graphics shown
      this.title.raster?.keepScreen();
      this.inside++; this.emit({ step: 'keep-screen' }); this.inside--;
      this.routines.show(this, [], null);
    }
    this.stack = [{ visit: true }]; this.problem = null; this.waitingOn = null; this.asked = null;
    this.a = 2; this.c = 0;
    this.enter(name, label);
  }
  endVisit() {
    const v = this.visited;
    this.visited = null;
    // $4CFB: the screen put back, and the graphics shown
    this.title.raster?.putScreen();
    this.inside++; this.emit({ step: 'put-screen' }); this.inside--;
    this.routines.show(this, [], null);
    this.enter(v.name);
    Object.assign(this, { pc: v.pc, stack: v.stack, problem: v.problem, waitingOn: v.waitingOn, asked: v.asked, askMode: v.askMode });
    [this.a, this.x, this.y, this.n, this.z, this.c, this.v] = v.regs;
  }
  label(l) { const i = this.program.labels[l]; if (i === undefined) throw new Error(this.name + ': no label ' + l); return i; }

  // reading and writing an operand
  place(o) {
    if (o.through !== undefined) return ((this.mem[o.through] | this.mem[o.through + 1] << 8) + this.y) & 0xffff;
    if (o.pair !== undefined) { const z = (o.pair + this.x) & 0xff; return this.mem[z] | this.mem[(z + 1) & 0xff] << 8; }
    if (o.via !== undefined) return ((this.mem[o.via] | this.mem[o.via + 1] << 8) + (o.index ? this[o.index] : 0)) & 0xffff;
    return (o.at + (o.index ? this[o.index] : 0)) & 0xffff;
  }
  // The I/O page, $C000 to $C0FF, goes to the title's `io`, when it has one: the keyboard and the
  // soft switches that pick what the screen shows. A read of the keyboard with no key sets
  // `polled`, and the run stops there for a key, as the original's loop waits on it.
  // (the title's I/O page, `ioAt`: the Apple's $C000 to $C0FF unless the title says otherwise, as
  // the Commodore 64's $D000 to $DFFF)
  read(at) { return this.io && this.ioAt(at) ? this.io(at) & 0xff : this.mem[at]; }
  write(at, v) { if (this.io && this.ioAt(at)) this.io(at, v & 0xff); else this.mem[at] = v; }
  ioAt(at) { return (at & 0xff00) === 0xc000; }
  get(o) {
    if (o.number !== undefined) return o.number & 0xff;
    if (o.reg === 'carry') return this.c;
    if (o.reg) return this[o.reg];
    return this.read(this.place(o));
  }
  // a read for a load, a compare or the like: through an index, a cycle more when the index
  // carries into the next page, as the 6502 takes it
  load(o) {
    if (this.timed && (o.index && !o.zp || o.through !== undefined)) {
      const base = o.through !== undefined ? this.mem[o.through] | this.mem[o.through + 1] << 8 : o.via !== undefined ? this.mem[o.via] | this.mem[o.via + 1] << 8 : o.at;
      if ((base & 0xff) + this[o.index ?? 'y'] > 0xff) this.cycles++;
    }
    return this.get(o);
  }
  // an indexed address, for compiled code: the same cycle more
  ix(base, i) { if (this.timed && (base & 0xff) + i > 0xff) this.cycles++; return (base + i) & 0xffff; }
  set(o, v) {
    v &= 0xff;
    if (o.reg) { this[o.reg] = v; return; }
    this.write(this.place(o), v);
  }
  flags(v) { this.n = v >> 7 & 1; this.z = v === 0 ? 1 : 0; return v; }
  compare(r, v) { const d = (r - v) & 0x1ff; this.c = r >= v ? 1 : 0; this.flags(d & 0xff); }

  // The statements' work, the same for a script run line by line (exec) and one compiled to
  // JavaScript (compile.js).
  // The cycles of the lines from step i to step j of a script, the instructions' as the original
  // has them in memory at the lines' addresses, a branch taken one more (Engine.branch, and the
  // compiled branches): kept with step i, the first time, and counted toward the run's delay.
  time(s, i, j) {
    if (!this.timed) return;
    let c = s[i].cycles;
    if (c === undefined) { c = 0; for (let k = i; k <= j; k++) c += this.cost(s, k); s[i].cycles = c; }
    this.cycles += c; this.delay += c / CYCLES_PER_MS;
  }
  // A line's cycles: its instruction's, a compare and its branch both (if a != 13 goto L), and
  // those the lifter left out just before it, from where the line before ended (past the data
  // after its call, as the title reads it, `inline`): a register's load it took into the step's
  // inputs (hposn 34 57 0 was LDA, LDX, LDY and the JSR), a NOP
  cost(s, k) {
    const step = s[k], m = this.mem;
    if (step.at === null) return 0;
    let c = CYCLES[m[step.at]] + (COMPARED(step) ? 2 : 0);
    // the line before falls through to it, unless the line is where a jump comes in (its label at
    // its own address) or the line before goes elsewhere
    const prev = !step.entered && !['return', 'goto'].includes(s[k - 1]?.words[0]) ? s[k - 1] : null;
    if (step.start !== undefined || prev && prev.at !== null) {
      // from its label, where a jump comes in, or where the line before ended
      const from = step.start ?? prev.at + size(m[prev.at]) + (COMPARED(prev) ? 2 : 0) + (this.routines.inline?.(this, prev) ?? 0);
      if (from < step.at && step.at - from <= 9) {
        let more = 0, a = from;
        for (; a < step.at && LEFT_OUT.has(m[a]); a += size(m[a])) more += CYCLES[m[a]];
        if (a === step.at) c += more;   // only these, or the bytes between are no code (a variable)
      }
    }
    return c;
  }
  // ADC: the sum with the carry into A, and the flags; in decimal mode (SED, as Zoopak's clocks
  // count) by the 6502's own rules, as @moonbase-machines/mos6502/cpu.js
  add(m) {
    if (this.d) {
      let lo = (this.a & 15) + (m & 15) + this.c, hi = (this.a >> 4) + (m >> 4);
      if (lo > 9) { lo -= 10; hi++; }
      this.z = ((this.a + m + this.c) & 0xff) === 0 ? 1 : 0;
      this.n = hi & 8 ? 1 : 0; this.v = (~(this.a ^ m) & (this.a ^ (hi << 4)) & 0x80) ? 1 : 0;
      if (hi > 9) { hi -= 10; this.c = 1; } else this.c = 0;
      this.a = ((hi << 4) | lo) & 0xff; return;
    }
    const a = this.a, sum = a + m + this.c;
    this.v = (~(a ^ m) & (a ^ sum) & 0x80) ? 1 : 0; this.c = sum > 0xff ? 1 : 0; this.a = this.flags(sum & 0xff);
  }
  // SBC: in binary ADC with the operand turned over; in decimal mode by the 6502's rules
  sub(m) {
    if (!this.d) return this.add(m ^ 0xff);
    let lo = (this.a & 15) - (m & 15) - (1 - this.c), hi = (this.a >> 4) - (m >> 4);
    if (lo < 0) { lo += 10; hi--; }
    const r = this.a - m - (1 - this.c); this.z = (r & 0xff) === 0 ? 1 : 0; this.n = r & 0x80 ? 1 : 0;
    this.v = ((this.a ^ m) & (this.a ^ r) & 0x80) ? 1 : 0; this.c = r >= 0 ? 1 : 0;
    if (hi < 0) hi += 10;
    this.a = ((hi << 4) | lo) & 0xff;
  }
  // ASL, LSR, ROL and ROR: the value shifted, the bit out into the carry
  shift(v, left, through) {
    const r = left ? (v << 1 | (through ? this.c : 0)) & 0xff : v >> 1 | (through && this.c ? 0x80 : 0);
    this.c = left ? v >> 7 : v & 1; return this.flags(r);
  }
  // BIT: N and V from the value, Z from it ANDed with A
  test(v) { this.n = v >> 7 & 1; this.v = v >> 6 & 1; this.z = (v & this.a) === 0 ? 1 : 0; }
  // goto a label of this script's; one that a file read since has put another script's code
  // over is that script's (the title's `elsewhere`)
  jump(l, step) {
    if (this.routines.elsewhere?.(this, l)) return this.routines['goto-engine'](this, ['$' + l.slice(1)], step);
    this.pc = this.label(l);
  }
  // goto ($8371): through the address kept at $8371 and $8372, as JMP ($8371), into this script
  // or the title's code elsewhere
  jumpThrough(t, step) {
    const l = label16(this.mem[t] | this.mem[t + 1] << 8);
    if (this.program.labels[l] === undefined && this.routines['goto-engine']) return this.routines['goto-engine'](this, ['$' + l.slice(1)], step);
    this.pc = this.label(l);
  }
  // goto [$8180 y]: through a table of addresses, the one at the index
  jumpTable(t, i) { this.pc = this.label(label16(this.mem[t + i] | this.mem[t + i + 1] << 8)); }
  call(l, step) {
    if (this.routines.elsewhere?.(this, l)) return this.routines['call-engine'](this, ['$' + l.slice(1)], step);
    this.stack.push({ name: this.name, pc: this.pc, ret: returnOf(step) }); this.pc = this.label(l);
  }
  // call ($0D19): through the address the code keeps there, into this script or another's
  callThrough(t, step) {
    const l = label16(this.mem[t] | this.mem[t + 1] << 8);
    if (this.program.labels[l] === undefined && this.routines['call-engine']) return this.routines['call-engine'](this, ['$' + l.slice(1)], step);
    this.stack.push({ name: this.name, pc: this.pc, ret: returnOf(step) }); this.pc = this.label(l);
  }
  ret(step) {
    const f = this.stack.pop();
    if (!f) throw new Error('return with nothing called');
    if (f.visit) { this.endVisit(); return; }
    const p = this.pulled;
    // two bytes pushed, an address less one, high byte first: RTS goes there, the 6502's
    // jump through a table (PHA PHA RTS, as LIB4's menu goes to its choice)
    if (f.a !== undefined && this.stack.at(-1)?.a !== undefined) {
      const hi = this.stack.pop().a, to = ((hi << 8 | f.a) + 1) & 0xffff, l = label16(to);
      // or back past the data after a call whose frame was pulled to read it (fill's, print's):
      // to the step after the call, the next in its script (which may start a little further on,
      // where the lifter took a register's load into the step that uses it)
      if (p?.ret !== undefined && to > p.ret && to - p.ret <= 0x100) {
        this.pulled = null;
        if (p.name !== this.name) this.enter(p.name);
        this.pc = p.pc;
        if (p.inside) { this.inside--; p.done?.(this); }
        return;
      }
      // or back before the call, in the script that made it, to make a call again: Detect-A-Pet's
      // disk error screens, which once the disk is back go back to the ProDOS call that failed
      // (still inside the routine, as the original's count of calls is, until the call made
      // again comes back to where the first would have: `again`)
      if (p?.ret !== undefined && to <= p.ret && p.ret - to <= 0x20 && this.script(p.name).labels[l] !== undefined) {
        this.pulled = null;
        if (p.name !== this.name) this.enter(p.name);
        this.pc = this.label(l);
        if (p.inside) this.again = this.again?.ret === p.ret ? { ...this.again, n: this.again.n + 1 } : { ret: p.ret, done: p.done, n: 1 };
        return;
      }
      if (this.program.labels[l] === undefined && this.routines['goto-engine']) return this.routines['goto-engine'](this, ['$' + l.slice(1)], step);
      this.pc = this.label(l); return;
    }
    // a routine's frame pulled and dropped, and a return from below where it was: what it was
    // inside is left now (the routine's own calls return above it)
    if (p && this.stack.length < p.depth) { this.pulled = null; if (p.inside && p.ret !== undefined) this.inside--; }
    if (f.name !== this.name) this.enter(f.name);
    this.pc = f.pc;
    // the end of a routine run inside a step (Engine.inside): what it gives, as its result; and
    // what a frame does as it is returned to (`after`: BASIC's SYS keeps the registers)
    if (f.inside) { this.inside--; f.done?.(this); }
    if (this.again && f.ret === this.again.ret) { const a = this.again; this.again = null; this.inside -= a.n; a.done?.(this); }
    f.after?.(this);
  }
  push(a) { this.stack.push(a ? { a: this.a } : { flags: [this.n, this.z, this.c, this.v] }); }
  pull(a) {
    // a call's frame is the two bytes of its return address on the original's stack, the last
    // byte of its JSR: PLA gives the low byte, then the high, and two pulls drop it, as PLA PLA
    // drops a return to go back two calls at once ($0D26), or as fill takes its data from after
    // the call; the frame is kept (`pulled`) for the return that goes back past the data
    const top = this.stack.at(-1);
    if (top && top.name !== undefined) {
      const v = top.ret === undefined ? 0 : top.half ? top.ret >> 8 : top.ret & 0xff;
      if (top.half) { this.stack.pop(); top.depth = this.stack.length; this.pulled = top; if (top.inside && top.ret === undefined) this.inside--; } else top.half = true;
      if (a) this.a = this.flags(v);
      return;
    }
    const f = this.stack.pop(); if (a) this.a = this.flags(f.a); else [this.n, this.z, this.c, this.v] = f.flags;
  }
  // the stack's place, as the original's stack pointer would be with these frames on it: each
  // frame its bytes, a call's two (its return address) and a push's one
  sp() { return 0xff - this.stack.reduce((n, f) => n + (f.name === undefined ? 1 : f.half ? 1 : 2), 0) & 0xff; }
  // the frames kept at their place, for a TXS to go back to, and their bytes in the stack page as
  // the original's are there: a call's return address, high byte first from the bottom, as JSR
  // pushes it (half of one pulled, its high byte), and a push's byte, PHP's as the 6502's (Pieces of Eight's DOS error
  // handler, $93F0, reads the return address under its own to see who called)
  stackPage() {
    const sp = this.sp();
    (this.stacks ??= new Map()).set(sp, this.stack.map(f => ({ ...f })));
    let at = 0xff;
    for (const f of this.stack) {
      const r = f.ret ?? 0;
      if (f.name === undefined) this.mem[0x100 + at--] = f.a ?? (f.flags ? f.flags[0] << 7 | f.flags[3] << 6 | 0x30 | f.flags[1] << 1 | f.flags[2] : 0);
      else { this.mem[0x100 + at--] = r >> 8; if (!f.half) this.mem[0x100 + at--] = r & 0xff; }
    }
    return sp;
  }
  // the machine's own instructions a scene keeps. TSX gives the stack's place (`stackPage`); TXS
  // goes back to the frames kept at the place it is given (Detect-A-Pet's save and
  // load keep the stack page and its pointer), and to none at any other, as the town's
  // resets the stack and drops every script called. SED and CLD set decimal mode, and SEI and
  // CLI the mask a Commodore 64's interrupt waits on (card.js). The rest (a byte that
  // is no instruction) change nothing the remake holds.
  asm(op) {
    if (op === 'TSX') this.x = this.flags(this.stackPage());
    if (op === 'TXS') {
      const kept = this.stacks?.get(this.x);
      this.stack = kept ? kept.map(f => ({ ...f })) : []; this.visited = null; this.inside = this.stack.filter(f => f.inside).length;
    }
    if (op === 'CLV') this.v = 0;   // as LIB4 does before a branch that always goes
    if (op === 'SED') this.d = 1; if (op === 'CLD') this.d = 0;   // decimal mode, for ADC and SBC
    if (op === 'SEI') this.i = 1; if (op === 'CLI') this.i = 0;   // interrupts masked, and not
  }

  // run until the title waits for a key, or `limit` steps: ten million, as Detect-A-Pet's toy
  // shop turns a screen over seven times, a byte at a time, in its own lifted code
  run(limit = 1e7) {
    // the keyboard read with no key, in this run (`io`): a run that goes on after the time the
    // original took ('pace') goes on counting, as the machine's one run would
    if (!this.pacing) this.idle = 0;
    this.pacing = false;
    this.delay ??= 0;
    for (let i = 0; i < limit; i++) {
      if (this.ended) return 'end';
      const step = this.program.steps[this.pc];
      if (!step) throw new Error(this.name + ': ran off the end');
      // the title's own word before a statement runs: a card title's tick stops there
      if (this.routines.before?.(this, step) === 'wait') return 'idle';
      const r = this.exec(step);
      if (r === 'wait') return 'idle';
      if (this.polled) { this.polled = false; return 'idle'; }
      // the time the original took, a disk's read or a wait it counted out, in milliseconds: a
      // frame's worth or more stops the run, for the page to show the screen and take the time
      if (this.delay >= 16) { this.pacing = true; return 'pace'; }
    }
    return 'steps';
  }

  // A step: a compiled script's own function (`run`, for a run of statements together, or a
  // routine's step), or the step's words, line by line. Only a routine's step that waits runs
  // again when the key comes.
  exec(step) {
    const here = this.pc;
    this.pc++;
    try {
      this.called = false;
      if (!step.run && STATEMENT(step)) this.time(this.program.steps, here, here);
      const r = step.run ? step.run(this, this.program.steps) : this.interpret(step);
      if (r === 'wait' && (step.run ? this.called : !STATEMENT(step))) {
        this.pc = here;
        if (this.visiting !== undefined) { this.startVisit(here); return; }
      }
      return r;
    } catch (e) {
      if (e === LEFT) { this.inside = 0; return; }   // counted down as it left what it was inside
      // an error the title answers as its machine did (a BASIC program's, BASIC's message and the
      // end of the program: card.js `error`)
      if (this.routines.error?.(this, e)) { this.ended = true; return; }
      e.message = step.where + ' (' + step.text + '): ' + e.message;
      throw e;
    }
  }

  interpret(step) {
    const w = step.words, [first, second] = w;
    // a = $8235, $866A = a, x += 1, a &= 127, $8235 <<= 1
    if (second === '=' && w.length === 3) {
      const o = operand(first), v = this.load(operand(w[2]));
      if (o.reg === 'carry') { this.c = v & 1; return; }
      this.set(o, v); if (o.reg) this.flags(v);   // a load sets the flags, a store does not
      return;
    }
    if (second === '+=' || second === '-=') {
      const o = operand(first), v = w.length === 3 ? this.get(operand(w[2])) : this.load(operand(w[2]));
      if (w.length === 3) { const r = (this.get(o) + (second === '+=' ? v : -v)) & 0xff; this.set(o, r); this.flags(r); return; }   // increment or decrement
      if (second === '+=') this.add(v); else this.sub(v); return;   // with the carry, as ADC and SBC
    }
    if (second === '&=' || second === '|=' || second === '^=') { const v = this.load(operand(w[2])); this.a = this.flags(second === '&=' ? this.a & v : second === '|=' ? this.a | v : this.a ^ v); return; }
    if (second === '<<=' || second === '>>=' || second === 'rotate') {
      const o = operand(first);
      this.set(o, this.shift(this.get(o), second === '<<=' || w[2] === 'left', second === 'rotate')); return;
    }
    switch (first) {
      case 'if': return this.branch(w, step);
      case 'goto':
        if (w[1].startsWith('(')) return this.jumpThrough(parseInt(w[1].slice(2, -1), 16), step);
        if (w[1].startsWith('[')) return this.jumpTable(parseInt(w[1].slice(2), 16), this[w[2][0]]);
        return this.jump(w[1], step);
      case 'call':
        if (w[1].startsWith('(')) return this.callThrough(parseInt(w[1].slice(2, -1), 16), step);
        return this.call(w[1], step);
      case 'return': return this.ret(step);
      case 'compare': this.compare(this[w[1]], this.load(operand(w[2]))); return;
      case 'test': this.test(this.get(operand(w[1]))); return;
      case 'asm': if (w[1] === 'RTI') return this.ret(step); this.asm(w[1]); return;   // (RTI: the end of an interrupt's routine, card.js)
      case 'push': this.push(w[1] === 'a'); return;
      case 'pull': this.pull(w[1] === 'a'); return;
    }
    return this.routine(first, w.slice(1), step);   // a quoted word comes as { string }
  }
  // a step: the title's routines do the engine's work
  routine(name, args, step) {
    const routine = this.routines[name];
    if (!routine) throw new Error('no routine ' + name);
    this.called = true;
    // the call into the toolkit, its JSR's cycles; the routine's own lines count as they run
    // and the loads the lifter took into the step (Engine.cost)
    if (step && this.timed && step.at !== null) { const c = this.cost(this.program.steps, step.index); this.cycles += c; this.delay += c / CYCLES_PER_MS; }
    return routine(this, args, step);
  }

  // if <flag> goto L, if not <flag> goto L, if <reg> <op> <operand> goto L
  branch(w, step) {
    const to = w.at(-1), cond = w.slice(1, -2);
    let yes;
    if (cond.length === 3 && /^[axy]$/.test(cond[0])) {
      this.compare(this[cond[0]], this.load(operand(cond[2])));
      yes = { '==': this.z, '!=': !this.z, '>=': this.c, '<': !this.c }[cond[1]];
    } else {
      const not = cond[0] === 'not', flag = not ? cond[1] : cond[0];
      const v = { zero: this.z, carry: this.c, negative: this.n, overflow: this.v }[flag];
      if (v === undefined) throw new Error('no flag ' + flag);
      yes = not ? !v : !!v;
    }
    if (yes) { this.cycles += branchTaken(step); this.pc = this.label(to); }
  }
}

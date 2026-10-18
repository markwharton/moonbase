// The ROM routines in JavaScript (rom.js) held to what Applesoft's and the Monitor's own routines
// are documented to do. A mistake in them is the same on every machine that runs them, so these
// tests check what each routine leaves in memory and the registers, as the ROM leaves them.
//
//   node --test test/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { install } from '@moonbase-machines/apple2e/rom.js';

// a machine of nothing but memory and a processor's registers, with the routines on its hooks
function machine() {
  const mem = new Uint8Array(0x10000);
  const cpu = { hooks: new Map(), cycles: 0, a: 0, x: 0, y: 0, z: 0, c: 0, n: 0, v: 0, read: a => mem[a], write: (a, v) => { mem[a] = v & 0xff; }, nz(v) { this.n = v >> 7 & 1; this.z = v ? 0 : 1; } };
  install({ cpu, game: { kind: 'prodos' }, sw: { lcRead: 0 }, io: () => 0, file: () => null, files: new Map(), log() {}, halted: false });
  const call = (at, regs = {}) => { Object.assign(cpu, regs); return cpu.hooks.get(at)(cpu); };
  mem[0xe6] = 0x20;   // HPAG: hi-res page 1
  return { mem, cpu, call };
}
const HCOLOR = 0xf6f0, HPOSN = 0xf411, HPLOT = 0xf457, HLIN = 0xf53a, DRAW = 0xf601, XDRAW = 0xf65d, BKGND = 0xf3f4, WAIT = 0xfca8, HOME = 0xfc58, COUT = 0xfded;
const at = (x, y) => ({ x: x & 0xff, y: x >> 8, a: y });   // HPOSN's x in Y,X and y in A

test('HCOLOR= gives HCOLOR1 the color\'s byte, 0 to 7', () => {
  const { mem, call } = machine();
  [0x00, 0x2a, 0x55, 0x7f, 0x80, 0xaa, 0xd5, 0xff].forEach((byte, x) => { call(HCOLOR, { x }); assert.equal(mem[0xe4], byte); });
});

test('HPOSN keeps the position in HNDX and HNDY, and the row\'s base, column and dot\'s mask', () => {
  const { mem, call } = machine();
  // the rows' bases on page 1, the screen's interleave: 0, 1, 8 and 64 rows down, and the last
  for (const [y, base] of [[0, 0x2000], [1, 0x2400], [8, 0x2080], [64, 0x2028], [191, 0x3fd0]]) {
    call(HPOSN, at(0, y));
    assert.equal(mem[0x26] | mem[0x27] << 8, base, 'row ' + y);
  }
  // a column is seven dots, and HMASK the dot's bit with the high bit, from MSKTBL
  [0x81, 0x82, 0x84, 0x88, 0x90, 0xa0, 0xc0].forEach((mask, dot) => {
    call(HPOSN, at(7 * 3 + dot, 10));
    assert.equal(mem[0xe5], 3); assert.equal(mem[0x30], mask, 'dot ' + dot);
  });
  call(HPOSN, at(279, 191));
  assert.deepEqual([mem[0xe0] | mem[0xe1] << 8, mem[0xe2]], [279, 191]);
});

test('HPLOT gives the dot\'s byte the color\'s bit there, and the color\'s high bit', () => {
  const { mem, call } = machine();
  call(HCOLOR, { x: 3 }); call(HPLOT, at(0, 0));   // white, $7F, its high bit clear
  assert.equal(mem[0x2000], 0x01);
  call(HCOLOR, { x: 7 }); call(HPLOT, at(1, 0));   // white, $FF, its high bit set
  assert.equal(mem[0x2000], 0x83);
  call(HCOLOR, { x: 0 }); call(HPLOT, at(0, 0));   // black, $00: the dot off, the high bit off
  assert.equal(mem[0x2000], 0x02);
});

test('HPLOT TO draws from the position to the point, and the point is the position after', () => {
  const { mem, call } = machine();
  call(HCOLOR, { x: 3 }); call(HPOSN, at(0, 0));
  call(HLIN, { a: 6, x: 0, y: 0 });   // HLIN: to X,A across and Y down
  assert.equal(mem[0x2000], 0x7f);    // seven dots, the whole byte
  assert.deepEqual([mem[0xe0] | mem[0xe1] << 8, mem[0xe2]], [6, 0]);
});

// a shape of two vectors in a byte, each a dot plotted and a move to the right, and the end
const SHAPE = 0x6000;
function shape(mem) { mem[SHAPE] = 0b00_101_101; mem[SHAPE + 1] = 0; mem[0xe7] = 1; }   // SCALE 1

test('DRAW plots each vector\'s dot before its move, and leaves HNDX and HNDY where it began', () => {
  const { mem, call } = machine();
  shape(mem);
  call(HCOLOR, { x: 3 }); call(HPOSN, at(10, 20));
  call(DRAW, { a: 0, x: SHAPE & 0xff, y: SHAPE >> 8 });
  call(HPOSN, at(10, 20)); const byte = (mem[0x26] | mem[0x27] << 8) + mem[0xe5];
  assert.equal(mem[byte], (1 << 3) | (1 << 4));   // dots 10 and 11: the column of 7 to 13, its bits 3 and 4
  // Applesoft's DRAW moves HBASL, HORIZ and HMASK as it plots, not HNDX and HNDY: HPLOT TO goes
  // on from where the shape began (Detect-A-Pet's name cursor reads them after its letters)
  call(HPOSN, at(10, 20)); call(DRAW, { a: 0, x: SHAPE & 0xff, y: SHAPE >> 8 });
  assert.deepEqual([mem[0xe0] | mem[0xe1] << 8, mem[0xe2]], [10, 20]);
});

test('XDRAW turns the shape\'s dots over, so a second XDRAW puts the screen back', () => {
  const { mem, call } = machine();
  shape(mem);
  for (let i = 0x2000; i < 0x4000; i++) mem[i] = (i * 7) & 0xff;
  const before = mem.slice(0x2000, 0x4000);
  for (let k = 0; k < 2; k++) { call(HPOSN, at(100, 50)); call(XDRAW, { a: 0, x: SHAPE & 0xff, y: SHAPE >> 8 }); }
  assert.deepEqual(mem.slice(0x2000, 0x4000), before);
});

test('XDRAW counts in HCOUNT the dots it turns on, which were off: on black, all of them', () => {
  const { mem, call } = machine();
  shape(mem);
  call(HPOSN, at(100, 50)); call(XDRAW, { a: 0, x: SHAPE & 0xff, y: SHAPE >> 8 });
  assert.equal(mem[0xea], 2);   // two dots, both off
  call(HPOSN, at(100, 50)); call(XDRAW, { a: 0, x: SHAPE & 0xff, y: SHAPE >> 8 });
  assert.equal(mem[0xea], 0);   // the same two, now on: none counted, and the count started again
});

test('DRAW counts in HCOUNT the dots already in its color', () => {
  const { mem, call } = machine();
  shape(mem);
  call(HCOLOR, { x: 3 }); call(HPOSN, at(100, 50)); call(DRAW, { a: 0, x: SHAPE & 0xff, y: SHAPE >> 8 });
  assert.equal(mem[0xea], 0);   // on black, white dots: none already white
  call(HPOSN, at(100, 50)); call(DRAW, { a: 0, x: SHAPE & 0xff, y: SHAPE >> 8 });
  assert.equal(mem[0xea], 2);   // again: both already white
});

test('BKGND fills the page with the color, turned a byte at a time as Applesoft\'s COLORSHIFT does', () => {
  const { mem, call } = machine();
  call(BKGND, { a: 0x55 });
  assert.ok(mem.slice(0x2000, 0x4000).every((v, i) => v === (i & 1 ? 0x2a : 0x55)));
  assert.equal(mem[0x1fff], 0); assert.equal(mem[0x4000], 0);
});

test('WAIT takes (26 + 27A + 5A²) / 2 cycles, its JSR and RTS the processor\'s, and leaves A 0', () => {
  const { cpu, call } = machine();
  call(WAIT, { a: 10 });
  assert.equal(cpu.cycles, ((26 + 27 * 10 + 5 * 100) >> 1) - 12);
  assert.equal(cpu.a, 0); assert.equal(cpu.z, 1);
});

test('HOME clears the text window to spaces and puts the cursor at its top left', () => {
  const { mem, call } = machine();
  mem.fill(0xc1, 0x400, 0x800);
  Object.assign(mem, { 0x20: 0, 0x21: 40, 0x22: 0, 0x23: 24, 0x24: 9, 0x25: 9 });
  call(HOME);
  assert.equal(mem[0x400], 0xa0); assert.equal(mem[0x7d0 + 39], 0xa0);   // the first row's first and the last row's last
  assert.deepEqual([mem[0x24], mem[0x25], mem[0x28] | mem[0x29] << 8], [0, 0, 0x400]);
});

test('COUT puts the character at the cursor and moves the cursor on', () => {
  const { mem, call } = machine();
  Object.assign(mem, { 0x20: 0, 0x21: 40, 0x22: 0, 0x23: 24, 0x32: 0xff });
  call(HOME);
  call(COUT, { a: 0xc1 });   // A
  assert.equal(mem[0x400], 0xc1); assert.equal(mem[0x24], 1);
});

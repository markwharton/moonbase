// cpu.js against the 6502 itself: what perfect6502, the chip simulated transistor by transistor
// from Visual6502's netlist, gives for decimal mode on the NMOS chip, digits over 9 among them,
// where the textbook's way and the chip's part.
//
//   node --test test/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CPU } from '@moonbase-machines/6502/cpu.js';

// [opcode, A, operand, P before, A after, P after (NV-DIZC: bits 4 and 5 are not a register)]
const CHIP = [
  [0x69, 0xdc, 0x27, 0x08, 0x69, 0x09], [0x69, 0x0f, 0x0f, 0x09, 0x15, 0x08], [0x69, 0xaf, 0xdf, 0x08, 0xe4, 0x89], [0x69, 0x99, 0x01, 0x09, 0x01, 0x89],
  [0xe9, 0xf3, 0xcf, 0x08, 0x2d, 0x09], [0xe9, 0x0a, 0x0b, 0x09, 0x99, 0x88], [0xe9, 0x00, 0x01, 0x08, 0x98, 0x88], [0xe9, 0x50, 0x0f, 0x09, 0x4b, 0x09],
];

test('ADC and SBC in decimal mode, as the NMOS chip does them', () => {
  for (const [op, a, b, p, wantA, wantP] of CHIP) {
    const mem = new Uint8Array(0x10000); mem.set([op, b], 0x800);
    const cpu = new CPU({ read: k => mem[k], write: (k, v) => { mem[k] = v; } }, { nmos: true });
    Object.assign(cpu, { a, pc: 0x800 }); cpu.p = p; cpu.step();
    assert.deepEqual([cpu.a, cpu.p & 0xcf], [wantA, wantP], `$${op.toString(16)} with A $${a.toString(16)}, $${b.toString(16)}, P $${p.toString(16)}`);
  }
});

// The undocumented instructions perfect6502 cannot settle: what NMOS chips give, from the operand
// ANDed into A
test('ANC, ALR, ARR, SBX, LXA, LAS as the chips give them', () => {
  const run = (bytes, regs) => {
    const mem = new Uint8Array(0x10000); mem.set(bytes, 0x800); mem[0x3010] = regs.value ?? 0; delete regs.value;
    const cpu = new CPU({ read: k => mem[k], write: (k, v) => { mem[k] = v; } }, { nmos: true });
    Object.assign(cpu, { a: 0, x: 0, y: 0, sp: 0xff, pc: 0x800 }, regs); cpu.p = regs.p ?? 0; cpu.step();
    return { a: cpu.a, x: cpu.x, sp: cpu.sp, p: cpu.p & 0xcf };
  };
  assert.deepEqual(run([0x0b, 0x8f], { a: 0xf0 }), { a: 0x80, x: 0, sp: 0xff, p: 0x81 }, 'ANC: N into C');
  assert.deepEqual(run([0x4b, 0x0f], { a: 0xff }), { a: 0x07, x: 0, sp: 0xff, p: 0x01 }, 'ALR');
  assert.deepEqual(run([0x6b, 0xff], { a: 0xc0, p: 0x01 }), { a: 0xe0, x: 0, sp: 0xff, p: 0x81 }, 'ARR: C from bit 6, V from 6 and 5');
  assert.deepEqual(run([0xcb, 0x02], { a: 0x0f, x: 0xfc }), { a: 0x0f, x: 0x0a, sp: 0xff, p: 0x01 }, 'SBX: (A AND X) - operand');
  assert.deepEqual(run([0xab, 0x0f], { a: 0x11 }).x, (0x11 | 0xee) & 0x0f, 'LXA');
  assert.deepEqual(run([0xbb, 0x10, 0x30], { sp: 0x3c, value: 0xf5, y: 0 }), { a: 0x34, x: 0x34, sp: 0x34, p: 0x00 }, 'LAS');
});

// A read-modify-write writes twice on the NMOS chip, the value read and then the new one, which on
// the C64 is how DEC $D019 acknowledges the VIC-II's interrupt; only where the machine asks
// (writeBack), so that the Apple's soft switches are touched once.
test('read-modify-writes write the value back first, with writeBack', () => {
  for (const [writeBack, want] of [[true, [[0xd019, 0xf1], [0xd019, 0xf0]]], [false, [[0xd019, 0xf0]]]]) {
    const mem = new Uint8Array(0x10000), writes = [];
    mem.set([0xce, 0x19, 0xd0], 0x800); mem[0xd019] = 0xf1;   // DEC $D019
    const cpu = new CPU({ read: k => mem[k], write: (k, v) => { writes.push([k, v]); mem[k] = v; } }, { nmos: true, writeBack });
    cpu.pc = 0x800; cpu.step();
    assert.deepEqual(writes, want, `writeBack ${writeBack}`);
  }
});

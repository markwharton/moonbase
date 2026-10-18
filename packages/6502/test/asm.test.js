// Moonbase's 6502 assembler (asm.js): every documented instruction in every mode assembled and
// read back by the disassembler (disasm.js) the same; labels before and after, local labels,
// zero page chosen where the operand is known, a branch too far refused, the directives and the
// expressions.
//
//   node --test test/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble, AsmError } from '@moonbase-machines/6502/asm.js';
import { OPS, disassemble, operand } from '@moonbase-machines/6502/disasm.js';

test('every instruction, in every mode, reads back the same', () => {
  let source = '*= $1000\n';
  const want = [];
  OPS.forEach((o, i) => {
    if (o.name === '???') return;
    const op = o.mode === 'rel' ? '*' : o.mode === 'acc' ? 'A' : operand(o.mode, [i, 0x12, 0x34], 0x1000);
    source += `  ${o.name} ${op}\n`; want.push([o.name, op]);
  });
  const { bytes } = assemble(source);
  const lines = disassemble(bytes, 0x1000).trim().split('\n');
  assert.equal(lines.length, want.length);
  lines.forEach((line, k) => {
    const [name, op] = want[k];
    assert.equal(line.slice(17), `${name} ${op === '*' ? '$' + line.slice(0, 4) : op}`.trim(), line);
  });
  assert.equal(want.length, 151);
});

test('labels, local labels, constants, zero page and the directives', () => {
  const { prg, symbols } = assemble(`
zp = $fb
        *= $0801
        .word end, 10          ; a BASIC line
        .byte $9e
        .text "2061"
        .byte 0
end:    .word 0
start:  lda #<message
        ldx #>message
.loop:  dex
        bne .loop
        sta zp
        sta later
        jmp start
message:
        .screen "AZ@"
        .text 'a', "b;c"
        .fill 2, $ea
        .mixed "Az@"
later = $02
`);
  assert.deepEqual([...prg], [0x01, 0x08, 0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31, 0x00, 0x00, 0x00,
    0xa9, 0x1c, 0xa2, 0x08, 0xca, 0xd0, 0xfd, 0x85, 0xfb, 0x8d, 0x02, 0x00, 0x4c, 0x0d, 0x08,
    0x01, 0x1a, 0x00, 0x41, 0x42, 0x3b, 0x43, 0xea, 0xea, 0x41, 0x1a, 0x00]);
  assert.equal(symbols.get('start.loop'), 0x0811);
  assert.equal(symbols.get('message'), 0x081c);
});

test('expressions as C has them, the low and high bytes, and here', () => {
  const { bytes } = assemble('*= $c000\n .byte 1+2*3, (1+2)*3, $10|%11, 7&~2, >$1234, <$1234, 1<<4, 100/7, 100%7, -1\n .word *, *+2');
  assert.deepEqual([...bytes], [7, 9, 0x13, 5, 0x12, 0x34, 16, 14, 2, 0xff, 0x0a, 0xc0, 0x0e, 0xc0]);
});

test('a branch too far, a name not defined, and a name defined twice are refused, with the line', () => {
  assert.throws(() => assemble('*= $1000\n bne far\n .fill 200\nfar: rts'), /source:2: BNE far: 200 bytes away/);
  assert.throws(() => assemble('*= $1000\n jmp nowhere'), /source:2: nowhere: not defined/);
  assert.throws(() => assemble('*= $1000\na: nop\na: nop'), /a defined twice/);
  assert.throws(() => assemble('*= $1000\n lda #$100'), AsmError);
});

test('.include brings another file in, its errors named by it', () => {
  const files = { 'more.s': 'two: .byte 2\n' };
  const { bytes } = assemble('*= $2000\none: .byte 1\n .include "more.s"\n .word two', { include: n => files[n] });
  assert.deepEqual([...bytes], [1, 2, 0x01, 0x20]);
  assert.throws(() => assemble('*= $2000\n .include "bad.s"', { include: () => '\n lda (' }), /bad.s:2/);
});

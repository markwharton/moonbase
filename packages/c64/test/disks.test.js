// A 1541 disk read back as the package writes it (d64.js make and read), and a BASIC program listed as the 64
// lists it (basic-list.js), from bytes the tests build, nothing of a title's.
//
//   node --test test/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { make, read, petsciiName } from '@moonbase-machines/c64/d64.js';
import { listing } from '@moonbase-machines/c64/basic-list.js';

test('a disk made and read back: its name, a program at its address over several sectors, a sequential file', () => {
  const program = [0x01, 0x08, ...Array.from({ length: 600 }, (_, i) => i & 0xff)];
  const image = make({ name: 'ZOOPAK', id: 'ZP', files: [{ name: 'MENU', data: program, type: 'PRG' }, { name: 'NOTES', data: [0x48, 0x49], type: 'SEQ' }] });
  const disk = read(image);
  assert.equal(disk.name, 'ZOOPAK'); assert.equal(disk.id, 'ZP');
  assert.deepEqual(disk.files.map(f => [f.name, f.type]), [['MENU', 'PRG'], ['NOTES', 'SEQ']]);
  const [menu, notes] = disk.files;
  assert.equal(menu.address, 0x0801); assert.equal(menu.body.length, 600); assert.equal(menu.body[599], 599 & 0xff);
  assert.deepEqual([...menu.raw.subarray(0, 2)], [0x01, 0x08]);
  assert.deepEqual([...notes.body], [0x48, 0x49]);
  assert.throws(() => read(new Uint8Array(1000)), /174,848 bytes/);
});

test('a name as the 1541 keeps it: shifted letters as capitals, the padding gone', () => {
  assert.equal(petsciiName([0xc8, 0x49, 0xa0, 0xa0]), 'HI');
});

test('a BASIC program listed as LIST prints it, in either character set', () => {
  // 10 PRINT"{CLR}HELLO" / 20 GOTO 10, at $0801
  const lines = [[10, [0x99, 0x22, 0x93, 0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x22]], [20, [0x89, 0x20, 0x31, 0x30]]];
  const bytes = [];
  for (const [n, body] of lines) { const next = 0x801 + bytes.length + 4 + body.length + 1; bytes.push(next & 0xff, next >> 8, n & 0xff, n >> 8, ...body, 0); }
  bytes.push(0, 0);
  assert.equal(listing(Uint8Array.from(bytes)), '10 PRINT"{CLR}HELLO"\n20 GOTO 10\n');
  assert.equal(listing(Uint8Array.from(bytes), { lower: true }), '10 print"{CLR}hello"\n20 goto 10\n');
});

test('what the VIC-II shows as a picture: multicolour and hi-res text, a hi-res bitmap, a sprite', async () => {
  const { rows, chip } = await import('@moonbase-machines/c64/picture.js');
  const { PALETTE } = await import('@moonbase-machines/c64/vic.js');
  const colours = row => row.map(c => PALETTE.findIndex(p => p.join() === c.join()));
  // text: characters at $3000, the screen at $0400 ($D018 $1C); cell 0 multicolour (colour 8 + 5), its top row the
  // pairs 00 01 10 11; cell 1 hi-res in white, its top row one dot at the left
  let mem = new Uint8Array(0x10000);
  mem[0x400] = 0; mem[0x401] = 1; mem[0x3000] = 0b00011011; mem[0x3008] = 0x80;
  let io = chip({ registers: { 0x11: 0x1b, 0x16: 0xd8, 0x18: 0x1c, 0x21: 0, 0x22: 2, 0x23: 7 }, color: [8 | 5, 1] });
  assert.deepEqual(colours(rows({ mem, chip: io, crop: [0, 0, 10, 1] })[0]), [0, 0, 2, 2, 7, 7, 5, 5, 1, 0]);
  // a hi-res bitmap at $2000 ($D018 $18, $D011 $3B): its first byte one dot, the screen's byte $16 (white on blue)
  mem = new Uint8Array(0x10000); mem[0x2000] = 0x80; mem[0x400] = 0x16;
  io = chip({ registers: { 0x11: 0x3b, 0x16: 0xc8, 0x18: 0x18 } });
  assert.deepEqual(colours(rows({ mem, chip: io, crop: [0, 0, 3, 1] })[0]), [1, 6, 6]);
  // sprite 0 at the screen's top left (24, 50), its data at $2000 (pointer $80 at $07F8), its first dot in red
  mem = new Uint8Array(0x10000); mem[0x7f8] = 0x80; mem[0x2000] = 0x80;
  io = chip({ registers: { 0x11: 0x1b, 0x16: 0xc8, 0x18: 0x14, 0x15: 1, 0x00: 24, 0x01: 50, 0x27: 2, 0x21: 0 } });
  assert.deepEqual(colours(rows({ mem, chip: io, crop: [0, 0, 2, 1] })[0]), [2, 0]);
  // twice the size: each pixel twice across and twice down
  const big = rows({ mem, chip: io, crop: [0, 0, 1, 1], scale: 2 });
  assert.equal(big.length, 2); assert.equal(big[0].length, 2);
});

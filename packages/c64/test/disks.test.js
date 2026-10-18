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

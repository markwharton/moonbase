// The Apple's disks and screens read, from bytes the tests build, nothing of a title's: a DOS 3.3 disk with a binary
// file and an Applesoft program; a ProDOS volume, in block order and in DOS order, with a file whose end is past its
// block and an Integer BASIC file; a hi-res screen as a picture; an Applesoft program listed.
//
//   node --test test/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dos33 } from '@moonbase-machines/apple2e/dos33-disk.js';
import { prodos } from '@moonbase-machines/apple2e/prodos-disk.js';
import { picture, rows } from '@moonbase-machines/apple2e/hires-picture.js';
import { paintHires } from '@moonbase-machines/apple2e/screen.js';
import { list } from '@moonbase-machines/apple2e/applesoft-list.js';
import { readPng } from '@moonbase-machines/files/png-read.js';

const name30 = s => [...s.padEnd(30)].map(c => c.charCodeAt(0) | 0x80);

test('a DOS 3.3 disk: its catalogue, a binary file at its address, an Applesoft program at its length', () => {
  const disk = new Uint8Array(143360), at = (t, s) => (t * 16 + s) * 256;
  disk.set([0, 17, 15, 3, 0, 0, 254], at(17, 0));   // the VTOC: the catalogue at 17/15, volume 254
  const cat = at(17, 15);
  disk.set([18, 0, 0x84, ...name30('PO8:MAIN'), 2, 0], cat + 11);            // binary, locked, its list at 18/0
  disk.set([18, 1, 0x02, ...name30('HELLO'), 2, 0], cat + 11 + 35);          // Applesoft, its list at 18/1
  disk.set([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 19, 0], at(18, 0));
  disk.set([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 19, 1], at(18, 1));
  disk.set([0x00, 0x08, 3, 0, 0xa9, 0x01, 0x60], at(19, 0));                 // $0800, three bytes
  disk.set([2, 0, 0xab, 0xcd], at(19, 1));                                     // two bytes
  const { volume, files } = dos33(disk);
  assert.equal(volume, 254);
  assert.deepEqual(files.map(f => [f.name, f.type, f.locked]), [['PO8:MAIN', 'B', true], ['HELLO', 'A', false]]);
  assert.equal(files[0].address, 0x800); assert.deepEqual([...files[0].body], [0xa9, 0x01, 0x60]);
  assert.deepEqual([...files[1].body], [0xab, 0xcd]);
  assert.throws(() => dos33(new Uint8Array(100)), /143,360 bytes/);
});

// a ProDOS volume in block order: its directory at block 2, a binary file in block 5 whose end (600) is past its
// one block, an Integer BASIC file in block 6
function volume(blocks = 16) {
  const v = new Uint8Array(blocks * 512), dir = 2 * 512, entry = (i, bytes) => v.set(bytes, dir + 4 + i * 39);
  const name = s => [...s].map(c => c.charCodeAt(0));
  entry(0, [0xf0 | 4, ...name('GAME')]);
  const file = (i, n, type, key, size, aux) => { const e = new Uint8Array(39); e.set([0x10 | n.length, ...name(n)]); e[0x10] = type; e[0x11] = key; e[0x13] = 1; e[0x15] = size & 0xff; e[0x16] = size >> 8; e[0x1f] = aux & 0xff; e[0x20] = aux >> 8; entry(i, e); };
  file(1, 'LIB.VARS', 0x06, 5, 600, 0x2000);
  file(2, 'OLD', 0xfa, 6, 3, 0x801);
  v.fill(0x41, 5 * 512, 6 * 512); v.set([1, 2, 3], 6 * 512);
  return v;
}

test('a ProDOS volume: a file past its blocks reads as zeros to its end, an Integer BASIC file is INT', () => {
  const { volume: name, files } = prodos(volume());
  assert.equal(name, 'GAME');
  const [vars, old] = files;
  assert.equal(vars.path, 'LIB.VARS'); assert.equal(vars.typeName, 'BIN'); assert.equal(vars.aux, 0x2000);
  assert.equal(vars.body.length, 600); assert.equal(vars.body[511], 0x41); assert.equal(vars.body[512], 0); assert.equal(vars.body[599], 0);
  assert.equal(old.typeName, 'INT'); assert.deepEqual([...old.body], [1, 2, 3]);
});

test('a ProDOS volume in DOS 3.3 sector order reads as the same volume', () => {
  const po = volume(280), dsk = new Uint8Array(143360);
  const SECTORS = [[0, 14], [13, 12], [11, 10], [9, 8], [7, 6], [5, 4], [3, 2], [1, 15]];
  for (let t = 0; t < 35; t++) for (let b = 0; b < 8; b++) {
    const [a, c] = SECTORS[b], at = (t * 8 + b) * 512;
    dsk.set(po.subarray(at, at + 256), (t * 16 + a) * 256); dsk.set(po.subarray(at + 256, at + 512), (t * 16 + c) * 256);
  }
  const a = prodos(volume()), d = prodos(dsk);   // (a 140K image is always read as DOS order: the block-order volume a smaller one)
  assert.deepEqual(d.files.map(f => [f.path, f.size, [...f.body.subarray(0, 4)]]), a.files.map(f => [f.path, f.size, [...f.body.subarray(0, 4)]]));
});

test('a hi-res screen as a picture is the machine\'s own drawing of it, 560 by 384', () => {
  const page = new Uint8Array(8192);
  page[0] = 0x01; page[1] = 0x83; page[0x400 + 5] = 0x7f;   // a lone violet dot, an orange pair, a white run
  const p = readPng(picture(page)), own = paintHires(new Uint8Array(560 * 384 * 4), page);
  assert.equal(p.width, 560); assert.equal(p.height, 384);
  for (const [x, y] of [[0, 0], [14, 0], [16, 0], [70, 2], [100, 2], [300, 300]]) {
    const o = (y * 560 + x) * 4, hex = [own[o], own[o + 1], own[o + 2]].map(v => v.toString(16).padStart(2, '0')).join('');
    assert.equal(p.at(x, y), hex, `at ${x}, ${y}`);
  }
  assert.deepEqual(rows(page)[0][0], [own[0], own[1], own[2]]);
});

test('an Applesoft program listed: keywords spaced, a string and REM as written, a control character named', () => {
  // 10 PRINT "HI" / 20 REM PRINT IS TEXT / 30 PRINT "^D": at $0801, each line linked to the next
  const lines = [[10, [0xba, 0x22, 0x48, 0x49, 0x22]], [20, [0xb2, ...[...' PRINT IS TEXT'].map(c => c.charCodeAt(0))]], [30, [0xba, 0x22, 0x04, 0x22]]];
  const bytes = [];
  for (const [n, body] of lines) { const next = 0x801 + bytes.length + 4 + body.length + 1; bytes.push(next & 0xff, next >> 8, n & 0xff, n >> 8, ...body, 0); }
  bytes.push(0, 0);
  assert.equal(list(Uint8Array.from(bytes)), '10 PRINT "HI"\n20 REM PRINT IS TEXT\n30 PRINT "{CTRL-D}"\n');
});

// A PNG written and read back; a zip read, its files stored and deflated, a folder and a Mac's __MACOSX copy among
// them. Made from bytes the tests build, nothing of a title's.
//
//   node --test test/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { png, pngOfRGBA, sheet, padded } from '@moonbase-machines/files/png.js';
import { readPng } from '@moonbase-machines/files/png-read.js';
import { unzip, fromZip } from '@moonbase-machines/files/zip.js';

test('a PNG of rows, with and without alpha, reads back pixel for pixel', () => {
  const rows = [[[255, 0, 0], [0, 255, 0]], [[0, 0, 255], [17, 34, 51]]];
  const p = readPng(png(rows));
  assert.equal(p.width, 2); assert.equal(p.height, 2);
  assert.deepEqual([p.at(0, 0), p.at(1, 0), p.at(0, 1), p.at(1, 1)], ['ff0000', '00ff00', '0000ff', '112233']);
  const q = readPng(png([[[1, 2, 3, 128]]]));
  assert.equal(q.at(0, 0), '010203');
});

test('a PNG of RGBA bytes reads back as the same picture as its rows', () => {
  const rgba = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 1, 2, 3, 255]);
  const p = readPng(pngOfRGBA(rgba, 2, 2));
  assert.deepEqual([p.at(0, 0), p.at(1, 0), p.at(0, 1), p.at(1, 1)], ['0a141e', '28323c', '46505a', '010203']);
  const rows = [[[10, 20, 30], [40, 50, 60]], [[70, 80, 90], [1, 2, 3]]];
  assert.deepEqual(pngOfRGBA(rgba, 2, 2, { alpha: false }), png(rows), 'without its alpha, the same bytes as the rows\' PNG');
});

test('a sheet lays pictures out with gray between, the smaller padded to the largest', () => {
  const a = [[[255, 255, 255]]], b = [[[0, 0, 0], [0, 0, 0]], [[0, 0, 0], [0, 0, 0]]];
  const [pa, pb] = padded([a, b]);
  assert.equal(pa.length, 2); assert.equal(pa[0].length, 2); assert.deepEqual(pa[1][1], [60, 60, 60]);
  const s = readPng(sheet([pa, pb], { across: 2, gap: 1 }));
  assert.equal(s.width, 5); assert.equal(s.height, 2);
  assert.deepEqual([s.at(0, 0), s.at(2, 0), s.at(3, 0)], ['ffffff', '3c3c3c', '000000']);
});

// a zip as a zip tool writes one: local headers, the data, the central directory and its end
function zip(entries) {
  const locals = [], central = [];
  let at = 0;
  for (const { name, data, deflate } of entries) {
    const body = deflate ? deflateRawSync(data) : data, n = Buffer.from(name, 'latin1');
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(deflate ? 8 : 0, 8); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(deflate ? 8 : 0, 10); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(at, 42);
    locals.push(local, n, body); central.push(c, n);
    at += 30 + n.length + body.length;
  }
  const dir = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(at, 16);
  return Buffer.concat([...locals, dir, end]);
}

test('a zip read: every file but a folder, stored or deflated; one found by name, past __MACOSX', () => {
  const disk = Buffer.alloc(300, 7);
  const z = zip([
    { name: 'disks/', data: Buffer.alloc(0) },
    { name: '__MACOSX/disks/._Game.dsk', data: Buffer.from('mac') },
    { name: 'disks/Game.dsk', data: disk, deflate: true },
    { name: 'README.txt', data: Buffer.from('hello') },
  ]);
  const files = unzip(z);
  assert.deepEqual(files.map(f => f.name), ['__MACOSX/disks/._Game.dsk', 'disks/Game.dsk', 'README.txt']);
  assert.deepEqual(files.map(f => f.method), [0, 8, 0]);
  assert.equal(files[2].body.toString(), 'hello');
  const { name, body } = fromZip(z, /\.dsk$/i);
  assert.equal(name, 'disks/Game.dsk'); assert.deepEqual(body, disk);
  assert.throws(() => fromZip(z, /\.d64$/), /nothing in the zip matches/);
  assert.throws(() => unzip(Buffer.alloc(40)), /not a zip/);
});

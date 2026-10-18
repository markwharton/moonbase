// The player's disk (disk/disk.js) on the memory backend, as the browser's IndexedDB one keeps it:
// files written, read at once, listed newest first, removed, and there again when the disk is opened
// again; and the Commodore 64's drive on it (@moonbase-machines/c64/saves.js): a file the game saves is kept, and
// in the drive the next time.
//
//   node --test test/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDisk, textBytes, bytesText } from '@moonbase-machines/player/disk/disk.js';
import { memory } from '@moonbase-machines/player/disk/memory.js';
import { Drive } from '@moonbase-machines/c64/drive.js';
import { keepDrive } from '@moonbase-machines/c64/saves.js';
import { make } from '@moonbase-machines/c64/d64.js';

test('a file written is read at once, and kept for the next time the disk is opened', async () => {
  const backend = memory();
  const a = await openDisk('title/one', { backend });
  assert.deepEqual(a.list(), []);
  a.write('STORY', [1, 2, 3], { kind: 'PRG' });
  assert.deepEqual([...a.read('STORY')], [1, 2, 3], 'read before it is stored');
  await a.written();
  const b = await openDisk('title/one', { backend });
  assert.deepEqual([...b.read('STORY')], [1, 2, 3]);
  assert.deepEqual(b.list().map(f => [f.name, f.size, f.meta]), [['STORY', 3, { kind: 'PRG' }]]);
  assert.equal(b.read('NONE'), null);
});

test('each disk its own; the newest first; a file removed is gone', async () => {
  const backend = memory();
  const d = await openDisk('title/two', { backend }), other = await openDisk('title/three', { backend });
  d.write('first', textBytes('one'));
  await new Promise(r => setTimeout(r, 5));
  d.write('second', textBytes('two'));
  other.write('first', [9]);
  assert.deepEqual(d.list().map(f => f.name), ['second', 'first']);
  assert.equal(bytesText(d.read('second')), 'two');
  await d.remove('first');
  const again = await openDisk('title/two', { backend });
  assert.deepEqual(again.list().map(f => f.name), ['second']);
  assert.deepEqual([...(await openDisk('title/three', { backend })).read('first')], [9]);
});

test('a copy written is the disk\'s own: changing the bytes after does not change it', async () => {
  const d = await openDisk('t', { backend: memory() });
  const bytes = new Uint8Array([1, 2]);
  d.write('f', bytes); bytes[0] = 7;
  assert.equal(d.read('f')[0], 1);
});

test('a backend that keeps nothing says so', async () => {
  assert.equal((await openDisk('t', { backend: memory({ kept: false }) })).kept, false);
});

test('a C64 game\'s SAVE is kept on the player\'s disk, and in the drive the next time', async () => {
  const backend = memory();
  const image = make({ name: 'game', id: '01', files: [] });
  const disk = await openDisk('title/one', { backend });
  const one = new Drive(image);
  keepDrive(one, disk);
  one.save(Uint8Array.from('TALE', c => c.charCodeAt(0)), Uint8Array.from([0x00, 0xc0, 42]));
  await disk.written();
  const two = new Drive(image);
  keepDrive(two, await openDisk('title/one', { backend }));
  assert.deepEqual([...two.load(Uint8Array.from('TALE', c => c.charCodeAt(0)))], [0x00, 0xc0, 42]);
});

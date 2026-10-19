// The player's parts that every way to play shares (play.js): the keys as each machine takes them (keys.js), the
// saves on the player's disk (saves.js), a write the disk's backend cannot store (disk/disk.js); and no title named in
// the packages' code, only in their comments, as examples.
//
//   node --test test/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { code, named } from '@moonbase-machines/player/keys.js';
import { savesFor } from '@moonbase-machines/player/saves.js';
import { openDisk } from '@moonbase-machines/player/disk/disk.js';
import { memory } from '@moonbase-machines/player/disk/memory.js';
import { Drive } from '@moonbase-machines/c64/drive.js';
import { make } from '@moonbase-machines/c64/d64.js';

const key = (k, mods = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

test('a key is the Apple\'s code or the Commodore 64\'s, by the machine\'s kind', () => {
  assert.equal(code(key('ArrowLeft'), 'prodos'), 8);
  assert.equal(code(key('ArrowLeft'), 'c64'), 157);
  assert.equal(code(key('Tab'), 'dos33'), 9);
  assert.equal(code(key('a'), 'prodos'), 97, 'the Apple a small letter as typed');
  assert.equal(code(key('a'), 'c64'), 65, 'the 64 its capital');
  assert.equal(code(key('e', { ctrlKey: true }), 'prodos'), 5, 'control-E');
  assert.equal(code(key('a', { metaKey: true }), 'prodos'), undefined, 'the browser\'s own');
  assert.equal(code(key('a'), undefined), undefined, 'a title of its own engine has no table');
  assert.equal(code(key('Shift'), 'prodos'), undefined);
  assert.deepEqual(['space', 'left', 'A'].map(n => named(n, 'prodos')), [32, 8, 65]);
  assert.deepEqual(['left', 'delete'].map(n => named(n, 'c64')), [157, 20]);
});

test('the saves: a game\'s volume given what is kept, and a change to its files kept', async () => {
  const disk = await openDisk('title/one', { backend: memory() });
  disk.write('KEPT', [1, 2], { type: 'BIN', aux: 0x2000 });
  const game = { kind: 'prodos', volumes: { GAME: {} }, saves: { volume: 'SAVES', dos: 'prodos' } };
  const saves = savesFor(game, disk);
  assert.deepEqual(Object.keys(saves.data.volumes), ['GAME', 'SAVES']);
  assert.equal(saves.data.volumes.SAVES.KEPT.type, 'BIN');
  // a Commodore 64's drive: what it saves is kept on the disk
  const drive = new Drive(make({ name: 'DISK', id: 'MB', files: [] }));
  savesFor({ kind: 'c64' }, disk).drive(drive);
  drive.keep('SAVED', Uint8Array.of(1, 8, 9));
  await disk.written();
  assert.deepEqual([...disk.read('SAVED')], [1, 8, 9]);
});

test('a write the backend cannot store is said, and the writes after it are stored', async () => {
  const backend = memory(), put = backend.put;
  let refuse = true;
  backend.put = (d, f) => refuse && f.name === 'BAD' ? Promise.reject(new Error('full')) : put.call(backend, d, f);
  const disk = await openDisk('title/two', { backend }), said = [];
  disk.failed = err => said.push(err.message);
  await assert.rejects(disk.write('BAD', [1]), /full/);
  await disk.write('GOOD', [2]);
  await disk.written();
  assert.deepEqual(said, ['full']);
  refuse = false;
  assert.deepEqual([...(await openDisk('title/two', { backend })).read('GOOD')], [2]);
});

// the titles, by name and by address; the packages' code, their comments taken out
const TITLES = /pieces[ -]of[ -]eight|detect-a-pet|goldfields|zoopak|nature[ -]park|animal[ -]rescue|aztlan|crayon|po8/i;
const packages = new URL('../../', import.meta.url).pathname;
const sources = dir => readdirSync(dir).flatMap(n => {
  const f = join(dir, n);
  if (['node_modules', 'dist', 'test'].includes(n)) return [];
  return statSync(f).isDirectory() ? sources(f) : /\.m?js$/.test(n) ? [f] : [];
});

test('no title is named in the packages\' code, only in their comments', () => {
  const found = [];
  for (const f of sources(packages)) {
    const lines = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, '')).split('\n');
    lines.forEach((l, i) => { const c = l.replace(/(^|\s)\/\/.*$/, ''); if (TITLES.test(c)) found.push(`${f.slice(packages.length)}:${i + 1}`); });
  }
  assert.deepEqual(found, []);
});

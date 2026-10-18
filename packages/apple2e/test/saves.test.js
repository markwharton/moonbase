// The data disk on the player's disk (saves.js): a game saved through ProDOS's calls is written there,
// and on the data disk again when the game starts again; a file destroyed is removed.
//
//   node --test test/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Files } from '@moonbase/apple2e/mli.js';
import { withSaves, keepSaves } from '@moonbase/apple2e/saves.js';

// a player's disk as saves.js uses it, in memory
function playerDisk() {
  const files = new Map();
  return {
    list: () => [...files].map(([name, f]) => ({ name, meta: f.meta })),
    read: n => files.get(n)?.bytes ?? null,
    write: (n, bytes, meta) => { files.set(n, { bytes: Uint8Array.from(bytes), meta }); },
    remove: n => { files.delete(n); },
  };
}

function machine(kept) {
  const files = new Files(withSaves('detect-a-pet', { volumes: { DAP: {} } }, kept));
  keepSaves('detect-a-pet', files, kept);
  const mem = new Uint8Array(0x10000), io = { read: a => mem[a], write: (a, v) => { mem[a] = v & 0xff; } };
  const call = (cmd, bytes) => { mem.set(bytes, 0x300); return files.call(cmd, 0x300, io); };
  const name = s => { mem[0x400] = s.length; for (let i = 0; i < s.length; i++) mem[0x401 + i] = s.charCodeAt(i); };
  return { files, mem, call, name };
}

test('a title that saves has a data disk, and one with no saves has none', () => {
  assert.deepEqual(Object.keys(withSaves('detect-a-pet', { volumes: { DAP: {} } }, playerDisk()).volumes), ['DAP', 'SAVES']);
  assert.deepEqual(Object.keys(withSaves('animal-rescue', { volumes: { AR: {} } }, playerDisk()).volumes), ['AR']);
});

test('a game saved is kept, is on the data disk the next time, and is gone once destroyed', () => {
  const kept = playerDisk();
  const a = machine(kept);
  a.name('/SAVES/SAM');
  assert.equal(a.call(0xc0, [7, 0x00, 0x04, 0xc3, 0x12, 0, 0, 1, 0, 0, 0, 0]), 0);   // CREATE, type $12
  assert.equal(a.call(0xc8, [3, 0x00, 0x04, 0, 0x10, 0]), 0);                        // OPEN
  const ref = a.mem[0x305];
  a.mem.set([7, 8, 9], 0x5000);
  assert.equal(a.call(0xcb, [4, ref, 0x00, 0x50, 3, 0, 0, 0]), 0);                   // WRITE three bytes
  assert.equal(a.call(0xcc, [1, ref]), 0);                                            // CLOSE
  assert.deepEqual(kept.list().map(f => f.name), ['SAM']);
  const b = machine(kept);
  const f = b.files.file('/SAVES/SAM');
  assert.ok(f, 'the game is on the disk again');
  assert.deepEqual([...f.body], [7, 8, 9]);
  assert.equal(f.type, 0x12);
  b.name('/SAVES/SAM');
  assert.equal(b.call(0xc1, [1, 0x00, 0x04]), 0);                                     // DESTROY
  assert.deepEqual(kept.list(), []);
});

// Pieces of Eight: a DOS 3.3 disk, its saves on its own volume, DISK, beside the game's files (BSAVE and DELETE
// put and remove a file whole, rom.js)
function po8(kept) {
  const game = { kind: 'dos33', volumes: { DISK: { 'PO8:MAIN': { type: 'B', aux: 0x800, data: btoa('\x01\x02') } } } };
  const files = new Files(withSaves('pieces-of-eight', game, kept));
  keepSaves('pieces-of-eight', files, kept);
  return files;
}

test('a game Pieces of Eight saves is kept, is on its disk the next time, its own files not; DELETE removes it', () => {
  const kept = playerDisk();
  const a = po8(kept);
  a.put('/DISK/PO8:CAMP.SAV', { volume: 'DISK', path: 'PO8:CAMP.SAV', type: 'B', aux: 0x240, body: Uint8Array.from([1, 2, 3]) });
  assert.deepEqual(kept.list().map(f => f.name), ['PO8:CAMP.SAV'], 'the save kept, the game\'s own file not');
  assert.deepEqual(kept.list()[0].meta, { type: 'B', aux: 0x240 });
  const b = po8(kept);
  assert.deepEqual([...b.file('PO8:CAMP.SAV').body], [1, 2, 3], 'on the disk again');
  assert.ok(b.file('PO8:MAIN'), 'the game\'s own files there as ever');
  b.put('/DISK/PO8:CAMP.SAV', { volume: 'DISK', path: 'PO8:CAMP.SAV', type: 'B', aux: 0x240, body: Uint8Array.from([4, 5, 6]) });
  assert.deepEqual([...kept.read('PO8:CAMP.SAV')], [4, 5, 6], 'saved over');
  b.remove('/DISK/PO8:CAMP.SAV');
  assert.deepEqual(kept.list(), []);
});

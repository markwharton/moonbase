// The data disk a browser keeps (saves.js): a game saved through ProDOS's calls is in local
// storage after, and on the disk again when the page is loaded again.
//
//   node --test test/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Files } from '@moonbase/apple2e/mli.js';
import { withSaves, keepSaves } from '@moonbase/apple2e/saves.js';

const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };

function disk() {
  const files = new Files(withSaves('detect-a-pet', { volumes: { DAP: {} } }));
  keepSaves('detect-a-pet', files);
  const mem = new Uint8Array(0x10000), io = { read: a => mem[a], write: (a, v) => { mem[a] = v & 0xff; } };
  const call = (cmd, bytes) => { mem.set(bytes, 0x300); return files.call(cmd, 0x300, io); };
  const name = s => { mem[0x400] = s.length; for (let i = 0; i < s.length; i++) mem[0x401 + i] = s.charCodeAt(i); };
  return { files, mem, call, name };
}

test('a title that saves has a blank data disk, and one with no saves has none', () => {
  assert.deepEqual(Object.keys(withSaves('detect-a-pet', { volumes: { DAP: {} } }).volumes), ['DAP', 'SAVES']);
  assert.deepEqual(Object.keys(withSaves('animal-rescue', { volumes: { AR: {} } }).volumes), ['AR']);
});

test('a game saved is kept, and is on the data disk the next time', () => {
  const a = disk();
  a.name('/SAVES/SAM');
  assert.equal(a.call(0xc0, [7, 0x00, 0x04, 0xc3, 0x12, 0, 0, 1, 0, 0, 0, 0]), 0);   // CREATE, type $12
  assert.equal(a.call(0xc8, [3, 0x00, 0x04, 0, 0x10, 0]), 0);                        // OPEN
  const ref = a.mem[0x305];
  a.mem.set([7, 8, 9], 0x5000);
  assert.equal(a.call(0xcb, [4, ref, 0x00, 0x50, 3, 0, 0, 0]), 0);                   // WRITE three bytes
  assert.equal(a.call(0xcc, [1, ref]), 0);                                            // CLOSE
  const b = disk();
  const f = b.files.file('/SAVES/SAM');
  assert.ok(f, 'the game is on the disk again');
  assert.deepEqual([...f.body], [7, 8, 9]);
  assert.equal(f.type, 0x12);
});

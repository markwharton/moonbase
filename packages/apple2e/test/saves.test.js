// The data disk on the player's disk (saves.js): a game saved through ProDOS's calls is written there,
// and on the data disk again when the game starts again; a file destroyed is removed. And on Apple's ROMs (line 1):
// the kept games on the drive's disk before it boots, the card saying when its disk was written, and what the
// title's DOS wrote there kept.
//
//   node --test test/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Files } from '@moonbase-machines/apple2e/mli.js';
import { withSaves, keepSaves, onDisks, driveFiles } from '@moonbase-machines/apple2e/saves.js';
import { Disk2, track, image, TRACKS } from '@moonbase-machines/apple2e/disk2.js';
import { dos33, save as saveDos33, remove as removeDos33 } from '@moonbase-machines/apple2e/dos33-disk.js';
import { prodos } from '@moonbase-machines/apple2e/prodos-disk.js';
import { placed } from '@moonbase-machines/apple2e/prodos.js';
import { emptyDos33 } from './empty-dos33.js';

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

test('the Disk II says a disk was written when the motor is switched off after a write, and not after a read', () => {
  let cycles = 0;
  const card = new Disk2(new Uint8Array(256), () => cycles), told = [];
  card.insert(0, emptyDos33());
  card.onWritten(n => told.push(n));
  card.io(9); cycles += 1000; card.io(12); card.io(14); card.io(8);   // the motor on, a read, off
  assert.deepEqual(told, [], 'nothing written');
  card.io(9); card.io(13); card.io(15, 0xff); card.io(15, 0xd5); card.io(14); card.io(8);   // on, write mode, two bytes, off
  assert.deepEqual(told, [0], 'drive 1 written');
  card.io(9); card.io(8);
  assert.deepEqual(told, [0], 'once');
});

// line 1's Pieces of Eight: its own disk, DISK, in slot 6's drive 1, a game's file on it; the machine as far as
// driveFiles needs it, its cards
function po8Line1(kept) {
  const own = emptyDos33();
  saveDos33(own, { name: 'PO8:MAIN', address: 0x800, body: Uint8Array.from([1, 2]) });
  const game = { kind: 'dos33', images: ['po8.dsk'], volumes: { DISK: { 'PO8:MAIN': { type: 'B', aux: 0x800, data: btoa('\x01\x02') } } } };
  const disks = onDisks('pieces-of-eight', placed(withSaves('pieces-of-eight', game, kept), new Map([['po8.dsk', own]])), kept);
  const card = new Disk2(new Uint8Array(256), () => 0), m = { slots: [] };
  m.slots[6] = card; card.insert(0, disks[0].image);
  const files = driveFiles(m, disks, 'pieces-of-eight');
  keepSaves('pieces-of-eight', files, kept);
  // as the title's DOS would leave the disk: its catalogue changed on the tracks, then the motor off
  const write = change => { const bytes = image(card.drives[0].tracks); change(bytes); card.drives[0].tracks = Array.from({ length: TRACKS }, (_, t) => track(bytes, t)); card.drives[0].written = true; card.io(8); };
  return { disks, write };
}

test('line 1: a kept game is on Pieces of Eight\'s disk as it boots; a game its DOS saves is kept; DELETE removes it', () => {
  const kept = playerDisk();
  kept.write('PO8:CAMP.SAV', Uint8Array.from([5, 6]), { type: 'B', aux: 0x240 });
  const a = po8Line1(kept);
  const onDisk = dos33(a.disks[0].image).files;
  assert.deepEqual(onDisk.map(f => [f.name, f.address, [...f.body]]), [['PO8:MAIN', 0x800, [1, 2]], ['PO8:CAMP.SAV', 0x240, [5, 6]]], 'the game\'s file and the kept one');
  a.write(bytes => saveDos33(bytes, { name: 'PO8:FORT.SAV', address: 0x240, body: Uint8Array.from([9]) }));
  assert.deepEqual(kept.list().map(f => f.name).sort(), ['PO8:CAMP.SAV', 'PO8:FORT.SAV'], 'the new game kept, the game\'s own file not');
  assert.deepEqual([[...kept.read('PO8:FORT.SAV')], kept.list().find(f => f.name === 'PO8:FORT.SAV').meta], [[9], { type: 'B', aux: 0x240 }], 'as line 2\'s BSAVE keeps it');
  a.write(bytes => removeDos33(bytes, 'PO8:CAMP.SAV'));
  assert.deepEqual(kept.list().map(f => f.name), ['PO8:FORT.SAV'], 'deleted');
  // and on line 2 the next time, as BLOAD reads it
  assert.deepEqual([...po8(kept).file('PO8:FORT.SAV').body], [9]);
});

test('line 1: Detect-A-Pet\'s SAVES is a blank ProDOS disk with the kept games on it', () => {
  const kept = playerDisk();
  kept.write('SAM', Uint8Array.from([7, 8, 9]), { type: 0x12, aux: 0 });
  const game = { kind: 'prodos', images: ['dap.dsk'], volumes: { DAP: {} } };
  const disks = onDisks('detect-a-pet', placed(withSaves('detect-a-pet', game, kept), new Map([['dap.dsk', new Uint8Array(143360)]])), kept);
  const saves = disks.find(d => d.volume === 'SAVES');
  assert.equal(saves.unit, 0xe0, 'in drive 2 beside the game\'s');
  const read = prodos(image(Array.from({ length: TRACKS }, (_, t) => track(saves.image, t, { order: saves.order }))));
  assert.deepEqual(read.files.map(f => [f.name, f.type, [...f.body]]), [['SAM', 0x12, [7, 8, 9]]]);
});

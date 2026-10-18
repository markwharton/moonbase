// ProDOS's machine language interface in JavaScript (mli.js) held to what ProDOS does. As with
// the ROM's routines, a mistake here is the same on every machine that calls it; these tests check
// the calls' parameters and results as ProDOS gives them.
//
//   node --test test/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Files } from '@moonbase-machines/apple2e/mli.js';

const b64 = s => btoa(String.fromCharCode(...s));
// a game of two volumes, a file on each and one in a directory, and a blank data disk
function disk() {
  const files = new Files({ volumes: {
    GAME: { 'PROG': { type: 'BIN', aux: 0x2000, data: b64([1, 2, 3]) }, 'LIB/ONE': { type: 'BIN', aux: 0, data: b64([9]) } },
    DATA: {},
  } });
  const mem = new Uint8Array(0x10000), io = { read: a => mem[a], write: (a, v) => { mem[a] = v & 0xff; } };
  const name = (at, s) => { mem[at] = s.length; for (let i = 0; i < s.length; i++) mem[at + 1 + i] = s.charCodeAt(i); };
  const call = (cmd, params) => { mem.set(params.bytes, 0x300); return files.call(cmd, 0x300, io); };
  return { files, mem, name, call };
}
const OPEN = 0xc8, READ = 0xca, CLOSE = 0xcc, SET_PREFIX = 0xc6, CREATE = 0xc0, GET_FILE_INFO = 0xc4;

test('OPEN gives the lowest reference number free, as ProDOS does, and CLOSE frees it', () => {
  const { mem, name, call } = disk();
  name(0x400, '/GAME/PROG');
  const open = () => { assert.equal(call(OPEN, { bytes: [3, 0x00, 0x04, 0, 0x10, 0] }), 0); return mem[0x305]; };
  assert.equal(open(), 1); assert.equal(open(), 2);
  call(CLOSE, { bytes: [1, 1] });
  assert.equal(open(), 1);   // a game may keep a reference number and count on getting it again
});

test('SET_PREFIX keeps the prefix ending in a slash, so a name under it is found', () => {
  const { mem, name, call } = disk();
  name(0x400, '/GAME'); assert.equal(call(SET_PREFIX, { bytes: [1, 0x00, 0x04] }), 0);
  name(0x400, 'PROG'); assert.equal(call(OPEN, { bytes: [3, 0x00, 0x04, 0, 0x10, 0] }), 0);
  assert.ok(mem[0x305]);
});

test('READ past the end of a file reads nothing and gives the end-of-file error, $4C', () => {
  const { mem, name, call } = disk();
  name(0x400, '/GAME/PROG'); call(OPEN, { bytes: [3, 0x00, 0x04, 0, 0x10, 0] });
  const ref = mem[0x305];
  assert.equal(call(READ, { bytes: [4, ref, 0x00, 0x50, 10, 0, 0, 0] }), 0);
  assert.deepEqual([mem[0x306], mem[0x5000], mem[0x5002]], [3, 1, 3]);   // three of the ten asked
  assert.equal(call(READ, { bytes: [4, ref, 0x00, 0x50, 10, 0, 0, 0] }), 0x4c);
  assert.deepEqual([mem[0x306], mem[0x307]], [0, 0]);
});

test('CREATE keeps the file type and aux type it is given', () => {
  const { mem, name, call } = disk();
  name(0x400, '/DATA/SAVE');
  assert.equal(call(CREATE, { bytes: [7, 0x00, 0x04, 0xc3, 0x12, 0x34, 0x12, 1, 0, 0, 0, 0] }), 0);
  assert.equal(call(GET_FILE_INFO, { bytes: [0x0a, 0x00, 0x04] }), 0);
  assert.deepEqual([mem[0x304], mem[0x305] | mem[0x306] << 8], [0x12, 0x1234]);
});

test('a volume opened is read as its directory: the header, then an entry for each file and directory', () => {
  const { mem, name, call } = disk();
  name(0x400, '/GAME'); call(OPEN, { bytes: [3, 0x00, 0x04, 0, 0x10, 0] });
  call(READ, { bytes: [4, mem[0x305], 0x00, 0x50, 0x00, 0x02, 0, 0] });
  const entry = k => 0x5000 + 4 + k * 0x27, label = at => String.fromCharCode(...mem.slice(at + 1, at + 1 + (mem[at] & 15)));
  assert.equal(mem[entry(0)] >> 4, 0xf); assert.equal(label(entry(0)), 'GAME');   // a volume's header
  assert.deepEqual([mem[entry(0) + 0x1f], mem[entry(0) + 0x20], mem[entry(0) + 0x21]], [0x27, 0x0d, 2]);   // entries of $27, 13 a block, 2 of them
  assert.equal(label(entry(1)), 'PROG'); assert.equal(mem[entry(1)] >> 4, 1);   // a seedling, of three bytes
  assert.deepEqual([mem[entry(1) + 0x10], mem[entry(1) + 0x15], mem[entry(1) + 0x1f] | mem[entry(1) + 0x20] << 8], [0x06, 3, 0x2000]);
  assert.equal(label(entry(2)), 'LIB'); assert.equal(mem[entry(2)] >> 4, 0xd); assert.equal(mem[entry(2) + 0x10], 0x0f);   // a directory
});

test('a blank data disk is a volume with no files, and a file created on it is in its directory', () => {
  const { mem, name, call } = disk();
  name(0x400, '/DATA/SAVE'); call(CREATE, { bytes: [7, 0x00, 0x04, 0xc3, 0x12, 0, 0, 1, 0, 0, 0, 0] });
  name(0x400, '/DATA'); assert.equal(call(OPEN, { bytes: [3, 0x00, 0x04, 0, 0x10, 0] }), 0);
  call(READ, { bytes: [4, mem[0x305], 0x00, 0x50, 0x00, 0x02, 0, 0] });
  assert.equal(mem[0x5004 + 0x21], 1);
  assert.equal(String.fromCharCode(...mem.slice(0x5004 + 0x27 + 1, 0x5004 + 0x27 + 5)), 'SAVE');
});

test('CREATE of a name already there is the duplicate filename error, $47, and DESTROY of one not there, $46', () => {
  const { name, call } = disk();
  name(0x400, '/DATA/SAVE');
  const create = () => call(CREATE, { bytes: [7, 0x00, 0x04, 0xc3, 0x06, 0, 0, 1, 0, 0, 0, 0] }), destroy = () => call(0xc1, { bytes: [1, 0x00, 0x04] });
  assert.equal(create(), 0); assert.equal(create(), 0x47);   // a game saving over a name destroys it first
  assert.equal(destroy(), 0); assert.equal(destroy(), 0x46);
});

test('a write-protected disk refuses every write, $2B, and a full one a new block, $48', () => {
  const both = state => {
    const files = new Files({ volumes: { GAME: { PROG: { type: 'BIN', aux: 0, data: b64([1]) } }, DATA: { OLD: { type: 'BIN', aux: 0, data: b64([7, 7]) } } }, disks: { DATA: state } });
    const mem = new Uint8Array(0x10000), io = { read: a => mem[a], write: (a, v) => { mem[a] = v & 0xff; } };
    const call = (cmd, bytes) => { mem.set(bytes, 0x300); return files.call(cmd, 0x300, io); };
    const name = s => { mem[0x400] = s.length; for (let i = 0; i < s.length; i++) mem[0x401 + i] = s.charCodeAt(i); };
    return { mem, call, name };
  };
  let { mem, call, name } = both('protected');
  name('/DATA/NEW'); assert.equal(call(CREATE, [7, 0x00, 0x04, 0xc3, 0x06, 0, 0, 1, 0, 0, 0, 0]), 0x2b);
  name('/DATA/OLD'); assert.equal(call(0xc1, [1, 0x00, 0x04]), 0x2b);
  assert.equal(call(OPEN, [3, 0x00, 0x04, 0, 0x10, 0]), 0);   // reading is as it was
  assert.equal(call(0xcb, [4, mem[0x305], 0x00, 0x50, 1, 0, 0, 0]), 0x2b);
  name('/GAME/PROG'); assert.equal(call(0xc1, [1, 0x00, 0x04]), 0);   // the other disk is not protected
  ({ mem, call, name } = both('full'));
  name('/DATA/NEW'); assert.equal(call(CREATE, [7, 0x00, 0x04, 0xc3, 0x06, 0, 0, 1, 0, 0, 0, 0]), 0x48);
  name('/DATA/OLD'); call(OPEN, [3, 0x00, 0x04, 0, 0x10, 0]);
  const ref = mem[0x305];
  assert.equal(call(0xcb, [4, ref, 0x00, 0x50, 100, 0, 0, 0]), 0);       // within the block it has
  assert.equal(call(0xcb, [4, ref, 0x00, 0x50, 0, 2, 0, 0]), 0x48);      // past it
});

test('a disk out of its drive: no volume of its name ($45), an I/O error on a file open on it ($27), and not on line', () => {
  const { files, mem, name, call } = disk();
  name(0x400, '/DATA/SAVE'); call(CREATE, { bytes: [7, 0x00, 0x04, 0xc3, 0x06, 0, 0, 1, 0, 0, 0, 0] });
  call(OPEN, { bytes: [3, 0x00, 0x04, 0, 0x10, 0] });
  const ref = mem[0x305];
  files.drive('DATA', false);
  assert.equal(call(OPEN, { bytes: [3, 0x00, 0x04, 0, 0x10, 0] }), 0x45);
  assert.equal(call(0xcb, { bytes: [4, ref, 0x00, 0x50, 1, 0, 0, 0] }), 0x27);
  assert.equal(call(0xc5, { bytes: [2, 0, 0x00, 0x60] }), 0);
  assert.deepEqual([mem[0x6000] & 0x0f, mem[0x6010]], [4, 0]);   // GAME alone
  name(0x400, '/GAME/PROG'); assert.equal(call(OPEN, { bytes: [3, 0x00, 0x04, 0, 0x10, 0] }), 0);
  files.drive('DATA', true);
  name(0x400, '/DATA/SAVE'); assert.equal(call(OPEN, { bytes: [3, 0x00, 0x04, 0, 0x10, 0] }), 0);
});

test('a disk with one block free takes a new file and its first block, and no more', () => {
  const files = new Files({ volumes: { GAME: {}, DATA: {} }, disks: { DATA: 'one-free' } });
  const mem = new Uint8Array(0x10000), io = { read: a => mem[a], write: (a, v) => { mem[a] = v & 0xff; } };
  const call = (cmd, bytes) => { mem.set(bytes, 0x300); return files.call(cmd, 0x300, io); };
  mem.set([9, ...'/DATA/NEW'].map(c => typeof c === 'string' ? c.charCodeAt(0) : c), 0x400);
  assert.equal(call(CREATE, [7, 0x00, 0x04, 0xc3, 0x06, 0, 0, 1, 0, 0, 0, 0]), 0);
  call(OPEN, [3, 0x00, 0x04, 0, 0x10, 0]);
  const ref = mem[0x305];
  assert.equal(call(0xcb, [4, ref, 0x00, 0x50, 0, 2, 0, 0]), 0);        // 512 bytes: the key block
  assert.equal(call(0xcb, [4, ref, 0x00, 0x50, 1, 0, 0, 0]), 0x48);     // one more needs another
});

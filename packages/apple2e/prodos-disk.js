// A ProDOS disk read and written: a 140K .dsk in DOS sector order, a .po in block order, or a 2mg, read; a file
// saved on a volume in block order, or destroyed on it, as ProDOS's own CREATE, WRITE and DESTROY leave the
// volume. In Node or the browser. An image of 140K is read as DOS order, as a .dsk is: a 140K .po is the same size
// and its bytes cannot say which it is.
//
// ProDOS sees a disk as 512-byte blocks. Block 2 starts the volume directory. A directory is a
// chain of blocks, each with a two-byte link to the previous and next block, then 39-byte entries,
// 13 to a block; the first entry of the first block is the directory's own header. An entry gives
// the file's name, type, key block, block count, size and the address it loads at (aux type), and
// a storage type: 1 for a file in one block, 2 for one whose key block is an index of up to 256
// blocks, 3 for one whose key block indexes up to 128 such indexes, and $D for a subdirectory. The
// volume's bitmap, from the block its header names, has a bit for each block, set while it is free.
//
//   prodos(image)   { volume, files: [{ path, name, type, typeName, key, blocks, size, aux, storage, body }] }
//                   (a subdirectory's entry with an empty body, and its files after it, their paths under it)
//   save(volume, { name, type, aux, body })   a file in the volume directory, in place of any of its name: in
//                   one block, or (to 128K) an index block and its blocks, each the lowest free, as ProDOS takes
//                   them; throws if the volume or its directory is full
//   remove(volume, name)                      a file destroyed: its entry cleared and its blocks freed; false if none

const TYPES = { 0x00: 'NON', 0x01: 'BAD', 0x04: 'TXT', 0x06: 'BIN', 0x0f: 'DIR', 0xfa: 'INT', 0x19: 'ADB', 0x1a: 'AWP', 0x1b: 'ASP', 0xb3: 'S16', 0xc1: 'PIC', 0xc9: 'FND', 0xca: 'ICN', 0xef: 'PAS', 0xf0: 'CMD', 0xfc: 'BAS', 0xfd: 'VAR', 0xfe: 'REL', 0xff: 'SYS' };

// A 140K disk written in DOS 3.3 sector order holds each ProDOS block as two sectors of a track,
// and not the two you would guess: block 0 is sectors 0 and 14, block 1 is 13 and 12, and so on
// down to block 7 in sectors 1 and 15.
const DOS_SECTORS = [[0, 14], [13, 12], [11, 10], [9, 8], [7, 6], [5, 4], [3, 2], [1, 15]];

const word = (b, at) => b[at] | b[at + 1] << 8;
const long = (b, at) => (b[at] | b[at + 1] << 8 | b[at + 2] << 16 | b[at + 3] << 24) >>> 0;
const concat = parts => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };

function blocksOf(image) {
  if (image.length >= 64 && String.fromCharCode(...image.subarray(0, 4)) === '2IMG') {
    if (long(image, 12) !== 1) throw new Error('the 2mg is not in ProDOS order');
    const start = long(image, 0x18), length = long(image, 0x1c);
    return image.subarray(start, start + length);
  }
  if (image.length !== 143360) return image;   // .po, or a larger block-ordered image
  const out = new Uint8Array(143360);
  for (let t = 0; t < 35; t++) for (let b = 0; b < 8; b++) {
    const [a, c] = DOS_SECTORS[b];
    out.set(image.subarray((t * 16 + a) * 256, (t * 16 + a + 1) * 256), (t * 8 + b) * 512);
    out.set(image.subarray((t * 16 + c) * 256, (t * 16 + c + 1) * 256), (t * 8 + b) * 512 + 256);
  }
  return out;
}

export function prodos(image) {
  const disk = blocksOf(image);
  const block = n => disk.subarray(n * 512, (n + 1) * 512);
  // a file's bytes, from its key block, by its storage type
  const indexed = index => { const out = []; for (let i = 0; i < 256; i++) { const b = index[i] | index[256 + i] << 8; out.push(b ? block(b) : new Uint8Array(512)); } return out; };
  const read = (storage, key, size) => {
    let parts;
    if (storage === 1) parts = [block(key)];
    else if (storage === 2) parts = indexed(block(key));
    else if (storage === 3) { parts = []; const master = block(key); for (let i = 0; i < 128; i++) { const b = master[i] | master[256 + i] << 8; parts.push(...(b ? indexed(block(b)) : Array(256).fill(new Uint8Array(512)))); } }
    else throw new Error('storage type ' + storage);
    // (a file whose end is past its blocks, as Detect-A-Pet's LIB.VARS, a block long with an
    // end at 1,154, reads as ProDOS reads it: zeros after its blocks, to its end)
    const body = concat(parts);
    return body.length >= size ? body.subarray(0, size) : concat([body, new Uint8Array(size - body.length)]);
  };
  const files = [];
  let volume = '';
  const directory = (first, path) => {
    for (let n = first; n; n = word(block(n), 2)) {
      const b = block(n);
      for (let i = 0; i < 13; i++) {
        const e = b.subarray(4 + i * 39, 4 + (i + 1) * 39);
        const storage = e[0] >> 4, name = String.fromCharCode(...e.subarray(1, 1 + (e[0] & 15)));
        if (storage === 0) continue;
        if (storage === 0xf) { volume = name; continue; }
        if (storage === 0xe) continue;   // a subdirectory's own header
        const file = { path: path + name, name, type: e[0x10], typeName: TYPES[e[0x10]] || '$' + e[0x10].toString(16).toUpperCase().padStart(2, '0'),
          key: word(e, 0x11), blocks: word(e, 0x13), size: e[0x15] | e[0x16] << 8 | e[0x17] << 16, aux: word(e, 0x1f), storage };
        if (storage === 0xd) { file.body = new Uint8Array(0); files.push(file); directory(file.key, file.path + '/'); continue; }
        file.body = read(storage, file.key, file.size);
        files.push(file);
      }
    }
  };
  directory(2, '');
  return { volume, files };
}

// the volume directory's entries, each with its block's number, and the volume's header and bitmap
function volumeOf(volume) {
  const block = n => volume.subarray(n * 512, (n + 1) * 512), header = block(2).subarray(4, 43);
  const entries = [];
  for (let n = 2, first = true, guard = 0; n && guard < 64; n = word(block(n), 2), guard++) {
    for (let i = first ? 1 : 0; i < 13; i++) entries.push({ n, e: block(n).subarray(4 + i * 39, 4 + (i + 1) * 39) });
    first = false;
  }
  const bitmap = word(header, 0x23), total = word(header, 0x25);
  const isFree = b => !!(volume[bitmap * 512 + (b >> 3)] & 0x80 >> (b & 7));
  const mark = (b, free) => { const at = bitmap * 512 + (b >> 3), m = 0x80 >> (b & 7); volume[at] = free ? volume[at] | m : volume[at] & ~m; };
  return { block, header, entries, total, isFree, mark };
}
const nameIs = (e, name) => (e[0] >> 4) && String.fromCharCode(...e.subarray(1, 1 + (e[0] & 15))) === name;

export function remove(volume, name) {
  const v = volumeOf(volume), found = v.entries.find(({ e }) => nameIs(e, name));
  if (!found) return false;
  const e = found.e, key = word(e, 0x11);
  if (e[0] >> 4 === 2) { const index = v.block(key); for (let i = 0; i < 256; i++) { const b = index[i] | index[256 + i] << 8; if (b) v.mark(b, true); } }
  else if (e[0] >> 4 !== 1) throw new Error(`${name}: only a file of one block, or of an index of blocks, is destroyed here`);
  v.mark(key, true);
  e.fill(0);
  const count = word(v.header, 0x21) - 1; v.header[0x21] = count & 0xff; v.header[0x22] = count >> 8;
  return true;
}

export function save(volume, { name, type, aux = 0, body }) {
  if (!/^[A-Z][A-Z0-9.]{0,14}$/.test(name)) throw new Error(`not a ProDOS name: ${name}`);
  if (body.length > 128 * 1024) throw new Error(`${name}: more than 128K`);
  remove(volume, name);
  const v = volumeOf(volume), slot = v.entries.find(({ e }) => !(e[0] >> 4));
  if (!slot) throw new Error('the volume directory is full');
  const n = Math.max(1, Math.ceil(body.length / 512)), sapling = body.length > 512, need = n + (sapling ? 1 : 0);
  const take = [];
  for (let b = 0; b < v.total && take.length < need; b++) if (v.isFree(b)) take.push(b);
  if (take.length < need) throw new Error('the volume is full');
  for (const b of take) { v.mark(b, false); v.block(b).fill(0); }
  const key = take[0], data = sapling ? take.slice(1) : take;
  data.forEach((b, i) => v.block(b).set(body.subarray(i * 512, (i + 1) * 512)));
  if (sapling) { const index = v.block(key); data.forEach((b, i) => { index[i] = b & 0xff; index[256 + i] = b >> 8; }); }
  const e = slot.e;
  e.fill(0);
  e[0] = (sapling ? 0x20 : 0x10) | name.length;
  for (let i = 0; i < name.length; i++) e[1 + i] = name.charCodeAt(i);
  e[0x10] = type; e[0x11] = key & 0xff; e[0x12] = key >> 8; e[0x13] = need & 0xff; e[0x14] = need >> 8;
  e[0x15] = body.length & 0xff; e[0x16] = body.length >> 8 & 0xff; e[0x17] = body.length >> 16;
  e[0x1e] = 0xe3; e[0x1f] = aux & 0xff; e[0x20] = aux >> 8 & 0xff; e[0x25] = 2;
  const count = word(v.header, 0x21) + 1; v.header[0x21] = count & 0xff; v.header[0x22] = count >> 8;
}

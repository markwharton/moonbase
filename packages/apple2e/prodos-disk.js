// A ProDOS disk read, in Node: a 140K .dsk in DOS sector order, a .po in block order, or a 2mg. An image of
// 140K is read as DOS order, as a .dsk is: a 140K .po is the same size and its bytes cannot say which it is.
//
// ProDOS sees a disk as 512-byte blocks. Block 2 starts the volume directory. A directory is a
// chain of blocks, each with a two-byte link to the previous and next block, then 39-byte entries,
// 13 to a block; the first entry of the first block is the directory's own header. An entry gives
// the file's name, type, key block, block count, size and the address it loads at (aux type), and
// a storage type: 1 for a file in one block, 2 for one whose key block is an index of up to 256
// blocks, 3 for one whose key block indexes up to 128 such indexes, and $D for a subdirectory.
//
//   prodos(image)   { volume, files: [{ path, name, type, typeName, key, blocks, size, aux, storage, body }] }
//                   (a subdirectory's entry with an empty body, and its files after it, their paths under it)

const TYPES = { 0x00: 'NON', 0x01: 'BAD', 0x04: 'TXT', 0x06: 'BIN', 0x0f: 'DIR', 0xfa: 'INT', 0x19: 'ADB', 0x1a: 'AWP', 0x1b: 'ASP', 0xb3: 'S16', 0xc1: 'PIC', 0xc9: 'FND', 0xca: 'ICN', 0xef: 'PAS', 0xf0: 'CMD', 0xfc: 'BAS', 0xfd: 'VAR', 0xfe: 'REL', 0xff: 'SYS' };

// A 140K disk written in DOS 3.3 sector order holds each ProDOS block as two sectors of a track,
// and not the two you would guess: block 0 is sectors 0 and 14, block 1 is 13 and 12, and so on
// down to block 7 in sectors 1 and 15.
const DOS_SECTORS = [[0, 14], [13, 12], [11, 10], [9, 8], [7, 6], [5, 4], [3, 2], [1, 15]];

function blocksOf(image) {
  image = Buffer.from(image.buffer, image.byteOffset, image.length);
  if (image.length >= 64 && image.toString('latin1', 0, 4) === '2IMG') {
    if (image.readUInt32LE(12) !== 1) throw new Error('the 2mg is not in ProDOS order');
    const start = image.readUInt32LE(0x18), length = image.readUInt32LE(0x1c);
    return image.subarray(start, start + length);
  }
  if (image.length !== 143360) return image;   // .po, or a larger block-ordered image
  const out = Buffer.alloc(143360);
  for (let t = 0; t < 35; t++) for (let b = 0; b < 8; b++) {
    const [a, c] = DOS_SECTORS[b];
    image.copy(out, (t * 8 + b) * 512, (t * 16 + a) * 256, (t * 16 + a + 1) * 256);
    image.copy(out, (t * 8 + b) * 512 + 256, (t * 16 + c) * 256, (t * 16 + c + 1) * 256);
  }
  return out;
}

export function prodos(image) {
  const disk = blocksOf(image);
  const block = n => disk.subarray(n * 512, (n + 1) * 512);
  // a file's bytes, from its key block, by its storage type
  const indexed = index => { const out = []; for (let i = 0; i < 256; i++) { const b = index[i] | index[256 + i] << 8; out.push(b ? block(b) : Buffer.alloc(512)); } return out; };
  const read = (storage, key, size) => {
    let parts;
    if (storage === 1) parts = [block(key)];
    else if (storage === 2) parts = indexed(block(key));
    else if (storage === 3) { parts = []; const master = block(key); for (let i = 0; i < 128; i++) { const b = master[i] | master[256 + i] << 8; parts.push(...(b ? indexed(block(b)) : Array(256).fill(Buffer.alloc(512)))); } }
    else throw new Error('storage type ' + storage);
    // (a file whose end is past its blocks, as Detect-A-Pet's LIB.VARS, a block long with an
    // end at 1,154, reads as ProDOS reads it: zeros after its blocks, to its end)
    const body = Buffer.concat(parts);
    return body.length >= size ? body.subarray(0, size) : Buffer.concat([body, Buffer.alloc(size - body.length)]);
  };
  const files = [];
  let volume = '';
  const directory = (first, path) => {
    for (let n = first; n; n = block(n).readUInt16LE(2)) {
      const b = block(n);
      for (let i = 0; i < 13; i++) {
        const e = b.subarray(4 + i * 39, 4 + (i + 1) * 39);
        const storage = e[0] >> 4, name = e.toString('latin1', 1, 1 + (e[0] & 15));
        if (storage === 0) continue;
        if (storage === 0xf) { volume = name; continue; }
        if (storage === 0xe) continue;   // a subdirectory's own header
        const file = { path: path + name, name, type: e[0x10], typeName: TYPES[e[0x10]] || '$' + e[0x10].toString(16).toUpperCase().padStart(2, '0'),
          key: e.readUInt16LE(0x11), blocks: e.readUInt16LE(0x13), size: e.readUIntLE(0x15, 3), aux: e.readUInt16LE(0x1f), storage };
        if (storage === 0xd) { file.body = Buffer.alloc(0); files.push(file); directory(file.key, file.path + '/'); continue; }
        file.body = read(storage, file.key, file.size);
        files.push(file);
      }
    }
  };
  directory(2, '');
  return { volume, files };
}


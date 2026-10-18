// A DOS 3.3 disk read, in Node: its catalogue and each file's bytes. (A disk out of its zip: fromZip,
// @moonbase-machines/files/zip.js.)
//
// A DOS 3.3 disk is 35 tracks of 16 sectors of 256 bytes, 143,360 bytes in all, in DOS order. Track 17, sector 0
// is the VTOC, which says where the catalogue starts. Each catalogue sector holds seven file entries; each entry
// says where the file's track/sector list is, and the list says which sectors hold the file, in order. A binary
// file starts with its address and length, an Applesoft one with its length.
//
//   dos33(disk)   { volume, files: [{ name, type ('T', 'I', 'A', 'B'), locked, sectors, address (binary),
//                 body }] }
const TYPES = { 0x00: 'T', 0x01: 'I', 0x02: 'A', 0x04: 'B' };   // text, Integer BASIC, Applesoft, binary

export function dos33(disk) {
  if (disk.length !== 143360) throw new Error('a DOS 3.3 disk is 143,360 bytes, and this one is ' + disk.length);
  disk = Buffer.from(disk.buffer, disk.byteOffset, disk.length);
  const sector = (t, s) => disk.subarray((t * 16 + s) * 256, (t * 16 + s + 1) * 256);
  const vtoc = sector(17, 0);
  const files = [];
  for (let t = vtoc[1], s = vtoc[2]; t; ) {
    const c = sector(t, s);
    for (let i = 0; i < 7; i++) {
      const e = c.subarray(11 + i * 35, 11 + (i + 1) * 35);
      if (e[0] === 0x00 || e[0] === 0xff) continue;   // never used, or deleted
      const name = Buffer.from(e.subarray(3, 33).map(b => b & 0x7f)).toString('latin1').trimEnd();
      files.push({ name, type: TYPES[e[2] & 0x7f] || '?', locked: !!(e[2] & 0x80), sectors: e[33] | e[34] << 8, list: [e[0], e[1]] });
    }
    [t, s] = [c[1], c[2]];
  }
  // a file's bytes: every sector its track/sector lists name, in order
  const read = file => {
    const parts = [];
    for (let [t, s] = file.list; t; ) {
      const list = sector(t, s);
      for (let k = 0; k < 122; k++) {
        const ft = list[12 + k * 2], fs = list[13 + k * 2];
        if (ft || fs) parts.push(sector(ft, fs));
      }
      [t, s] = [list[1], list[2]];
    }
    return Buffer.concat(parts);
  };
  for (const f of files) {
    const raw = read(f);
    if (f.type === 'B') { f.address = raw.readUInt16LE(0); f.body = raw.subarray(4, 4 + raw.readUInt16LE(2)); }
    else if (f.type === 'A') f.body = raw.subarray(2, 2 + raw.readUInt16LE(0));
    else f.body = raw;
  }
  return { volume: vtoc[6], files };
}

// A DOS 3.3 disk read and written: its catalogue and each file's bytes, and a binary file saved on it or deleted
// from it as DOS 3.3's own BSAVE and DELETE leave the disk. In Node or the browser. (A disk out of its zip:
// fromZip, @moonbase-machines/files/zip.js.)
//
// A DOS 3.3 disk is 35 tracks of 16 sectors of 256 bytes, 143,360 bytes in all, in DOS order. Track 17, sector 0
// is the VTOC, which says where the catalogue starts and, four bytes a track from $38, which sectors are free (a
// bit set, sector 15 the top bit of the first byte, sector 0 the bottom bit of the second). Each catalogue sector
// holds seven file entries of 35 bytes from $0B: the track and sector of the file's track/sector list, its type
// (bit 7 locked), its name in 30 characters, high bit set and padded with spaces, and its count of sectors, the
// lists' among them. A deleted entry has $FF for its list's track, which is moved to the name's last character.
// A track/sector list holds up to 122 track and sector pairs from $0C, the next list's track and sector at 1 and 2.
// A binary file starts with its address and length, an Applesoft one with its length.
//
//   dos33(disk)                         { volume, files: [{ name, type ('T', 'I', 'A', 'B'), locked, sectors,
//                                       address (binary), body }] }
//   save(disk, { name, address, body })  a binary file on the disk, in place of any of its name: its catalogue
//                                       entry, its list and its sectors taken from the VTOC's map as DOS 3.3 takes
//                                       them; throws if the disk is full
//   remove(disk, name)                  a file deleted: its entry marked so and its sectors freed; false if none
const TYPES = { 0x00: 'T', 0x01: 'I', 0x02: 'A', 0x04: 'B' };   // text, Integer BASIC, Applesoft, binary
const SIZE = 143360, PAIRS = 122;

const check = disk => { if (disk.length !== SIZE) throw new Error('a DOS 3.3 disk is 143,360 bytes, and this one is ' + disk.length); };
const sector = (disk, t, s) => disk.subarray((t * 16 + s) * 256, (t * 16 + s + 1) * 256);
const word = (b, at) => b[at] | b[at + 1] << 8;
const nameOf = e => String.fromCharCode(...e.subarray(3, 33).map(b => b & 0x7f)).trimEnd();

// every catalogue entry, with the sector it is in and its place there
function entries(disk) {
  const vtoc = sector(disk, 17, 0), out = [];
  for (let t = vtoc[1], s = vtoc[2], guard = 0; t && guard < 560; guard++) {
    const c = sector(disk, t, s);
    for (let i = 0; i < 7; i++) out.push({ c, at: 11 + i * 35, e: c.subarray(11 + i * 35, 11 + (i + 1) * 35) });
    [t, s] = [c[1], c[2]];
  }
  return out;
}
const used = e => e[0] !== 0x00 && e[0] !== 0xff;

// the sectors a file's lists name, the lists' own first, as [t, s]
function sectorsOf(disk, list) {
  const lists = [], data = [];
  for (let [t, s] = list, guard = 0; t && guard < 560; guard++) {
    const l = sector(disk, t, s);
    lists.push([t, s]);
    for (let k = 0; k < PAIRS; k++) data.push([l[12 + k * 2], l[13 + k * 2]]);
    [t, s] = [l[1], l[2]];
  }
  return { lists, data };
}

export function dos33(disk) {
  check(disk);
  const files = [];
  for (const { e } of entries(disk)) {
    if (!used(e)) continue;
    const f = { name: nameOf(e), type: TYPES[e[2] & 0x7f] || '?', locked: !!(e[2] & 0x80), sectors: word(e, 33) };
    // a file's bytes: every sector its lists name, in order; a pair of zeros, a sector never written, is left out
    const parts = sectorsOf(disk, [e[0], e[1]]).data.filter(([t, s]) => t || s).map(([t, s]) => sector(disk, t, s));
    const raw = new Uint8Array(parts.length * 256);
    parts.forEach((p, i) => raw.set(p, i * 256));
    if (f.type === 'B') { f.address = word(raw, 0); f.body = raw.subarray(4, 4 + word(raw, 2)); }
    else if (f.type === 'A') f.body = raw.subarray(2, 2 + word(raw, 0));
    else f.body = raw;
    files.push(f);
  }
  return { volume: sector(disk, 17, 0)[6], files };
}

// the VTOC's map: a sector free, made free, or taken
const bit = (t, s) => [0x38 + t * 4 + (s < 8 ? 1 : 0), 1 << (s & 7)];
const free = (vtoc, t, s) => { const [at, m] = bit(t, s); return !!(vtoc[at] & m); };
const mark = (vtoc, t, s, isFree) => { const [at, m] = bit(t, s); vtoc[at] = isFree ? vtoc[at] | m : vtoc[at] & ~m; };

// the free sectors in the order DOS 3.3 takes them: a track at a time, from the one after the last it took, in
// the VTOC's direction ($31), out from the catalogue's track 17 and back the other way once it reaches an edge;
// in each track the highest sector first
function freeSectors(vtoc) {
  const out = [], tracks = vtoc[0x34] || 35, seen = new Set();
  let t = vtoc[0x30] || 17, d = vtoc[0x31] === 1 ? 1 : -1;
  for (let n = 0; n < 2 * tracks; n++) {
    t += d;
    if (t < 0 || t >= tracks) { d = -d; t = 17 + d; }
    if (t === 17 || seen.has(t)) continue;
    seen.add(t);
    for (let s = 15; s >= 0; s--) if (free(vtoc, t, s)) out.push([t, s, d]);
  }
  return out;
}

export function remove(disk, name) {
  check(disk);
  const vtoc = sector(disk, 17, 0);
  const found = entries(disk).find(({ e }) => used(e) && nameOf(e) === name);
  if (!found) return false;
  const { lists, data } = sectorsOf(disk, [found.e[0], found.e[1]]);
  for (const [t, s] of [...lists, ...data.filter(([t, s]) => t || s)]) mark(vtoc, t, s, true);
  found.e[32] = found.e[0]; found.e[0] = 0xff;
  return true;
}

export function save(disk, { name, address, body }) {
  check(disk);
  if (name.length > 30) throw new Error(`a DOS 3.3 name is 30 characters at most: ${name}`);
  remove(disk, name);
  const vtoc = sector(disk, 17, 0);
  const slot = entries(disk).find(({ e }) => !used(e));
  if (!slot) throw new Error('DISK FULL: no catalogue entry free');
  // the bytes as they are on the disk: the address and the length first
  const raw = new Uint8Array(4 + body.length);
  raw[0] = address & 0xff; raw[1] = address >> 8; raw[2] = body.length & 0xff; raw[3] = body.length >> 8; raw.set(body, 4);
  const n = Math.ceil(raw.length / 256), listsNeeded = Math.max(1, Math.ceil(n / PAIRS));
  const take = freeSectors(vtoc).slice(0, listsNeeded + n);
  if (take.length < listsNeeded + n) throw new Error('DISK FULL');
  // DOS takes a list's sector first, then the file's, in turn
  const lists = [], data = [];
  for (let k = 0, i = 0; k < listsNeeded; k++) {
    lists.push(take[i++]);
    for (let j = 0; j < PAIRS && data.length < n; j++) data.push(take[i++]);
  }
  for (const [t, s] of [...lists, ...data]) mark(vtoc, t, s, false);
  const last = take.at(-1); vtoc[0x30] = last[0]; vtoc[0x31] = last[2] === 1 ? 1 : 0xff;
  lists.forEach(([t, s], k) => {
    const l = sector(disk, t, s);
    l.fill(0);
    if (lists[k + 1]) { l[1] = lists[k + 1][0]; l[2] = lists[k + 1][1]; }
    l[5] = (k * PAIRS) & 0xff; l[6] = (k * PAIRS) >> 8;
    data.slice(k * PAIRS, (k + 1) * PAIRS).forEach(([dt, ds], j) => { l[12 + j * 2] = dt; l[13 + j * 2] = ds; });
  });
  data.forEach(([t, s], i) => { const d = sector(disk, t, s); d.fill(0); d.set(raw.subarray(i * 256, (i + 1) * 256)); });
  const e = slot.e;
  e.fill(0xa0);
  e[0] = lists[0][0]; e[1] = lists[0][1]; e[2] = 0x04;
  for (let i = 0; i < name.length; i++) e[3 + i] = name.charCodeAt(i) | 0x80;
  e[33] = (lists.length + n) & 0xff; e[34] = (lists.length + n) >> 8;
}

// Writing a Commodore 1541 disk image, a .d64, as the 1541 itself would leave it, so that it loads
// on Moonbase's C64, in VICE and on a real 64 (by an SD2IEC or the like). 35 tracks of 256-byte
// sectors, 21 a track on the outer tracks and fewer further in, 174,848 bytes. Track 18 holds the
// BAM and the disk's name in sector 0 and the directory from sector 1; each file is a chain of
// sectors, each starting with the track and sector of the next, or 0 and the index of its last
// byte. Files are laid down from track 17 outward and from 19 inward, as the 1541 does, ten
// sectors apart on a track, the directory three apart.
//
//   make({ name: 'CRAYON', id: 'MB', files: [{ name: 'CRAYON', data, type: 'PRG' }] })
//     data   the file's bytes; for a program, its load address first, as a .prg has it
//     a Uint8Array of 174,848 bytes
//   add(image, files)   files added to a disk that has some, theirs left where they are (below)
export const SECTORS = [...Array(17).fill(21), ...Array(7).fill(19), ...Array(6).fill(18), ...Array(5).fill(17)];
const TYPES = { DEL: 0, SEQ: 1, PRG: 2, USR: 3, REL: 4 };
const offset = (t, s) => (SECTORS.slice(0, t - 1).reduce((a, b) => a + b, 0) + s) * 256;

// a name as the 1541 keeps it: 16 bytes of PETSCII, the letters as capitals, padded with $A0
const name16 = text => {
  const out = new Uint8Array(16).fill(0xa0);
  [...String(text).toUpperCase()].slice(0, 16).forEach((c, i) => { out[i] = c.charCodeAt(0) & 0xff; });
  return out;
};

export function make({ name = 'MOONBASE', id = 'MB', files = [] } = {}) {
  const image = new Uint8Array(174848), used = SECTORS.map(n => new Array(n).fill(false));
  const take = (t, s) => { used[t - 1][s] = true; return offset(t, s); };
  take(18, 0);

  // the sectors for a file: the tracks nearest the directory first, ten sectors apart on each
  const ORDER = [];
  for (let d = 1; d <= 17; d++) { if (18 - d >= 1) ORDER.push(18 - d); if (18 + d <= 35) ORDER.push(18 + d); }
  const free = () => {
    for (const t of ORDER) {
      const n = SECTORS[t - 1], start = used[t - 1].lastTaken ?? -10;
      for (let k = 0; k < n; k++) { const s = (start + 10 + k) % n; if (!used[t - 1][s]) { used[t - 1][s] = true; used[t - 1].lastTaken = s; return [t, s]; } }
    }
    throw new Error('the disk is full');
  };

  // the files' bodies, sector by sector
  const entries = files.map(f => {
    const data = f.data instanceof Uint8Array ? f.data : Uint8Array.from(f.data);
    const chunks = Math.max(1, Math.ceil(data.length / 254)), places = Array.from({ length: chunks }, free);
    places.forEach(([t, s], i) => {
      const at = take(t, s), part = data.subarray(i * 254, (i + 1) * 254);
      if (i + 1 < chunks) { image[at] = places[i + 1][0]; image[at + 1] = places[i + 1][1]; }
      else { image[at] = 0; image[at + 1] = part.length + 1; }
      image.set(part, at + 2);
    });
    return { name: name16(f.name), type: 0x80 | (TYPES[f.type ?? 'PRG'] ?? 2), first: places[0], blocks: chunks };
  });

  // the directory: eight entries a sector, on track 18 from sector 1, three apart
  const dirSectors = [];
  for (let i = 0, s = 1; i < Math.max(1, Math.ceil(entries.length / 8)); i++, s = (s + 3) % 19) {
    while (used[17][s]) s = (s + 1) % 19;
    if (dirSectors.length >= 18) throw new Error('the directory is full: 144 files');
    take(18, s); dirSectors.push(s);
  }
  dirSectors.forEach((s, i) => {
    const at = offset(18, s);
    if (i + 1 < dirSectors.length) { image[at] = 18; image[at + 1] = dirSectors[i + 1]; } else { image[at] = 0; image[at + 1] = 0xff; }
    entries.slice(i * 8, i * 8 + 8).forEach((e, k) => {
      const p = at + k * 32;
      image[p + 2] = e.type; image[p + 3] = e.first[0]; image[p + 4] = e.first[1];
      image.set(e.name, p + 5);
      image[p + 30] = e.blocks & 0xff; image[p + 31] = e.blocks >> 8;
    });
  });

  // the BAM: the directory's first sector, the format's mark, each track's free count and map
  const bam = offset(18, 0);
  image[bam] = 18; image[bam + 1] = dirSectors[0]; image[bam + 2] = 0x41;
  for (let t = 1; t <= 35; t++) {
    const map = used[t - 1].map(u => !u), at = bam + 4 * t;
    image[at] = map.filter(Boolean).length;
    for (let s = 0; s < map.length; s++) if (map[s]) image[at + 1 + (s >> 3)] |= 1 << (s & 7);
  }
  image.set(name16(name), bam + 0x90);
  image[bam + 0xa0] = image[bam + 0xa1] = 0xa0;
  image[bam + 0xa2] = String(id).charCodeAt(0) || 0x30; image[bam + 0xa3] = String(id).charCodeAt(1) || 0x30;
  image[bam + 0xa4] = 0xa0; image[bam + 0xa5] = 0x32; image[bam + 0xa6] = 0x41;
  image.fill(0xa0, bam + 0xa7, bam + 0xab);
  return image;
}

// Files added to a disk that already has some, as a 1541 SAVEs them: the disk's own files left in
// their sectors (a game may read them by track and sector), a file of the same name replaced and
// its sectors freed, the new ones laid in free sectors as the BAM has them and entered in the
// directory's first empty entry (a new directory sector where none is empty).
//
//   add(image, [{ name, data }])   a new image; the one given is not changed
export function add(image, files) {
  const out = Uint8Array.from(image), bam = offset(18, 0);
  const isFree = (t, s) => !!(out[bam + 4 * t + 1 + (s >> 3)] & 1 << (s & 7));
  const mark = (t, s, free) => {
    const at = bam + 4 * t + 1 + (s >> 3), was = isFree(t, s);
    if (free) out[at] |= 1 << (s & 7); else out[at] &= ~(1 << (s & 7));
    out[bam + 4 * t] += free && !was ? 1 : !free && was ? -1 : 0;
  };
  const ORDER = [];
  for (let d = 1; d <= 17; d++) { if (18 - d >= 1) ORDER.push(18 - d); if (18 + d <= 35) ORDER.push(18 + d); }
  const last = {};
  const take = () => {
    for (const t of ORDER) {
      const n = SECTORS[t - 1];
      for (let k = 0; k < n; k++) { const s = ((last[t] ?? -10) + 10 + k) % n; if (isFree(t, s)) { mark(t, s, false); last[t] = s; return [t, s]; } }
    }
    throw new Error('the disk is full');
  };
  // the directory's entries, by where each is
  const entries = () => {
    const list = [];
    for (let [t, s] = [out[bam], out[bam + 1]], n = 0; t && n < 18; n++) {
      const at = offset(t, s);
      for (let k = 0; k < 8; k++) list.push(at + k * 32);
      [t, s] = [out[at], out[at + 1]];
    }
    return list;
  };
  for (const f of files) {
    const name = name16(f.name), data = f.data instanceof Uint8Array ? f.data : Uint8Array.from(f.data);
    // (one of the same name: its sectors freed, its entry emptied)
    for (const e of entries()) {
      if (!(out[e + 2] & 7) || !name.every((b, i) => out[e + 5 + i] === b)) continue;
      for (let [t, s] = [out[e + 3], out[e + 4]], n = 0; t && n < 683; n++) { const at = offset(t, s); mark(t, s, true); [t, s] = [out[at], out[at + 1]]; }
      out[e + 2] = 0;
    }
    const chunks = Math.max(1, Math.ceil(data.length / 254)), places = Array.from({ length: chunks }, take);
    places.forEach(([t, s], i) => {
      const at = offset(t, s), part = data.subarray(i * 254, (i + 1) * 254);
      out.fill(0, at, at + 256);
      if (i + 1 < chunks) { out[at] = places[i + 1][0]; out[at + 1] = places[i + 1][1]; } else { out[at] = 0; out[at + 1] = part.length + 1; }
      out.set(part, at + 2);
    });
    let e = entries().find(e => !(out[e + 2] & 7) && !out[e + 2]);
    if (e === undefined) {
      // (a new directory sector, on track 18, linked after the last)
      const list = entries(), lastSector = list[list.length - 1] - 7 * 32;
      let s = 1; while (s < 19 && !isFree(18, s)) s++;
      if (s >= 19) throw new Error('the directory is full');
      mark(18, s, false);
      const at = offset(18, s); out.fill(0, at, at + 256); out[at + 1] = 0xff;
      out[lastSector] = 18; out[lastSector + 1] = s;
      e = at;
    }
    out.fill(0, e + 2, e + 32);
    out[e + 2] = 0x80 | (TYPES[f.type ?? 'PRG'] ?? 2); out[e + 3] = places[0][0]; out[e + 4] = places[0][1];
    out.set(name, e + 5);
    out[e + 30] = chunks & 0xff; out[e + 31] = chunks >> 8;
  }
  return out;
}

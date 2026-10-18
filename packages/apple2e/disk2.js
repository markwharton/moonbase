// The Disk II: its card in a slot, two drives, and a 5.25" disk as the drive's head sees it, a
// track at a time, a stream of nibbles. moonbase's own, for the Apple with its ROMs, where Apple's
// ROM and the card's own boot ROM (341-0027) read the disk as they read a real one, and DOS 3.3
// or ProDOS boots from it.
//
// A 140K image holds a disk's sectors, 256 bytes each, 16 to a track, 35 tracks, in DOS 3.3's
// order. On the disk each sector is two fields, as DOS 3.3 and ProDOS both write them:
//   an address field: D5 AA 96, the volume, the track, the sector and their checksum, each byte
//   as two nibbles (4-and-4), then DE AA EB;
//   a data field: D5 AA AD, the 256 bytes as 342 six-bit values and a checksum, each a nibble by
//   the 6-and-2 table, then DE AA EB;
// with self-sync bytes (FF) between. A sector's place on the track is its physical number; the
// image keeps them in DOS 3.3's logical order, so physical sector p holds logical sector
// SKEW.indexOf(p); or, a .po, in ProDOS's, each block two sectors, PRODOS.indexOf(p).
//
// The card's switches are its sixteen addresses at $C080 + 16 times the slot: the four magnets of
// the head's stepper, off and on; the motor, which the card's timer keeps turning for a second
// after it is switched off (DOS finds the disk still spinning, and skips waiting for it to come
// up to speed); drive 1 or 2; and Q6 and Q7, which set the data latch to read, to sense
// write-protect, or to write. The disk turns under the head at a nibble every 32 of the
// processor's cycles, so the head's place on the track is the clock's, and the boot ROM's and
// DOS's timed loops find the bytes where they expect them. A nibble read once shows its high bit;
// read again before the next arrives, it does not, as the latch would still be shifting in the
// next. Writing puts each byte written in write mode at the head and moves on a nibble.
//
// The card says when a disk has been written, for what is kept of it to be read off it (saves.js): when the
// motor is switched off after a write, as DOS 3.3 and ProDOS switch it off at the end of every call, each of
// `onWritten(n => …)` is told the drive, 0 or 1, whose disk was written.

// DOS 3.3's logical sector to its physical one
export const SKEW = [0, 13, 11, 9, 7, 5, 3, 1, 14, 12, 10, 8, 6, 4, 2, 15];
// ProDOS's: a block's halves, the track's eight blocks in turn, to their physical sectors
export const PRODOS = [0, 2, 4, 6, 8, 10, 12, 14, 1, 3, 5, 7, 9, 11, 13, 15];
const WRITE = [
  0x96, 0x97, 0x9a, 0x9b, 0x9d, 0x9e, 0x9f, 0xa6, 0xa7, 0xab, 0xac, 0xad, 0xae, 0xaf, 0xb2, 0xb3,
  0xb4, 0xb5, 0xb6, 0xb7, 0xb9, 0xba, 0xbb, 0xbc, 0xbd, 0xbe, 0xbf, 0xcb, 0xcd, 0xce, 0xcf, 0xd3,
  0xd6, 0xd7, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf, 0xe5, 0xe6, 0xe7, 0xe9, 0xea, 0xeb, 0xec,
  0xed, 0xee, 0xef, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff];
const READ = new Int16Array(256).fill(-1); WRITE.forEach((n, v) => { READ[n] = v; });
export const TRACKS = 35, VOLUME = 254;
// a track's length in nibbles: a turn of the disk, 200ms, at 32 cycles a nibble
const LENGTH = 6384;
const GAP1 = 48, GAP2 = 6, GAP3 = 27;
// the cycles a nibble takes to pass under the head
export const NIBBLE = 32;
// how long the motor turns on after it is switched off, in cycles
const MOTOR_OFF = 1020484;

// a track's nibbles from its 16 sectors as the image holds them
export function track(image, t, { volume = VOLUME, order = SKEW } = {}) {
  const out = new Uint8Array(LENGTH).fill(0xff);
  let at = GAP1;
  const put = (...b) => { for (const v of b) out[at++] = v; };
  const four = v => put(v >> 1 | 0xaa, v | 0xaa);
  for (let p = 0; p < 16; p++) {
    put(0xd5, 0xaa, 0x96); four(volume); four(t); four(p); four(volume ^ t ^ p); put(0xde, 0xaa, 0xeb);
    at += GAP2;
    put(0xd5, 0xaa, 0xad);
    const at0 = (t * 16 + order.indexOf(p)) * 256;
    let last = 0;
    for (const v of sixAndTwo(image.subarray(at0, at0 + 256))) { put(WRITE[v ^ last]); last = v; }
    put(WRITE[last], 0xde, 0xaa, 0xeb);
    at += GAP3;
  }
  return out;
}

// 256 bytes as the 342 six-bit values written: first 86 of the bytes' low two bits, three
// bytes to each (byte i in value i mod 86, its two bits swapped and shifted 2 for each 86), then
// the bytes' high six bits
function sixAndTwo(data) {
  const out = new Uint8Array(342);
  for (let i = 0; i < 256; i++) {
    const b = data[i], k = Math.floor(i / 86);
    out[i % 86] |= ((b & 1) << 1 | (b & 2) >> 1) << (k * 2);
    out[86 + i] = b >> 2;
  }
  return out;
}

// the sectors back from a track, by finding each field as DOS does: a sector's 256 bytes by its
// logical number, or null where a field is missing or its checksum is wrong
export function sectors(nibbles, order = SKEW) {
  const found = new Array(16).fill(null), n = nibbles.length, at = i => nibbles[i % n];
  const from = (i, k) => (at(i + 2 * k) << 1 | 1) & at(i + 2 * k + 1);
  for (let i = 0; i < n; i++) {
    if (at(i) !== 0xd5 || at(i + 1) !== 0xaa || at(i + 2) !== 0x96) continue;
    const p = from(i + 3, 2);
    if ((from(i + 3, 0) ^ from(i + 3, 1) ^ p) !== from(i + 3, 3)) continue;
    let j = i + 14;
    while (j < i + 14 + 40 && !(at(j) === 0xd5 && at(j + 1) === 0xaa && at(j + 2) === 0xad)) j++;
    if (j === i + 14 + 40) continue;
    const v = new Uint8Array(342); let last = 0, ok = true;
    for (let k = 0; k < 343; k++) {
      const r = READ[at(j + 3 + k)];
      if (r < 0) { ok = false; break; }
      last ^= r; if (k < 342) v[k] = last;
    }
    if (!ok || last !== 0) continue;
    const data = new Uint8Array(256);
    for (let b = 0; b < 256; b++) { const two = v[b % 86] >> (Math.floor(b / 86) * 2) & 3; data[b] = v[86 + b] << 2 | (two & 1) << 1 | two >> 1; }
    found[order.indexOf(p)] = data;
  }
  return found;
}

// a 140K image from the drive's tracks, where they hold every sector
export function image(tracks, order = SKEW) {
  const out = new Uint8Array(TRACKS * 16 * 256);
  tracks.forEach((nibbles, t) => sectors(nibbles, order).forEach((s, l) => { if (!s) throw new Error(`track ${t} sector ${l} unreadable`); out.set(s, (t * 16 + l) * 256); }));
  return out;
}

// a drive: its disk as tracks, and where its head is, in half tracks
class Drive {
  constructor() { this.tracks = null; this.half = 0; this.protect = false; this.out = false; this.written = false; }
  insert(image, { protect = false, order } = {}) { this.tracks = image ? Array.from({ length: TRACKS }, (_, t) => track(image, t, { order })) : null; this.protect = protect; }
  // the track under the head: none while the disk is out of the drive (`out`), kept as written
  get track() { return this.out ? null : this.tracks?.[this.half >> 1]; }
}

// the card: `clock` gives the processor's cycles
export class Disk2 {
  constructor(rom, clock) {
    this.rom = rom; this.clock = clock;
    this.drives = [new Drive(), new Drive()];
    this.drive = 0; this.motor = 0; this.stops = 0; this.q6 = 0; this.q7 = 0;
    this.seen = -1;    // the nibble last read with its high bit
    this.head = -1;    // in write mode, where the next byte written goes
  }
  insert(n, image, opts) { this.drives[n].insert(image, opts); }
  onWritten(f) { (this.listeners ??= []).push(f); }

  io(n, v) {
    const d = this.drives[this.drive];
    if (n < 8) {
      // a magnet on pulls the head toward it: the head over half track h sits by magnet h mod 4,
      // so the next magnet round moves it a half track in, the one before a half track out
      if (n & 1) { const step = ((n >> 1) - d.half % 4 + 4) % 4; d.half = Math.max(0, Math.min(TRACKS * 2 - 2, d.half + (step === 1) - (step === 3))); }
    } else switch (n) {
      case 8:
        if (this.motor) { this.motor = 0; this.stops = this.clock() + MOTOR_OFF; }
        this.drives.forEach((x, k) => { if (x.written) { x.written = false; for (const f of this.listeners ?? []) f(k); } });
        break;
      case 9: this.motor = 1; break;
      case 10: this.drive = 0; break;
      case 11: this.drive = 1; break;
      case 12: this.q6 = 0; break;
      case 13: this.q6 = 1; break;
      case 14: this.q7 = 0; this.head = -1; break;
      case 15: this.q7 = 1; break;
    }
    if (this.q7) {
      // writing: a byte stored while Q6 is set goes on the track at the head
      if (v !== undefined && this.q6 && d.track && !d.protect) {
        const t = d.track;
        if (this.head < 0) this.head = Math.floor(this.clock() / NIBBLE) % t.length;
        t[this.head] = v; this.head = (this.head + 1) % t.length; d.written = true;
      }
      return 0;
    }
    if (v !== undefined || n & 1) return 0;
    if (this.q6) return d.protect ? 0x80 : 0;   // sensing write-protect
    const t = d.track;
    if (!t || !this.motor && this.clock() >= this.stops) return 0;
    const at = Math.floor(this.clock() / NIBBLE);
    if (at === this.seen) return t[at % t.length] & 0x7f;
    this.seen = at; return t[at % t.length];
  }
}

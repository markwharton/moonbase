// ProDOS's machine language interface, answered in JavaScript from a game's files: the calls a
// game makes through $BF00, a command byte and the address of its parameters, on whatever
// memory `mem` reads and writes. The machine (machine.js) answers its JSR $BF00 with it.
// A block of 512 bytes from a 5¼-inch disk under ProDOS, in the Apple's cycles: about 50
// milliseconds, some ten kilobytes a second. Detect-A-Pet shows its title while its libraries
// load, and the copyright screen is read over it: read at once, the title is never seen.
export const BLOCK = 51024;
// the Apple's clock, cycles a second
export const CLOCK = 1020484;
// each call's count of parameters, which ProDOS checks first, the byte its parameters start with:
// another is a bad count ($04)
const COUNTS = { 0x40: 2, 0x41: 1, 0x65: 4, 0x80: 3, 0x81: 3, 0x82: 0, 0xc0: 7, 0xc1: 1, 0xc2: 2, 0xc3: 7, 0xc4: 10, 0xc5: 2, 0xc6: 1, 0xc7: 1, 0xc8: 3, 0xc9: 3, 0xca: 4, 0xcb: 4, 0xcc: 1, 0xcd: 1, 0xce: 2, 0xcf: 2, 0xd0: 2, 0xd1: 2, 0xd2: 2, 0xd3: 2 };
// the calls that name an open file by its reference, which ProDOS checks next: one not open is
// an invalid reference ($43); CLOSE and FLUSH take 0 for every file
const REFS = new Set([0xc9, 0xca, 0xcb, 0xcc, 0xcd, 0xce, 0xcf, 0xd0, 0xd1, 0xd2, 0xd3]);
const TYPES = { TXT: 0x04, BIN: 0x06, DIR: 0x0f, BAS: 0xfc, SYS: 0xff, FND: 0xc9, ICN: 0xca };
// a file's type byte: by its name from a disk, or the byte a CREATE gave
const typeOf = f => typeof f.type === 'number' ? f.type : TYPES[f.type] || 0;

export class Files {
  constructor(game, log = () => {}) {
    this.game = game; this.log = log;
    // every file of every volume, by its full path
    this.files = new Map();
    for (const [volume, files] of Object.entries(game.volumes)) for (const [path, f] of Object.entries(files)) this.files.set('/' + volume + '/' + path, { ...f, volume, path, body: Uint8Array.from(atob(f.data), c => c.charCodeAt(0)) });
    this.volumes = Object.keys(game.volumes);
    this.open = new Map(); this.prefix = '/' + this.volumes[0] + '/';
    // a volume's state, as a player might bring a data disk: 'protected', its write-protect tab
    // on, 'full', no block free, or 'one-free', a block free and no more (the game's `disks`, by volume)
    this.disks = game.disks ?? {};
  }

  // a disk taken out of its drive, or put back: while it is out, a call that names a path on it
  // finds no such volume ($45), as ProDOS finds no volume of that name in any drive, and a read
  // or a write of a file open on it fails as the drive does ($27, an I/O error)
  drive(volume, inDrive) { this.out ??= new Set(); if (inDrive) this.out.delete(volume.toUpperCase()); else this.out.add(volume.toUpperCase()); }

  // the state of the volume a path is on
  stateOf(path) { const full = path.startsWith('/') ? path : this.prefix + path; return this.disks[full.split('/')[1].toUpperCase()]; }

  // a file by its name: a full path from a volume, or one under the prefix; a DOS 3.3 name as it is
  file(name) {
    name = name.toUpperCase().replace(/\/+$/, '');
    if (this.game.kind === 'dos33') return this.files.get('/DISK/' + name);
    const full = name.startsWith('/') ? name : this.prefix.toUpperCase() + name;
    return this.files.get(full) || [...this.files.values()].find(f => f.volume === this.volumes[0] && f.path.toUpperCase() === name);
  }

  // A directory by its name, a volume's or one in it, as ProDOS lays it out for a READ: blocks of
  // 512 bytes, each two pointers and thirteen entries of $27 bytes, the first entry the header
  // (its storage type $F for a volume, $E for a directory, its name and the count of files),
  // then an entry for each file (its storage type by its size, name, type, blocks, length and
  // aux type) or directory in it
  directory(name) {
    const full = (name.startsWith('/') ? name : this.prefix + name).toUpperCase().replace(/\/+$/, ''), parts = full.split('/').slice(1);
    if (!this.volumes.some(v => v.toUpperCase() === parts[0])) return null;
    const under = full + '/', entries = new Map();
    for (const [path, f] of this.files) if (path.toUpperCase().startsWith(under)) { const rest = path.slice(under.length).split('/'); if (!entries.has(rest[0].toUpperCase())) entries.set(rest[0].toUpperCase(), rest.length > 1 ? null : f); }
    if (parts.length > 1 && !entries.size) return null;
    // (a volume's directory is the four blocks a volume is formatted with, 2 to 5, or more)
    const list = [...entries], blocks = Math.max(parts.length > 1 ? 1 : 4, Math.ceil((list.length + 1) / 13)), body = new Uint8Array(blocks * 512);
    const entry = (k, storage, label, fill) => {
      const at = (k / 13 | 0) * 512 + 4 + (k % 13) * 0x27;
      body[at] = storage << 4 | label.length; for (let i = 0; i < label.length; i++) body[at + 1 + i] = label.charCodeAt(i);
      fill((o, v) => { body[at + o] = v & 0xff; });
    };
    for (let b = 0; b < blocks; b++) { body[b * 512] = b ? b + 1 : 0; body[b * 512 + 2] = b < blocks - 1 ? b + 3 : 0; }
    entry(0, parts.length > 1 ? 0xe : 0xf, parts.at(-1), put => { put(0x1e, 0xe3); put(0x1f, 0x27); put(0x20, 0x0d); put(0x21, list.length); put(0x22, list.length >> 8); });
    list.forEach(([label, f], k) => entry(k + 1, f ? (f.body.length <= 512 ? 1 : f.body.length <= 0x20000 ? 2 : 3) : 0xd, label, put => {
      const n = f ? f.body.length : 512, used = Math.max(1, Math.ceil(n / 512));
      put(0x10, f ? typeOf(f) : 0x0f); put(0x13, used); put(0x14, used >> 8); put(0x15, n); put(0x16, n >> 8); put(0x17, n >> 16);
      put(0x1e, 0xe3); put(0x1f, f ? f.aux : 0); put(0x20, f ? f.aux >> 8 : 0); put(0x25, 2);
    }));
    return { volume: parts[0], path: parts.slice(1).join('/'), type: 'DIR', aux: 0, body };
  }

  // A call: its command and parameters at `params` in `mem` ({ read, write }); gives the error,
  // 0 for none. A READ's bytes are put in memory by `arrive`, which `deliver(n, arrive)` may
  // hold back, as the machine does to give the read a disk's time.
  call(cmd, params, mem, { deliver = (n, arrive) => arrive() } = {}) {
    const read16 = a => mem.read(a) | mem.read(a + 1) << 8;
    const pstring = a => { const n = mem.read(a); let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(mem.read(a + 1 + i) & 0x7f); return s; };
    const p = k => mem.read(params + k), p16 = k => read16(params + k), set = (k, v) => mem.write(params + k, v & 0xff);
    if (COUNTS[cmd] !== undefined && p(0) !== COUNTS[cmd]) return 0x04;
    if (REFS.has(cmd) && !this.open.has(p(1)) && !(p(1) === 0 && (cmd === 0xcc || cmd === 0xcd))) return 0x43;
    // a write to a write-protected disk ($2B), or one that needs a block a full disk has not ($48)
    const ref = this.open.get(p(1)), named = [0xc0, 0xc1, 0xc3].includes(cmd) ? this.stateOf(pstring(p16(1)).toUpperCase()) : null;
    const state = named ?? ([0xcb, 0xd0].includes(cmd) && ref ? this.disks[ref.f.volume.toUpperCase()] : null);
    if (this.out?.size) {
      const volumeOf = path => (path.startsWith('/') ? path : this.prefix + path).split('/')[1].toUpperCase();
      if ([0xc0, 0xc1, 0xc3, 0xc4, 0xc6, 0xc8].includes(cmd) && this.out.has(volumeOf(pstring(p16(1)).toUpperCase()))) return 0x45;
      if ([0xca, 0xcb].includes(cmd) && ref && this.out.has(ref.f.volume.toUpperCase())) return 0x27;
    }
    if (state === 'protected') return 0x2b;
    // (a file has the blocks its length takes, and one at least: the key block CREATE gives it,
    // which a disk with one block free, 'one-free', has room for and a full one has not)
    if ((state === 'full' || state === 'one-free') && cmd === 0xcb && ref.at + p16(4) > Math.max(1, Math.ceil(ref.f.body.length / 512)) * 512) return 0x48;
    if (state === 'full' && cmd === 0xc0) return 0x48;
    switch (cmd) {
      case 0xc8: { // OPEN: pathname, io buffer, ref; a directory is read as its entries
        const name = pstring(p16(1)); const f = this.file(name) || this.directory(name);
        if (!f) return 0x46;
        // the lowest reference number free, 1 to 8, as ProDOS gives them: a game may count on it
        let ref = 1; while (this.open.has(ref)) ref++;
        if (ref > 8) return 0x42;
        this.open.set(ref, { f, at: 0 }); set(5, ref); this.log('open', name, '#' + ref); return 0;
      }
      case 0xca: { // READ: ref, buffer, request, transferred
        const o = this.open.get(p(1)); if (!o) return 0x43;
        const buf = p16(2), want = p16(4); const n = Math.max(0, Math.min(want, o.f.body.length - o.at)), from = o.at;
        deliver(n, () => { for (let i = 0; i < n; i++) mem.write(buf + i, o.f.body[from + i]); });
        if (n === 0 && want) { set(6, 0); set(7, 0); return 0x4c; }
        // (and in zero page, at $4E and $4F, ProDOS 1.8's and 1.9's pointer to the end of what it
        // moved, as READ leaves it: Detect-A-Pet reseeds its random routine from there)
        o.at += n; set(6, n); set(7, n >> 8); mem.write(0x4e, (buf + n) & 0xff); mem.write(0x4f, (buf + n) >> 8 & 0xff); return 0;
      }
      case 0xcb: { // WRITE
        const o = this.open.get(p(1)); if (!o) return 0x43;
        const buf = p16(2), n = p16(4);
        if (o.at + n > o.f.body.length) { const b = new Uint8Array(o.at + n); b.set(o.f.body); o.f.body = b; }
        for (let i = 0; i < n; i++) o.f.body[o.at + i] = mem.read(buf + i);
        o.at += n; set(6, n); set(7, n >> 8); return 0;
      }
      case 0xcc: { const ref = p(1); if (ref) this.open.delete(ref); else this.open.clear(); return 0; }   // CLOSE
      case 0xce: { const o = this.open.get(p(1)); if (o) o.at = p(2) | p(3) << 8 | p(4) << 16; return 0; }   // SET_MARK
      case 0xcf: { const o = this.open.get(p(1)); if (o) { set(2, o.at); set(3, o.at >> 8); set(4, o.at >> 16); } return 0; }
      case 0xd0: { const o = this.open.get(p(1)); if (o) o.f.body = o.f.body.slice(0, p(2) | p(3) << 8 | p(4) << 16); return 0; }   // SET_EOF
      case 0xd1: { const o = this.open.get(p(1)); if (!o) return 0x43; const n = o.f.body.length; set(2, n); set(3, n >> 8); set(4, n >> 16); return 0; }
      case 0xc4: { // GET_FILE_INFO
        const name = pstring(p16(1)); const f = this.file(name);
        if (!f) return 0x46;
        set(3, 0xc3); set(4, typeOf(f)); set(5, f.aux); set(6, f.aux >> 8); set(7, 1); set(8, (f.body.length + 511) >> 9); set(9, ((f.body.length + 511) >> 9) >> 8);
        for (let k = 10; k < 18; k++) set(k, 0); return 0;
      }
      case 0xc3: return 0;   // SET_FILE_INFO
      // CREATE: pathname, access, file type, aux type; a name already there is the duplicate
      // filename error, $47, as ProDOS gives it
      case 0xc0: { const name = pstring(p16(1)).toUpperCase(); const full = name.startsWith('/') ? name : this.prefix.toUpperCase() + name; if (this.file(name)) return 0x47; this.files.set(full, { volume: full.split('/')[1], path: full.split('/').slice(2).join('/'), type: p(4), aux: p16(5), body: new Uint8Array(0) }); this.log('create', name); return 0; }
      case 0xc1: { const name = pstring(p16(1)); const f = this.file(name); if (!f) return 0x46; this.files.delete([...this.files.entries()].find(([, v]) => v === f)[0]); this.log('destroy', name); return 0; }
      // SET_PREFIX: a full path, or one under the prefix; ProDOS keeps it ending in a slash
      case 0xc6: { const name = pstring(p16(1)).replace(/\/*$/, '/'); this.prefix = name.startsWith('/') ? name : this.prefix + name; return 0; }
      case 0xc7: { const s = this.prefix; mem.write(p16(1), s.length); for (let i = 0; i < s.length; i++) mem.write(p16(1) + 1 + i, s.charCodeAt(i)); return 0; }
      case 0xc5: { // ON_LINE: the volumes, the first in slot 6 drive 1 and the second in drive 2
        // (a disk out of its drive is not on line: its drive's entry is left out)
        const unit = p(1), buf = p16(2), names = (unit ? [this.volumes[unit & 0x80 ? 1 : 0] || this.volumes[0]] : this.volumes).filter(v => !this.out?.has(v.toUpperCase()));
        if (unit && !names.length) return 0x27;
        names.forEach((name, i) => { const at = buf + i * 16; mem.write(at, ((unit || (i ? 0xe0 : 0x60)) & 0xf0) | name.length); for (let k = 0; k < name.length; k++) mem.write(at + 1 + k, name.charCodeAt(k)); });
        if (!unit) mem.write(buf + names.length * 16, 0);
        return 0;
      }
      case 0x65: return 'quit';
      case 0x82: return 0;   // GET_TIME
      default: return null;  // not handled
    }
  }
}

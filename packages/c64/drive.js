// A Commodore 1541 as far as the games use it: the disk image itself, read a sector at a time;
// the directory, searched with the drive's own wildcards; the command channel, with the memory
// commands M-W, M-R and M-E, the block read U1 and the buffer pointer B-P; LOAD"$", the
// directory as a BASIC program; files opened by name
// and read a byte at a time; and the drive's memory, since Zoopak reads the directory through it
// and then pokes a picture's track and sector into the two places the drive keeps its last
// file's, so that LOAD"*", which on a 1541 loads the last file without a directory search,
// fetches that picture. The KERNAL's bus routines, LISTEN, SECOND, CIOUT, UNLSN, TALK, TKSA,
// ACPTR and UNTLK, are answered here by the machine's hooks, so the KERNAL's own OPEN, CHRIN
// and CLOSE work on device 8 without the serial bus being modelled.

import { add } from './d64.js';

const SECTORS = [...Array(17).fill(21), ...Array(7).fill(19), ...Array(6).fill(18), ...Array(5).fill(17)];
const TYPES = ['DEL', 'SEQ', 'PRG', 'USR', 'REL'];
const OK = '00, OK,00,00\r', NOT_FOUND = '62,FILE NOT FOUND,00,00\r', SYNTAX = '31,SYNTAX ERROR,00,00\r';
const bytes = s => Uint8Array.from(s, c => c.charCodeAt(0));
const upper = b => (b >= 0xc1 && b <= 0xda ? b - 0x80 : b);   // shifted letters as unshifted

export class Drive {
  constructor(image) {
    this.image = image;
    this.mem = new Uint8Array(0x800);   // the drive's RAM: $0200 the command buffer, $0300 to $07FF the four buffers
    this.saved = new Map();   // files saved this session, by name, as raw bytes; they shadow the disk
    this.keep = null;         // (name, raw): told of each file saved, to keep it (saves.js)
    this.channels = new Map();   // open channels by secondary address 0 to 15
    this.listening = false; this.talking = false; this.channel = 0; this.opening = null;
    this.status = bytes(OK); this.reply = null; this.pos = 0;
    this.channels.set(15, { command: [] });
  }

  // the disk
  sector(t, s, image = this.image) { const n = SECTORS.slice(0, t - 1).reduce((a, b) => a + b, 0) + s; return image.subarray(n * 256, (n + 1) * 256); }
  chain(t, s) {
    const parts = []; let n = 0;
    while (t && n++ < 800) { const b = this.sector(t, s); [t, s] = [b[0], b[1]]; parts.push(b.subarray(2, t ? 256 : s + 1)); }
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }
  directory() {
    const bam = this.sector(18, 0), files = [];
    for (let [t, s] = [bam[0], bam[1]], n = 0; t && n++ < 40; ) {
      const b = this.sector(t, s);
      for (let i = 0; i < 8; i++) {
        const e = b.subarray(i * 32, (i + 1) * 32);
        if (!e[2]) continue;
        files.push({ name: Array.from(e.subarray(5, 21)).filter(c => c !== 0xa0).map(upper), type: TYPES[e[2] & 7] || '?', track: e[3], sector: e[4] });
      }
      [t, s] = [b[0], b[1]];
    }
    return files;
  }
  // the files a name can find: not DEL's, which the 1541's search passes over (a directory's art,
  // drawn in DEL entries' names, so that none of them loads)
  loadable() { return this.directory().filter(f => f.type !== 'DEL'); }
  // a name as the drive matches it: the drive prefix dropped, '*' ending the comparison, '?' any character
  static matches(pattern, name) {
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] === 0x2a) return true;
      if (i >= name.length) return false;
      if (pattern[i] !== 0x3f && upper(pattern[i]) !== name[i]) return false;
    }
    return pattern.length === name.length;
  }
  static strip(name) { let n = Array.from(name).map(upper); if (n[0] === 0x40) n = n.slice(1); if (n[1] === 0x3a) n = n.slice(2); return n; }
  find(name) {
    name = Drive.strip(name);
    for (const [k, raw] of this.saved) if (Drive.matches(name, Array.from(bytes(k)))) return { raw, saved: true };
    for (const f of this.loadable()) if (Drive.matches(name, f.name)) return { ...f, raw: this.chain(f.track, f.sector) };
    return undefined;
  }
  // LOAD"$": the directory as the 1541 makes it, a BASIC program at $0401: the header line, the
  // disk's name reversed in quotes with its ID and DOS type; a line for each entry, its blocks the
  // line's number, its name in quotes as it is, its type (* if not closed, < if locked); and the
  // blocks free. BASIC's LOAD links its lines after. The files saved this session are listed as a
  // 1541 would have them, the disk read as if they were on it (d64.js `add`)
  listing() {
    const image = this.saved.size ? add(this.image, [...this.saved].map(([name, data]) => ({ name, data }))) : this.image;
    const sector = (t, s) => this.sector(t, s, image);
    const bam = sector(18, 0), out = [0x01, 0x04];
    const line = (n, text) => out.push(0x01, 0x01, n & 255, n >> 8, ...text, 0);
    line(0, [0x12, 0x22, ...bam.subarray(0x90, 0xa0), 0x22, 0x20, bam[0xa2], bam[0xa3], 0x20, bam[0xa5], bam[0xa6]]);
    for (let [t, s] = [bam[0], bam[1]], k = 0; t && k++ < 40; ) {
      const b = sector(t, s);
      for (let i = 0; i < 8; i++) {
        const e = b.subarray(i * 32, (i + 1) * 32);
        if (!e[2]) continue;
        const blocks = e[30] | e[31] << 8, raw = Array.from(e.subarray(5, 21)), end = raw.indexOf(0xa0), name = end < 0 ? raw : raw.slice(0, end);
        const pad = blocks < 10 ? 3 : blocks < 100 ? 2 : 1;
        line(blocks, [...Array(pad).fill(0x20), 0x22, ...name, 0x22, ...Array(16 - name.length).fill(0x20), e[2] & 0x80 ? 0x20 : 0x2a, ...bytes(TYPES[e[2] & 7] || '???'), e[2] & 0x40 ? 0x3c : 0x20]);
      }
      [t, s] = [b[0], b[1]];
    }
    let free = 0; for (let t = 1; t <= 35; t++) if (t !== 18) free += bam[4 * t];
    line(free, [...bytes('BLOCKS FREE.'), ...Array(13).fill(0x20)]);
    out.push(0, 0);
    return Uint8Array.from(out);
  }
  // the drive keeps its last file's track and sector at $7E and $026F, and LOAD"*" starts there
  remember(f) { if (f && f.track) { this.mem[0x7e] = f.track; this.mem[0x26e] = 0; this.mem[0x26f] = f.sector; } }
  load(name) {
    name = Drive.strip(name);
    let f;
    if (name[0] === 0x24) { this.status = bytes(OK); return this.listing(); }
    if (name.length === 1 && name[0] === 0x2a) f = this.mem[0x7e] ? { raw: this.chain(this.mem[0x7e], this.mem[0x26f]) } : { ...this.loadable()[0], raw: null };
    else f = this.find(name);
    if (f && !f.raw) f.raw = this.chain(f.track, f.sector);
    this.remember(f); this.status = bytes(f ? OK : NOT_FOUND);
    return f && f.raw;
  }
  save(name, raw) { this.store(String.fromCharCode(...Drive.strip(name)), raw); this.status = bytes(OK); }
  store(name, raw) { this.saved.set(name, raw); this.keep?.(name, raw); }

  // the bus, as the KERNAL's routines present it
  listen(device) { this.listening = device === 8; return this.listening; }
  talk(device) { this.talking = device === 8; return this.talking; }
  second(sa) {
    if (!this.listening) return;
    const ch = sa & 15, kind = sa & 0xf0;
    if (kind === 0xf0) this.opening = { ch, name: [] };
    else if (kind === 0xe0) this.close(ch);
    else this.channel = ch;
  }
  tksa(sa) { if (this.talking) { this.channel = sa & 15; this.pos = 0; } }
  ciout(b) {
    if (!this.listening) return;
    if (this.opening) { this.opening.name.push(b); return; }
    const c = this.channels.get(this.channel);
    if (!c) return;
    if (c.command) c.command.push(b);
    else if (c.write) c.write.push(b);
    else if (c.buffer) { c.buffer[c.pos] = b; c.pos = (c.pos + 1) & 0xff; }
  }
  unlsn() {
    if (this.opening) { this.open(this.opening.ch, this.opening.name); this.opening = null; }
    else if (this.channel === 15) { const c = this.channels.get(15); if (c.command.length) { this.execute(Uint8Array.from(c.command)); c.command = []; } }
    this.listening = false;
  }
  untlk() { this.talking = false; }
  // the next byte for the talker, and whether it is the last; nothing when the channel is empty
  acptr() {
    const c = this.channels.get(this.channel);
    if (this.channel === 15) {
      const data = this.reply || this.status;
      if (this.pos >= data.length) { this.reply = null; this.pos = 0; return null; }
      const byte = data[this.pos++], eoi = this.pos >= data.length;
      if (eoi) { if (this.reply) this.reply = null; else this.status = bytes(OK); this.pos = 0; }
      return { byte, eoi };
    }
    if (!c) return null;
    if (c.buffer) { const byte = c.buffer[c.pos]; c.pos = (c.pos + 1) & 0xff; return { byte, eoi: c.pos === 0 }; }
    if (!c.data || c.pos >= c.data.length) return null;
    return { byte: c.data[c.pos++], eoi: c.pos >= c.data.length };
  }

  // a file opened on a channel: '#' a buffer, else a name with its type and mode after commas
  open(ch, name) {
    if (ch === 15) { if (name.length) this.execute(Uint8Array.from(name)); return; }
    if (name[0] === 0x23) { this.channels.set(ch, { buffer: new Uint8Array(256), pos: 0 }); this.status = bytes(OK); return; }
    const parts = []; let cur = [];
    for (const b of name) { if (b === 0x2c) { parts.push(cur); cur = []; } else cur.push(b); }
    parts.push(cur);
    // ,W writes; and channel 1 always, SAVE's, as channel 0 always reads, LOAD's
    const mode = ch === 1 || ch !== 0 && parts.slice(1).some(p => p[0] === 0x57) ? 'W' : 'R';
    if (mode === 'W') { this.channels.set(ch, { write: [], name: String.fromCharCode(...Drive.strip(parts[0])) }); this.status = bytes(OK); return; }
    // (a file to read as LOAD finds it: "*" the last file, as a 1541 has it)
    const raw = this.load(parts[0]);
    this.channels.set(ch, { data: raw ?? new Uint8Array(0), pos: 0 });
  }
  close(ch) {
    const c = this.channels.get(ch);
    if (c && c.write) this.store(c.name, Uint8Array.from(c.write));
    if (ch !== 15) this.channels.delete(ch);
  }

  // a command on channel 15
  execute(cmd) {
    this.mem.set(cmd.subarray(0, 0x2a), 0x200);   // the command buffer, where M-E code runs from
    const text = String.fromCharCode(...cmd);
    this.status = bytes(OK); this.reply = null;
    if (text.startsWith('M-W')) { const at = cmd[3] | cmd[4] << 8, n = cmd[5]; for (let i = 0; i < n && 6 + i < cmd.length; i++) this.mem[(at + i) & 0x7ff] = cmd[6 + i]; return; }
    if (text.startsWith('M-R')) { const at = cmd[3] | cmd[4] << 8, n = cmd.length > 5 ? cmd[5] || 256 : 1; this.reply = this.mem.slice(at & 0x7ff, (at & 0x7ff) + n); this.pos = 0; return; }
    if (text.startsWith('M-E')) {
      // the one program the games send: LDX #track, LDY #sector, STX $06, STY $07, LDA #$80 (read),
      // STA $00, and wait, which reads a sector into the drive's buffer 0 at $0300
      const code = cmd.subarray(5);
      for (let i = 0; i + 8 <= code.length; i++)
        if (code[i] === 0xa2 && code[i + 2] === 0xa0 && code[i + 4] === 0x86 && code[i + 5] === 0x06 && code[i + 6] === 0x84 && code[i + 7] === 0x07) {
          const t = code[i + 1], s = code[i + 3];
          if (t >= 1 && t <= 35 && s < SECTORS[t - 1]) this.mem.set(this.sector(t, s), 0x300);
          return;
        }
      return;
    }
    const m = /^(U1|UA|B-R|B-P)[: ]?\s*(.*)$/.exec(text.replace(/\r$/, ''));
    if (m) {
      const n = m[2].split(/[\s,]+/).filter(Boolean).map(Number), c = this.channels.get(n[0]);
      if (!c || !c.buffer) { this.status = bytes('70,NO CHANNEL,00,00\r'); return; }
      if (m[1] === 'B-P') { c.pos = n[1] & 0xff; return; }
      const [, , t, s] = n;
      if (t >= 1 && t <= 35 && s < SECTORS[t - 1]) { c.buffer.set(this.sector(t, s)); c.pos = 0; }
      else this.status = bytes('66,ILLEGAL TRACK OR SECTOR,' + String(t).padStart(2, '0') + ',' + String(s).padStart(2, '0') + '\r');
      return;
    }
    if (/^I/.test(text)) return;
    this.status = bytes(SYNTAX);
  }
}

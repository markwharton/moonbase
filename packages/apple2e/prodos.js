// What ProDOS 8 leaves in memory when it starts a game's system file, as far as the games read
// it, and the units it finds the disks in: its global page's fields (the ProDOS 8 Technical
// Reference Manual's chapter on the global page), and what the IIe's ROM and ProDOS leave below
// it, each as ProDOS 1.9, the version on the titles' disks, leaves it when it runs on Apple's ROMs.
// The machine without Apple's ROMs starts with it (machine.js). None of it is ProDOS's code.

import { PRODOS } from './disk2.js';

// ProDOS 1.9's driver for a unit with no device, its Disk II driver and its /RAM's
const NO_DEVICE = 0xdeac, DISK2 = 0xd000, RAM = 0xff00;
// the block card's driver (blocks.js), in slot 7
const BLOCKS = 0xc730;
// /RAM, the IIe's auxiliary 64K as a disk, as slot 3 drive 2
const RAM_UNIT = 0xbf;

// The units the game's volumes are in, as the Apple with its ROMs has them: a 140K disk in the
// Disk II in slot 6, the first in drive 1 and the second in drive 2, and a third, a data disk, in
// a second Disk II's drive 1 in slot 5, as a school's Apple might have had; a larger one (a 2mg)
// in the block card in slot 7, drive 1. A unit is ProDOS's number for it, the drive (bit 7) and
// the slot (bits 6 to 4), and in ProDOS's list of devices a low nibble too, 1 for a block card's.
// Each with its disk's image, by name, or none for a data disk, which is blank; and its state, as
// the game gives it (`disks`).
const FLOPPIES = [0x60, 0xe0, 0x50, 0xd0];
export function units(game) {
  const out = [];
  let floppy = 0;
  Object.keys(game.volumes).forEach((volume, n) => {
    const image = game.images?.[n], state = game.disks?.[volume];
    if (image?.endsWith('.2mg')) out.push({ volume, image, state, unit: 0x70, id: 1, driver: BLOCKS });
    else out.push({ volume, image, state, unit: FLOPPIES[floppy++], id: 0, driver: DISK2 });
  });
  return out;
}

// the disks for the Apple with its ROMs, as the machine takes them (machine.js `disks`): each
// volume's in its unit, the title's own image (from `images`, a Map of its name to its bytes) or a
// blank one, in its state ('protected' its write-protect tab on; 'full' and 'one-free' as
// `blank` formats them)
export function placed(game, images) {
  return units(game).map(u => ({ ...u, protect: u.state === 'protected', ...u.image ? { image: images.get(u.image) } : { image: blank(u.volume, u.state), order: PRODOS } }));
}

// A blank ProDOS volume of 140K, in ProDOS's order of blocks, as ProDOS's FILER formats one: the
// boot blocks, four of the volume directory from block 2, the bitmap in block 6, no file; with
// `state` 'full' no block free, 'one-free' the last block free and no other
export function blank(volume, state) {
  const disk = new Uint8Array(280 * 512), word = (a, v) => { disk[a] = v & 0xff; disk[a + 1] = v >> 8; };
  for (let b = 2; b <= 5; b++) { word(b * 512, b > 2 ? b - 1 : 0); word(b * 512 + 2, b < 5 ? b + 1 : 0); }
  const h = 2 * 512 + 4;
  disk[h] = 0xf0 | volume.length; for (let i = 0; i < volume.length; i++) disk[h + 1 + i] = volume.charCodeAt(i);
  disk[h + 30] = 0xc3; disk[h + 31] = 0x27; disk[h + 32] = 0x0d;   // access, entry length, entries a block
  word(h + 35, 6); word(h + 37, 280);   // the bitmap's block, the blocks
  const free = state === 'full' ? [] : state === 'one-free' ? [279] : Array.from({ length: 273 }, (_, i) => i + 7);
  for (const b of free) disk[6 * 512 + (b >> 3)] |= 0x80 >> (b & 7);
  return disk;
}

// the bytes, by address, that ProDOS 1.9 and the IIe's ROM leave as a ProDOS game starts, in
// main memory, and (`aux`) in auxiliary memory
export function started(game, { aux = false } = {}) {
  if (aux) {
    // a byte of ProDOS's /RAM driver, which it copies to auxiliary memory's pages 2 and 3, as
    // Animal Rescue reads it for its sound's level, PART0 running there: LDA $C08B's $8B, so on
    return { 0x3df: 0x8b };
  }
  const mem = {}, word = (a, v) => { mem[a] = v & 0xff; mem[a + 1] = v >> 8; };
  const found = units(game);
  // the slots' cards: each slot's drives, both of a Disk II's and a block card's; the Disk II in
  // slot 6 is there with no disk in it too
  const cards = new Map([[6, { id: 0, driver: DISK2 }]]);
  for (const u of found) cards.set(u.unit >> 4 & 7, u);
  // DEVADR, $BF10: a driver for each unit, drive 1's eight slots then drive 2's
  for (let d = 0; d < 2; d++) for (let s = 0; s < 8; s++) word(0xbf10 + d * 16 + s * 2, cards.get(s)?.driver ?? (d && s === 3 ? RAM : NO_DEVICE));
  // DEVNUM, the unit last used: the one booted from; DEVCNT, the devices less one; DEVLST, the
  // devices by slot, drive 2 before drive 1, and /RAM last; its last two bytes are left as
  // ProDOS's loader leaves them, the Disk II's two units, from its ordering of the list
  mem[0xbf30] = found[0].unit;
  const list = [...cards.entries()].sort(([a], [b]) => a - b).flatMap(([s, u]) => [0x80 | s << 4 | u.id, s << 4 | u.id]).concat(RAM_UNIT);
  mem[0xbf31] = list.length - 1;
  for (let i = 0; i < 14; i++) mem[0xbf32 + i] = list[i] ?? 0;
  mem[0xbf3e] = 0xe0; mem[0xbf3f] = 0x60;
  // the end of what ProDOS's READ last moved, at $4E and $4F (mli.js): the system
  // file, read to $2000
  const system = Object.values(game.volumes).map(v => v[game.system]).find(Boolean);
  if (system) word(0x4e, 0x2000 + system.size);
  // the text page as the boot leaves it, its 24 rows cleared to spaces (the game, which never
  // clears it, shows it under its menus)
  for (let r = 0; r < 24; r++) for (let x = 0; x < 40; x++) mem[0x400 + (r & 7) * 0x80 + (r >> 3) * 40 + x] = 0xa0;
  // MACHID: a IIe with 128K and an 80-column card, and no clock
  mem[0xbf98] = 0xb2;
  // the ROM's output and input hooks, CSW and KSW: COUT1 and KEYIN
  word(0x36, 0xfdf0); word(0x38, 0xfd1b);
  // a byte of the routine ProDOS's /RAM keeps in page 3 ($03D6 to $03EF), which Animal Rescue
  // reads for its sound's level from main memory: on, with ProDOS 1.9
  mem[0x3df] = 0x42;
  return mem;
}

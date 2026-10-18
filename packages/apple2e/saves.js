// The games a title saves, kept on the player's disk (`disk`, opened before the machine starts:
// { list(), read(name), write(name, bytes, meta), remove(name) }), each by its name, with its type and aux beside it,
// so a game saved is there the next time, on either line. Each title's saves are on a volume of its own (SAVES):
// Detect-A-Pet's a ProDOS data disk in a drive beside the game's, SAVES; Pieces of Eight's its own DOS 3.3 disk,
// DISK, as DOS 3.3 has one.
//
// On moonbase's ROM (line 2) the volume's files are the machine's Files (mli.js), its saves made by its ProDOS
// calls or DOS 3.3's BSAVE (rom.js). On Apple's ROMs (line 1) the volume is a disk in a Disk II drive (disk2.js),
// which the title's own DOS 3.3 or ProDOS writes: the kept saves are written onto its image before it boots
// (onDisks), and its files read off its tracks each time the card says it was written (driveFiles).
//
//   const game = withSaves(slug, game, disk)    before the machine starts: the kept files on the volume
//   const disks = onDisks(slug, disks, disk)   line 1: the kept files on the volume's disk image (prodos.js placed)
//   keepSaves(slug, files, disk)                each change kept: `files` the machine's Files (line 2), or
//                                               driveFiles(m, disks, slug) (line 1), none for a title that
//                                               does not save
import { dos33, save as saveDos33 } from './dos33-disk.js';
import { prodos, save as saveProdos } from './prodos-disk.js';
import { image } from './disk2.js';

export const SAVES = { 'detect-a-pet': { volume: 'SAVES', dos: 'prodos' }, 'pieces-of-eight': { volume: 'DISK', dos: 'dos33' } };

const b64 = b => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

// the game's disks with the kept files on the saves' volume, beside any the game's own disk has there
export function withSaves(slug, game, disk) {
  const name = SAVES[slug]?.volume;
  if (!name) return game;
  const kept = Object.fromEntries(disk.list().map(f => [f.name, { type: f.meta.type, aux: f.meta.aux, data: b64(disk.read(f.name)) }]));
  return { ...game, volumes: { ...game.volumes, [name]: { ...game.volumes[name], ...kept } } };
}

// line 1's disks (prodos.js placed, of withSaves's game) with the kept files written onto the saves' volume's
// image, a copy of it: as DOS 3.3's BSAVE writes a binary file, or ProDOS a file on a blank volume (in block order)
export function onDisks(slug, disks, disk) {
  const saves = SAVES[slug];
  if (!saves) return disks;
  return disks.map(d => {
    if (d.volume.toUpperCase() !== saves.volume) return d;
    const copy = Uint8Array.from(d.image);
    for (const f of disk.list()) {
      const body = disk.read(f.name);
      if (saves.dos === 'dos33') saveDos33(copy, { name: f.name, address: f.meta.aux, body });
      else saveProdos(copy, { name: f.name, type: f.meta.type, aux: f.meta.aux, body });
    }
    return { ...d, image: copy };
  });
}

// line 1's saves' volume as keepSaves reads it: its files off the drive's tracks, as the title's DOS wrote them,
// and a change each time the card says the drive's disk was written. (A track the card's head left half written,
// a sector unreadable, is read again at the next write.)
export function driveFiles(m, disks, slug) {
  const saves = SAVES[slug], d = saves && disks.find(x => x.volume.toUpperCase() === saves.volume);
  if (!d) return null;
  const card = m.slots[d.unit >> 4 & 7], n = d.unit >> 7, listeners = [];
  let last = [];
  const read = () => {
    try {
      const bytes = image(card.drives[n].tracks);   // (DOS order, as a .dsk is: the ProDOS reader takes it so too)
      last = saves.dos === 'dos33'
        ? dos33(bytes).files.map(f => ({ path: f.name, type: f.type, aux: f.address ?? 0, body: f.body }))
        : prodos(bytes).files.filter(f => f.storage !== 0xd).map(f => ({ path: f.path, type: f.type, aux: f.aux, body: f.body }));
    } catch { /* the last reading stands */ }
    return last;
  };
  read();
  card.onWritten(k => { if (k === n) { read(); for (const f of listeners) f(); } });
  return { of: () => last, onChange: f => listeners.push(f) };
}

// at each change to a file, each file of the saves' volume that is the game's (not as its own disk has it) written
// to the player's disk if it is not as kept there, and each kept file no longer there removed. `files` gives the
// volume's files, of(volume) [{ path, type, aux, body }], and onChange(f): the machine's Files, or driveFiles.
const same = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
export function keepSaves(slug, files, disk) {
  const name = SAVES[slug]?.volume;
  if (!name || !files || files.kept) return;
  files.kept = true;
  const kept = new Map(disk.list().map(f => [f.name, f.meta]));
  const ours = () => files.of(name);
  // (the files of its own disk on the volume, as they came: not saves until changed)
  const own = new Map(ours().filter(f => !kept.has(f.path)).map(f => [f.path, f.body.slice()]));
  files.onChange(() => {
    const now = ours();
    for (const f of now) {
      if (same(own.get(f.path), f.body)) continue;
      const meta = { type: f.type, aux: f.aux }, was = kept.get(f.path);
      if (was && was.type === meta.type && was.aux === meta.aux && same(disk.read(f.path), f.body)) continue;
      disk.write(f.path, f.body, meta); kept.set(f.path, meta);
    }
    for (const path of [...kept.keys()]) if (!now.some(f => f.path === path)) { disk.remove(path); kept.delete(path); }
  });
}

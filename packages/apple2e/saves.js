// The games a title saves, kept on the player's disk (`disk`, opened before the machine starts:
// { list(), read(name), write(name, bytes, meta), remove(name) }), each by its name, with its type and aux beside it,
// so a game saved is there the next time. Each title's saves are on a volume of its own (SAVES): Detect-A-Pet's
// a ProDOS data disk in a drive beside the game's, SAVES; Pieces of Eight's its own DOS 3.3 disk, DISK, as DOS
// 3.3 has one (its BSAVE and BLOAD, rom.js).
//
//   const game = withSaves(slug, game, disk)   before the machine starts: the kept files on the volume
//   keepSaves(slug, files, disk)               the machine's Files (mli.js): each change kept
export const SAVES = { 'detect-a-pet': 'SAVES', 'pieces-of-eight': 'DISK' };

const b64 = b => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

// the game's disks with the kept files on the saves' volume, beside any the game's own disk has there
export function withSaves(slug, game, disk) {
  const name = SAVES[slug];
  if (!name) return game;
  const kept = Object.fromEntries(disk.list().map(f => [f.name, { type: f.meta.type, aux: f.meta.aux, data: b64(disk.read(f.name)) }]));
  return { ...game, volumes: { ...game.volumes, [name]: { ...game.volumes[name], ...kept } } };
}

// at each change to a file (Files' onChange), each file of the saves' volume that is the game's (not as its own
// disk has it) written to the player's disk if it is not as kept there, and each kept file no longer there removed
const same = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
export function keepSaves(slug, files, disk) {
  const name = SAVES[slug];
  if (!name || files.kept) return;
  files.kept = true;
  const kept = new Map(disk.list().map(f => [f.name, f.meta]));
  const ours = () => [...files.files.values()].filter(f => f.volume.toUpperCase() === name);
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

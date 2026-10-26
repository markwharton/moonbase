// A game's data as the player wants it, in Node: every file of each volume, base64, with its type and load address;
// a ProDOS game names its system file, a DOS 3.3 game the files to load and where and the address to call, as its
// BASIC program does, a C64 game the name to LOAD; where it saves, `saves`. An Apple game's disks are given back
// whole as well, for a machine with Apple's own ROMs, which boots them (`images`, @moonbase-machines/apple2e/disk2.js,
// blocks.js), the data naming them.
//
//   const { data, images } = gameData(slug, { title, kind, disks, system, call, loads, wait, start, saves, demonstrations })
//     kind      'prodos', 'dos33' or 'c64'
//     disks     each disk image's bytes, in order (a 140K .dsk, a .2mg; a C64's .d64)
//     saves     where the game saves, { volume, dos } (@moonbase-machines/apple2e/saves.js), if it does
//     demonstrations
//               what the game's own sheet has a person type to see it work, each a name and its steps, typed into the
//               game by the player's button of that name (play.js): [{ name, steps: [{ key: 'return' }, { key: 'f4' },
//               { type: '1 PISTONS' }, ...] }] (keys.js `typing` says what a step is); a C64 game's, whose engine types
//               them (engines/original.js); refused for another kind
//   data      the game's data, for <slug>.json
//   images    an Apple game's disks, [{ name: <slug>-<n>.dsk or .2mg, bytes }]
import { prodos } from '@moonbase-machines/apple2e/prodos-disk.js';
import { dos33 } from '@moonbase-machines/apple2e/dos33-disk.js';
import { read as d64 } from '@moonbase-machines/c64/d64.js';
import { typing } from './keys.js';

const b64 = bytes => Buffer.from(bytes).toString('base64');

export function gameData(slug, game) {
  const data = { title: game.title, kind: game.kind, volumes: {}, system: game.system, call: game.call, loads: game.loads, wait: game.wait, start: game.start, images: undefined };
  const images = game.kind === 'c64' ? [] : game.disks.map((bytes, n) => ({ name: slug + '-' + (n + 1) + (bytes.length === 143360 ? '.dsk' : '.2mg'), bytes }));
  if (images.length) data.images = images.map(i => i.name);
  for (const image of game.disks) {
    if (game.kind === 'prodos') {
      const disk = prodos(image), files = {};
      for (const f of disk.files) if (f.typeName !== 'DIR') files[f.path] = { type: f.typeName, aux: f.aux, size: f.size, data: b64(f.body) };
      data.volumes[disk.volume] = files;
    } else if (game.kind === 'c64') {
      d64(image);   // checked, and the whole image kept, since the drive in the browser reads it by the sector
      data.image = b64(image);
    } else {
      const disk = dos33(image), files = {};
      for (const f of disk.files) files[f.name] = { type: f.type, aux: f.address || 0, size: f.body.length, data: b64(f.body) };
      data.volumes['DISK'] = files;
    }
  }
  if (game.saves) data.saves = game.saves;
  if (game.demonstrations) {
    if (game.kind !== 'c64') throw new Error(`${slug}: a demonstration is typed into a C64 game only`);
    if (!Array.isArray(game.demonstrations)) throw new Error(`${slug}: demonstrations is a list`);
    data.demonstrations = game.demonstrations.map(d => {
      if (typeof d?.name !== 'string' || !d.name) throw new Error(`${slug}: a demonstration has a name`);
      typing(d.steps, game.kind);   // (checked here, once, so that the player never meets a step it cannot type)
      return { name: d.name, steps: d.steps };
    });
  }
  return { data, images };
}

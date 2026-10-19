// What a game saves, on the player's disk, the one way for every way to play (play.js gives it to the engine as
// `game.saves`): an Apple game's volume it saves on (@moonbase-machines/apple2e/saves.js, its data's `saves`), a
// Commodore 64 game's drive (@moonbase-machines/c64/saves.js). A game saved in one way loads in the other.
//
//   const saves = savesFor(data, disk)
//     saves.data              the game's data with what is kept put on its volume, for the machine or the engine
//     saves.keep(files)       the game's files watched (a machine's, an engine's, a drive's on line 1), each change kept
//     saves.drive(drive)      a Commodore 64's drive given what is kept, and what it saves kept
//     saves.disks(disks)      line 1: what is kept written onto the disk images Apple's ROMs boot
//     saves.driveFiles(m, disks)  line 1: the files as the drive's tracks hold them, for `keep`
import { withSaves, keepSaves, onDisks, driveFiles } from '@moonbase-machines/apple2e/saves.js';
import { keepDrive } from '@moonbase-machines/c64/saves.js';

export function savesFor(data, disk) {
  return {
    data: withSaves(data, disk),
    keep: files => keepSaves(data, files, disk),
    drive: drive => keepDrive(drive, disk),
    disks: disks => onDisks(data, disks, disk),
    driveFiles: (m, disks) => driveFiles(m, disks, data),
  };
}

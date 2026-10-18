// What a Commodore 64 game SAVEs to its disk, kept on the player's disk (`disk`, opened before the machine
// starts: { list(), read(name), write(name, bytes) }), each file by its name as the 1541 has it, its raw
// bytes, the load address first: put back in the drive (drive.js `saved`, which shadows the disk's own
// files) when the game starts again, and each file saved written there as it is saved.
//
//   keepDrive(drive, disk)
export function keepDrive(drive, disk) {
  for (const f of disk.list()) drive.saved.set(f.name, disk.read(f.name));
  drive.keep = (name, raw) => disk.write(name, raw);
}

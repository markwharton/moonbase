// For the tests: an empty DOS 3.3 data disk, as INIT leaves one with no DOS on it: the VTOC, every sector free but the
// catalogue's track, the catalogue's fifteen sectors chained from 17/15 down to 17/1
export function emptyDos33() {
  const disk = new Uint8Array(143360), at = (t, s) => (t * 16 + s) * 256;
  disk.set([0, 17, 15, 3, 0, 0, 254], at(17, 0));
  disk[at(17, 0) + 0x27] = 122; disk[at(17, 0) + 0x30] = 17; disk[at(17, 0) + 0x31] = 1; disk[at(17, 0) + 0x34] = 35; disk[at(17, 0) + 0x35] = 16; disk[at(17, 0) + 0x37] = 1;
  for (let t = 0; t < 35; t++) if (t !== 17) disk.set([0xff, 0xff], at(17, 0) + 0x38 + t * 4);
  for (let s = 15; s >= 1; s--) disk.set([0, 17, s - 1 || 0], at(17, s));
  disk[at(17, 1) + 1] = 0;
  return disk;
}

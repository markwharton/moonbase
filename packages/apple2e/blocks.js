// A block card: a ProDOS disk of any size in a slot, for Nature Park's 800K 3.5" disk, which a
// Disk II cannot carry. Apple's own 3.5" card (the UniDisk 3.5's) is not emulated, so this one is
// moonbase's, the way an emulator carries its hard-disk card, and it is the only part of the
// machine with Apple's ROMs that is not Apple's: it stands below ProDOS, where a drive's
// controller would, and ProDOS on the disk, which is Apple's, still boots from it and runs.
//
// Its ROM is the 256 bytes ProDOS and the IIe's ROM look for in a slot: $20, $00, $03 at $Cn01,
// $Cn03 and $Cn05, and $3C at $Cn07, so the IIe boots from it, scanning down from slot 7; and at
// $CnFF the low byte of its driver's entry. The boot code reads block 0 to $0800 through the
// driver and jumps to $0801 with X the slot times 16, as a Disk II's boot ROM does. The driver
// takes ProDOS's call: the command at $42 (0 status, 1 read, 2 write, 3 format), the unit at
// $43, the buffer at $44 and the block at $46; back with A the error, carry set on one. Here it
// is answered by `call`, a hook on the entry.

// the driver's entry, low byte
export const DRIVER = 0x30;
// ProDOS's errors: an I/O error, no device, write-protected
const IO_ERROR = 0x27, NO_DEVICE = 0x28, PROTECTED = 0x2b;

// the blocks of a disk image: a 2mg's, in ProDOS order, or the image as it is
export function blocksOf(image) {
  const word = at => image[at] | image[at + 1] << 8 | image[at + 2] << 16 | image[at + 3] << 24;
  if (image.length >= 64 && String.fromCharCode(...image.subarray(0, 4)) === '2IMG') {
    if (word(12) !== 1) throw new Error('the 2mg is not in ProDOS order');
    return image.slice(word(0x18), word(0x18) + word(0x1c));
  }
  return image.slice();
}

export class Blocks {
  constructor(slot, image, { protect = false } = {}) {
    this.slot = slot; this.disk = blocksOf(image); this.protect = protect; this.out = false;
    const n = slot << 4, rom = new Uint8Array(256);
    rom.set([
      0xa2, 0x20, 0xa0, 0x00, 0xa2, 0x03, 0xa2, 0x3c,   // the signature, as code: LDX #$20, LDY #0, LDX #3, LDX #$3C
      0xa9, 0x01, 0x85, 0x42,                           // LDA #1, STA $42: read
      0xa9, n, 0x85, 0x43,                              // LDA #slot*16, STA $43: this slot's drive 1
      0xa9, 0x00, 0x85, 0x44, 0x85, 0x46, 0x85, 0x47,   // the buffer's low byte and the block, 0
      0xa9, 0x08, 0x85, 0x45,                           // LDA #8, STA $45: to $0800
      0x20, DRIVER, 0xc0 | slot,                        // JSR the driver
      0xb0, 0x05,                                       // BCS: no disk, so on to BASIC
      0xa2, n, 0x4c, 0x01, 0x08,                        // LDX #slot*16, JMP $0801
      0x4c, 0x00, 0xe0,                                 // JMP $E000
    ]);
    rom[DRIVER] = 0x60;                                 // RTS, where the hook answers
    rom[0xfe] = 0x17;                                   // status: two volumes (bits 5-4 one less), and it reads, writes and has a status
    rom[0xff] = DRIVER;
    this.rom = rom;
  }
  get count() { return this.disk.length / 512; }
  io() { return 0; }

  // the driver, on the processor `c`: ProDOS's call, from zero page
  call(c) {
    const cmd = c.read(0x42), unit = c.read(0x43), buf = c.read16(0x44), block = c.read16(0x46);
    let err = 0;
    if (unit & 0x80) err = NO_DEVICE;   // drive 2: none
    else if (this.out) err = IO_ERROR;   // the disk taken out
    else if (cmd === 0) { c.x = this.count & 0xff; c.y = this.count >> 8; err = this.protect ? PROTECTED : 0; }
    else if (block >= this.count) err = IO_ERROR;
    else if (cmd === 1) for (let i = 0; i < 512; i++) c.write(buf + i, this.disk[block * 512 + i]);
    else if (cmd === 2) { if (this.protect) err = PROTECTED; else for (let i = 0; i < 512; i++) this.disk[block * 512 + i] = c.read(buf + i); }
    else if (cmd !== 3) err = IO_ERROR;
    c.a = err; c.c = err ? 1 : 0; c.z = err ? 0 : 1;
  }
}

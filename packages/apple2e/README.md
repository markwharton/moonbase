# @moonbase-machines/apple2e

An Apple IIe with 128K as far as the games use it: the 6502 (`@moonbase-machines/mos6502`), double hi-res and
its sixteen colours, the Disk II and a block card for 3.5" disks, ProDOS's calls answered from a
game's files, and Moonbase's own ROM routines in place of Apple's, so that nothing of Apple's is
needed to run.

A title's saved games kept on the player's own disk (`saves.js`), on either way of running it: on Moonbase's
ROM, from the files the game's calls make; on Apple's, written onto the disk in the drive before it boots and read
off it as the title's own DOS writes it.

And the tools that take an Apple title's disks apart, and put a file on one: a DOS 3.3 disk read and written
(`dos33-disk.js`, a binary file saved or deleted as BSAVE and DELETE leave the disk) and a ProDOS one
(`prodos-disk.js`, a 140K `.dsk`, a `.po` or a `.2mg` read; a file saved on a volume or destroyed), a hi-res or
double hi-res screen as a picture (`hires-picture.js`, drawn as the machine draws it, in Node), an Applesoft
program listed (`applesoft-list.js`), and a shape table's shapes walked as DRAW walks them (`shapes.js`, which the
ROM's DRAW plots through).

Part of Moonbase (moonbase.au): Mark Wharton's titles of 1985 to 1995, running again in the browser
on these machines. MIT; see LICENSE. Each file opens with what it is and what it covers.

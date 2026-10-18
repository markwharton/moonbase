# @moonbase-machines/apple2e

An Apple IIe with 128K as far as the games use it: the 6502 (`@moonbase-machines/6502`), double hi-res and
its sixteen colours, the Disk II and a block card for 3.5" disks, ProDOS's calls answered from a
game's files, and Moonbase's own ROM routines in place of Apple's, so that nothing of Apple's is
needed to run.

And the tools that take an Apple title's disks apart: a DOS 3.3 disk read (`dos33-disk.js`) and a ProDOS one
(`prodos-disk.js`, a 140K `.dsk`, a `.po` or a `.2mg`), a hi-res or double hi-res screen as a picture
(`hires-picture.js`, drawn as the machine draws it), and an Applesoft program listed (`applesoft-list.js`). The
disks and pictures in Node only.

Part of Moonbase (moonbase.au): Mark Wharton's titles of 1985 to 1995, running again in the browser
on these machines. MIT; see LICENSE. Each file opens with what it is and what it covers.

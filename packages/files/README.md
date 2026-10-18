# @moonbase-machines/files

The formats the machines' files come in and go out as, for the tools that take a title's disks apart: a PNG
written (`png.js`: from rows of pixels or from RGBA bytes, and sheets of pictures) and read (`png-read.js`), and a
zip read (`zip.js`: every file, or the one a name matches). In Node only (`node:zlib`, `Buffer`); a CommonJS tool
loads them with `require()`, Node 22.12 and later.

Part of Moonbase (moonbase.au): Mark Wharton's titles of 1985 to 1995, running again in the browser on these
machines. MIT; see LICENSE. Each file opens with what it is and what it covers.

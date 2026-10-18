# Moonbase's machines

The machines Mark Wharton's titles of 1985 to 1995 run on again, in the browser and in Node, as
[moonbase.au](https://moonbase.au) has them:

| Package | What it is |
|---|---|
| [`@moonbase-machines/6502`](packages/6502) | The 6502: its documented instructions, an assembler and a disassembler. |
| [`@moonbase-machines/files`](packages/files) | The formats the machines' files come in and go out as, in Node: PNG written and read, and zip read. |
| [`@moonbase-machines/charset`](packages/charset) | Moonbase's own character set for the Commodore 64, and the 5 by 7 font it and the Apple IIe's text screen are drawn from. |
| [`@moonbase-machines/c64`](packages/c64) | A Commodore 64 as far as the games use it: the VIC-II, the SID, a 1541, a printer, and Moonbase's own KERNAL and BASIC in place of Commodore's ROMs. |
| [`@moonbase-machines/apple2e`](packages/apple2e) | An Apple IIe with 128K as far as the games use it: double hi-res, the Disk II, ProDOS, and Moonbase's own ROM routines in place of Apple's. |

Each runs on Moonbase's own ROM routines and characters, so nothing of Commodore's or Apple's is
needed or kept here. Every module opens with a comment saying what it is and what it covers.

```js
import { C64 } from '@moonbase-machines/c64/machine.js';
import { CPU } from '@moonbase-machines/6502/cpu.js';
```

`npm install` links the packages to each other; `npm test` runs their tests; `npm run build`
makes each package one file, `packages/<name>/dist/moonbase-<name>.js`, minified, with its source
map: the others it uses imported by name (`@moonbase-machines/6502`), so a page maps each name to its file:

```html
<script type="importmap">{"imports": {"@moonbase-machines/6502": "/lib/moonbase-6502.js", "@moonbase-machines/charset": "/lib/moonbase-charset.js", "@moonbase-machines/c64": "/lib/moonbase-c64.js"}}</script>
<script type="module">import { machine } from '@moonbase-machines/c64';</script>
```

MIT, (c) 2026 Mark Wharton: see LICENSE, and each package's own. The titles, their disks and
their pictures are not here and are not under this licence.

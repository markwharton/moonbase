# @moonbase-machines/player

The player for Mark Wharton's titles of 1985 to 1995, one way in for every title and every way to play it (`play.js`):

- **Original** (`way: 'original'`, `engines/original.js`): the game's own disk, untouched, on Moonbase's Apple IIe or
  Commodore 64 (`@moonbase-machines/apple2e`, `c64`). It's the Original on the makers' ROMs, where the page gives
  them (`roms`), and the Replica on Moonbase's own ROMs, which need nothing of Apple's or Commodore's.
- **Remake** (`way: 'remake'`): the game's scenes, lifted from its code and compiled to JavaScript, on the remake's
  engine (`engines/scenes.js`, a title of `card` or `vector` scenes), or the title's own engine, a module in its folder.

[The four layers](../../docs/layers.md) explains how the Original, the Replica and the Remake differ, and what runs
each one.

The player makes its part of the page and owns it, the same for every title: the section (classes `player`, the way,
the title's slug), the stage sized a whole number of the device's pixels to each of the screen's dots, the options
line and the status, the keys (one listener, each machine's codes, `keys.js`), the sound, a Commodore 64's printer,
the saves (`saves.js`), the settings the player and its engine act on, each declared where it acts and shown only
there (`settings.js`), and what the page asks of it (`watch`, `claim`, `pace`, keys and a route). An engine plays
the game on the stage and returns its handle (`play.js` says what it may have). The page tells the player everything
and the player reads no address and keeps nothing itself: the page gives the title's disk, a virtual disk of files
(`disk/disk.js` `openDisk`), and the person's settings, a typed store (`settings.js`: a setting is a declared name,
type, default and owner; only a declared setting can be read or kept, its value checked). Both come from a
**provider** (`provider.js`), which chooses once a visit where files and settings live, the backend (this browser's,
IndexedDB; an account's, a site's own); a site makes one a page from a module of its own, giving its policy of
settings (hidden, fixed, or a value for the visit) and the player never chooses. Nothing in the package knows of an
address: a page that lets its address set anything reads it itself, each input by its type. The disk has its own
dialogs (`disk/dialogs.js`, in a modal window, `modal.js`). A game saved in one way loads in the other.

No title is named in it. A title is a folder of its own, kept with the title, which the page gives the player:

- `title.js`, what the title is: its engine (`'card'`, `'vector'` or a module of its own), its screen where it is not
  its machine's (`screen`, in its own dots), its scripts and the one it starts with, its `map` (the routines its
  scenes call, by address, and what its engine needs beside them: `remake/cards.js` and `remake/vector.js` say what
  each engine reads), the modules it brings (`modules`, its problems; `view`, its view's own drawing), its font's own
  glyphs (`font`), its stylesheet (`style`);
- its scenes (`<name>.scene`) and `compiled/` (`moonbase-compile`); `remake/README.md` says what a scene is, how it
  is compiled and run, and the two engines.

Beside it the game's data, `<name>.json` (its disks' files, its kind, where it saves, `saves`, and its demonstrations,
`demonstrations`, where its sheet has some: each a name and the steps a person types to see it, which the Original
types into a Commodore 64 game at a button of that name; `data.js` makes the file and checks every step).

```html
<link rel="stylesheet" href="/packages/player/player.css">
<script type="importmap">{"imports": {"@moonbase-machines/player/": "/packages/player/", "@moonbase-machines/apple2e/": "/packages/apple2e/", "@moonbase-machines/c64/": "/packages/c64/", "@moonbase-machines/charset/": "/packages/charset/", "@moonbase-machines/mos6502/": "/packages/mos6502/", "@moonbase-machines/vector/": "/packages/vector/"}}</script>
<section id="player"></section>
<script type="module">
  import { play } from '@moonbase-machines/player/play.js';
  import { titleDisk } from '@moonbase-machines/player/disk/disk.js';
  import { provider } from '@moonbase-machines/player/provider.js';
  const { disk, settings } = await provider();   // (this browser's)
  await play({ way: 'remake', slug: 'game', title: new URL('title/', location).href, data: new URL('game.json', location).href,
    root: document.getElementById('player'), disk: await disk(titleDisk('game')), settings,
    words: { printer: { line: '', print: 'Print', tear: 'Tear off' } } });
</script>
```

`moonbase-compile <title folder>` compiles a title's scenes; `moonbase-play [folder] [port]` serves a title's page
on this machine (http://127.0.0.1:8002/), the packages from `node_modules`.

Part of Moonbase (moonbase.au). MIT; see LICENSE. Each file opens with what it is and what it covers.

# The remake engine

A remake is not a game written again in JavaScript. It is the title's own code, lifted from the original into scene
scripts, compiled to JavaScript and run on this engine. The engine stands in for the machine and for the routines the
title called. The logic is the original's, statement for statement, so the remake does what the original did, and the
pilots can hold the two side by side, event by event.

A title of its own engine is the exception: its `title.js` names a module in its folder as its `engine`, and that
module plays the game itself (below).

## A title's folder

The page gives the player the title's folder (`../README.md` says what is in it). For a remake on this engine it holds:

- `title.js`: the engine, `'card'` or `'vector'`; the scripts and the one it starts with; the files that load as
  scripts (`fileScripts`); the memory at the start; the entries other scripts jump into; and the `map`, the routines
  the scenes call, by address, each with the name of its step.
- `<name>.scene`: the scripts, as lifted and as edited after. They are the source.
- `compiled/<name>.js`: each scene compiled by `moonbase-compile`, which the remake runs. These are always compiled
  again from the scene and never edited.
- the title's own modules, where it has them: its problems (`modules`) and its view's drawing (`view`).

## A scene script

A scene is a step or a statement to a line (`script.js`), each line with the address in the original it came from:

```
L0813:                          a label
0813  if a != 127 goto L0825    a branch on a compare, or on a flag: if zero goto L0825
0817  call L08BF                a call into the script's own code
081C  char 32                   a step: one of the title's routines, with its inputs
0825  x = 0                     a statement on the registers a, x and y, the flags, the stack and memory
data $08D7 00 00 80 80          bytes of the original's tables, at their addresses
; a comment
```

A statement is the original's own instruction, written so it can be read. The engine runs it on three registers,
four flags, a stack and 64K of memory, as the 6502 did. A step is a call into one of the title's routines, which the
title's `map` names by address (`0x0800: 'char'`). The engine does the routine's work in JavaScript and emits an
event. Everything a scene does is an event: the view draws the events, and a pilot reads them as the transcript to
hold against the original's.

### Code that rewrites itself

A scene is the code as text, lifted once, so it can't follow code that changes its own instructions. The 6502 does
follow it, because it reads each instruction's bytes from memory as it runs. A routine that keeps a pointer in the
address bytes of its own `LDA` and moves the pointer by incrementing them would be lifted as a read of one fixed
address. Microsoft's CHRGET in 6502 BASIC is the best-known case. Such a line needs either a step, the routine
answered in JavaScript, or a hand edit to read through the pointer instead (`a = [$007A]`, the byte at the address
held at `$7A` and `$7B`), with the reason beside it.

## Compiled to JavaScript

`moonbase-compile <title folder>` writes each scene as an ES module in `compiled/` (`compile.js`). The module's
default export is `{ labels, data, steps, run }`:

- `labels`, each label's step;
- `data`, the bytes the script puts in memory;
- `steps`, each step's address, its line in the scene and its text;
- `run`, a function for each block of the script, by the step it starts at.

A run of statements that only computes is one function, a loop where it branches back to its own start, each line
with the scene's line beside it as a comment. Anything that can stop the run stays a step of its own, so the title
waits where it waited: a routine's step, and a read or write that may reach the I/O page. A jump, a call or a return
ends a function.

The player loads the compiled modules with `import()` (`load.js` `loadTitle`). There is no JSON in between. The JSON
beside the title, `<name>.json`, is the game's data: its disks' files, its kind and where it saves. `loadTitle` with
`scenes` reads the `.scene` files instead and runs them line by line, which gives the same results more slowly.

## The two engines

The scripts are the same for every title. What differs is the routines their steps call, and there are two sets.

- **Card** (`card.js`, `cards.js`, `card-view.js`, `c64-view.js`): a title on the Apple IIe or the Commodore 64. A
  toolkit's own code is lifted into scripts too, beside the scenes. What cannot be a script is JavaScript here: the
  routines that take their data inline after the call (fill, copy, print), the Apple's ROM routines and ProDOS's
  calls (`@moonbase-machines/apple2e`), the Commodore 64's KERNAL, I/O page, drive, printer and BASIC
  (`@moonbase-machines/c64`), the keyboard and the soft switches. The screen is the machine's own, written byte for
  byte as the original wrote it.
- **Vector** (`vector.js`, `layout.js`, `raster.js`, `problems.js`, `view.js`): a title on the vector engine. Its
  routines (a text, a picture, a box, a wait, a key) are written again here by the original's rules for keys, random
  numbers and waits. The view draws the pictures from their shapes as SVG (`@moonbase-machines/vector`), at any size.
  A title's problems are its own module, rewritten in JavaScript as generators, run with the helpers in `problems.js`.

`load.js` makes the engine from the title and its scripts (`makeEngine`), with the routines of the title's `engine`.
`../engines/scenes.js` plays it on the page.

## The original's time

A title's code sits in the remake's memory where it came from, so the engine counts the time the original took
(`Engine.time`). Each line costs its instruction's cycles, read from the opcode at its address, and a branch taken
costs one more. A click of the speaker is kept at its cycle and played as the emulator plays it (`../audio.js`), so
the remake runs at the original's speed and sounds as it did.

## Bugs fixed

The remake plays the game as it was, bugs and all, because the pilots hold it against the original. A title can
also have a version with its bugs fixed, as a separate script beside the faithful one. Its `title.js` names each
script that version replaces:

```js
fixed: { game: 'game-fixed' }
```

The player's setting **Bugs fixed** (`play.js`, `fixed`) is offered only for a title that has one. With it on,
`loadTitle` runs `compiled/game-fixed.js` in place of `compiled/game.js`, and the page starts again when the
setting changes. Only compiled scripts are replaced: with `scenes`, `loadTitle` runs the faithful scenes.

Because every statement is the original's, with its address, a fix is an edit to a known line, not a guess at what
the game meant. Make the fixed script from the faithful one by edits that each check the line they change is the
one they expect. A changed line keeps its address, and a line that is new has none. That keeps the fixed version
the same game with only its bugs changed. When the faithful script is lifted again, the edits are made again, and
one whose line has changed stops instead of editing the wrong line.

Corrupted text can be fixed the same way where the text is in the code: a string a call takes inline after it, or a
scene's `data` line. Text the game reads from its disk at run time is the game's data, `<name>.json`, not a
script, and a fixed script does not change it.

## A title of its own engine

When `title.js` names a module as its `engine`, the title has no scripts. `loadTitle` imports that module as
`title.own`, and the player hands it the game (`../play.js`). That engine is the original program's own, read from
its code and written again routine for routine, playing the game's data as the original read it.

## The files

| File | What it is |
|---|---|
| `engine.js` | runs the scripts: the statements on the registers, flags, stack and memory, the steps through the routines, every step an event |
| `script.js` | reads a scene script, a step to a line |
| `compile.js` | compiles a scene script to JavaScript (`moonbase-compile`) |
| `load.js` | loads a title's folder, its compiled scripts or its scenes, and makes its engine |
| `events.js` | what each step is as an event, in the same words for the original and the remake |
| `lift.js` | the lifter: a file's 6502 walked from its entries into a scene script; the card engine uses it to lift code a title's scenes miss, as it runs |
| `card.js`, `cards.js` | the card engine's routines, and what it knows of every title it plays |
| `vector.js`, `layout.js`, `raster.js`, `problems.js` | the vector engine's routines; its text laid out as the engine laid it out; the original's screen dot for dot, for the scenes that read it back; its problems' helpers |
| `view.js`, `card-view.js`, `c64-view.js` | the views: a vector title's as SVG, an Apple's hi-res page, a Commodore 64's screen |

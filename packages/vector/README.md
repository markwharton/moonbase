# @moonbase-machines/vector

Mark Wharton's vector graphics engine for the Apple IIe, as it is in PART0 of Animal Rescue
and Nature Park Adventure, both of 1989. Mark designed it and wrote all of it in 6502. He also
wrote the vector editor the pictures were drawn in, which is not on the disks. This package
describes the engine from its code and has JavaScript that reads its pictures and objects and
draws as it does, dot for dot.

The addresses here are Animal Rescue's. Nature Park's engine is the same code, later and moved:
its zero page is $10 to $21 where Animal Rescue's is $00 to $11, and every routine is at a new
address. The table at the end gives the main ones in both.

## The modules

| Module | What it has |
|---|---|
| `pictures.js` | `pictures` reads PICS1 to PICS3; `shapes` reads shapes from memory, as the engine finds them at $E000; `windows` finds each picture's background color in the scenes' code |
| `draw.js` | `line`, `crossings`, `spans`, `fill`, `outline`, `draw`, `inside` and `under`, on a screen of 192 rows of 140 colors |
| `objects.js` | `decode` reads an object, `put` puts one on a screen, `tables` finds every object table in the code, `carry` |
| `svg.js` | `elements` and `document` draw shapes as SVG at any size, crisp as the screen was or smooth |
| `font.js` | the engine's proportional font: each character's width and dots, and where a line of them starts |
| `inline.js` | the text, picture names and sounds the engine reads from after a call |

The sixteen colors, their names and `rgb` are the Apple's own, `@moonbase-machines/apple2e/colors.js`.
ES modules with nothing else to install, in Node and in the browser. The tests here are made from
bytes they build; the test that runs PART0 itself against `draw.js`, on every shape of both games,
lives where the games' disks are, since the disks are not this package's to hold.

## The screen

The screen is double hi-res: 140 dots across and 192 down, each dot one of sixteen colors. Each
row is 80 bytes, alternately from the auxiliary and the main halves of the page. Each byte holds
seven bits, lowest first, and four bits make one dot, its color's bits high bit first. So a dot
is four bits wide on the glass and a row is 560 bits.

A color is 0 to 15, and its four bits are the pattern the engine writes for it. The table at
$5FAD holds four bytes for each color: auxiliary, main, auxiliary, main, for seven dots of it.
Color 12 is 33 66 4C 19, which is 1100 repeated, and Apple calls that medium blue.

| | | | |
|---|---|---|---|
| 0 black | 4 dark green | 8 dark blue | 12 medium blue |
| 1 magenta | 5 gray | 9 purple | 13 light blue |
| 2 brown | 6 green | 10 gray | 14 aqua |
| 3 orange | 7 yellow | 11 pink | 15 white |

**One dot,** $5AF4, with the color in A and the dot's column and row in X and Y. Tables built
at $5A17 give each row's address in the page, each dot's byte and its place s, from 0 to 6, in a
group of seven. Dots in places 1, 3 and 5 straddle two bytes. The routine keeps the bits of the
byte that are not the dot's, with the masks at $18B8, and writes the dot's bits from a table of
each color in each place. For a dot that straddles, it does the same to the next byte with the
masks at $18BF. The places that start in the auxiliary half are 0, 1, 4 and 5. Animal Rescue's
dot routine draws anywhere it is told to. Nature Park's, at $500C, does nothing for a column
past 139 or a row past 191.

**A span,** $7947: the dots from X to Y on the row in $02, in the color in A. It writes the
first and last bytes with masks at $713F and $7146 and the bytes between whole.

**Reading a dot back,** $5B4C, gives the color at X and Y. $77BA keeps a span's bytes and $7958
puts them back, which is how an object is moved without spoiling the picture under it.

## Pictures

A picture is a list of shapes. A shape is two bytes, its fill color and its outline color,
then its points as column and row pairs. $FE ends a shape and $FF after it ends the picture. A
shape of two points is a line in its outline color.

PICS1 to PICS3 are lists of pictures. Each picture is its name in 14 bytes, padded with spaces,
then two bytes for its length from the start of the name, then its shapes. A scene asks for a
picture by name: the picture routine at $7AFE takes the name inline after the call, as a length
byte with its high bit set and the name in small letters with underscores for spaces. The
routine has the loader copy the shapes to $E000, then draws them.

The color behind a picture is not in the picture. Each scene sets it first, with the box routine
at $65D2, which takes three colors: the picture window's in A and the two text boxes' below it
in X and Y.

## How a shape is drawn

The loop at $7B8C draws each shape at $E000, its fill and then its outline, until it reads $FF.
Every rule below was found in the code and then checked: PART0's own fill, outline and point test,
run on the 6502 (`@moonbase-machines/mos6502`) on every shape of every picture of both games,
compared with `draw.js` after every step (the test where the disks are):

- **Animal Rescue:** 787 shapes and 4,722 point tests, all the same.
- **Nature Park:** 1,881 shapes and 11,286 point tests, all the same.

**The line,** $7A54, from ($00, $02) to ($01, $03) in the color in $11. It draws both ends and
one dot for every step along the longer axis. It keeps an error that starts at twice the shorter
distance less the longer one. While the error is below zero, only the longer axis steps, and
the error grows by twice the shorter distance. Otherwise both axes step, and it grows by twice
the shorter less twice the longer. The steps are written into the routine itself, as INX or DEX,
INY or DEY, or NOP.

**The outline,** $7BAA, draws every edge in the outline color and closes back to the first
point. A shape of two points is one line, and its fill color is not used.

**The fill,** $7C57, works in two passes over the edges, with a list of crossings for each row
kept in the language card.

1. The first pass counts the crossings on each row, so that each row's list can be laid out.
2. The second pass records them. It walks each edge that is not level with the line's own
   steps. Each time the walk leaves a row, it records the column of its last dot on that row.
   So an edge records nothing on the row it ends on, and the fill meets the outline's dots
   exactly.
3. Where an edge turns up after going down, or down after going up, its first point is recorded
   as well. The first edge that is not level always counts as a turn. Level edges are passed
   over.
4. The shape closes back to its first point. When that point is strictly between its two
   neighbours in height, and not on the top or bottom row, it is recorded as well.
5. Each row's list is kept in order, and a column equal to one already there goes after it.

The rows filled run from the first row with a crossing to the row before the next row without
one. On each row the columns are paired from the end of the list. So a row with an odd count
leaves out its largest column: three shapes in Animal Rescue do that, and thirteen in Nature
Park. Each pair is filled as a span, both ends included.

A span of one dot goes to the dot routine with the wrong value in A, and is drawn black. The
outline is drawn next and always covers it, so no finished picture shows it. `draw.js` draws
it anyway, so that the screen is the same after every step.

**The point test,** $7C54, is the fill with nothing drawn. The only difference between the two
entries is one byte, the mode, since $7C54 is `LDA #$80` followed by a BIT that hides the fill's
own `LDA #$00`. The point is in the shape when a span on its row has it between its ends, both
ends counted. It is not the usual count of crossings left of the point. It returns $80 for in and
0 for out. For a shape of two points it returns $FE, which a caller takes as in.

Only Nature Park uses the test. Its colouring-in problem, PROB1, asks it of every shape at the
point under the pointer, keeps the last shape that answers in, since later shapes cover earlier
ones, and fills that shape again in the new color. `under` in `draw.js` does the same.

## Objects

What moves over a picture is not in the picture. A scene points the engine at a table of objects,
a list of two-byte addresses, through $685A with the address in X and Y. It then draws an
object by its number, counted from 2, at a column and row: through $686D, or through $686F to
keep the ground under it so that it can be put back. Objects 0 and 1 put the kept ground back.

An object is four bytes, its flags, the bytes to a row, its width in dots and its height in
rows, then its rows. It is packed one of two ways:
- **Bytes:** with bit 6 of the flags clear, the rows are double hi-res bytes of seven bits. A
  byte with its high bit set is a run: the byte less that bit, as many times as the next byte
  says.
- **Nibbles:** with bit 6 set, the rows are a nibble a dot, each nibble a color. The first byte
  of all is an escape: after it come a count and a pair of nibbles to repeat.

A run may carry over the end of a row.

With bit 7 clear, the color in the flags' low four bits is the object's clear color: where one of
its own dots is that color, the ground under it shows through ($6A7D, which takes the dot from
the ground kept at $6B4E wherever the object's buffer at $6B50 holds that color). The elephants
of PROB2 are drawn in black boxes and flagged black, so only the elephants show, and the towers
are flagged white. With bit 7 set the object is put down whole.

The clear color works only when the routine has the ground to take the dot from. Through $686F
it keeps the ground at $6B4E, for object 0 to put back. Through $6863 it keeps each row in a
buffer of its own at $0240 ($6C12), so the clear color shows the ground and nothing is kept for
object 0. Through $686D the routine goes from $69C8 straight to $6B0F and puts the object down
whole, its clear color and all. PROB6's car is flagged gray, the road's color, and is drawn
through $686D as it moves, so its gray wipes out the car a dot behind; only its white edge, a
column the next car does not cover, is left where the dot drawn behind it misses.

## Text

The text routine at $6CE2 prints the text that follows the call, in the engine's own font on
the graphics screen. The text is ASCII with the high bit set, $8D starts a new line, and $80
ends it. $1B starts a code for the column, the row, the colors, the line spacing or a repeated
character. After $1B, codes $0F and $0C take two more bytes, $06 and $0B take four, and $07 to
$0A, $0D, $0E, $10 and $11 take none. Any other code takes one byte.

## The routines the scenes call

Animal Rescue's parts and problems are 6502 code, but nearly all of it is calls into the engine.
They call 42 of its routines, 974 times. Only three routines take data after the call: text, the
picture and the sound. The counts are for the parts and the problems together.

| Address | What it does | Given | Calls |
|---|---|---|---|
| $6CE2 | print the text after the call | the text | 191 |
| $6299, $629F, $6313, $6319, $6395, $6387 | clear one of the text panels and put the cursor in it | nothing | 168 |
| $5C23 | wait for the space bar, showing its button | nothing | 82 |
| $5C08 | wait for the space bar, then take its button away | nothing | 67 |
| $686D | draw an object | A the number, X and Y the place | 55 |
| $686F | draw an object, keeping the ground under it | A the number, X and Y the place | 49 |
| $65D2 | set up the picture window and the two text boxes | A, X, Y the three colors; $80 leaves one as it is | 48 |
| $7AFE | load a picture by name and draw it | the name | 48 |
| $7947 | fill a span of a row | A the color, X and Y the ends, $02 the row | 27 |
| $60C2 | a random number below A | A | 26 |
| $6831 | a beep of the pitch in A | A | 26 |
| $685A | set the table of objects | X and Y its address | 24 |
| $425B | a sound: end pitch, start pitch, clicks a step, the step, repeats | five bytes | 23 |
| $5BA9 | show the double hi-res screen | nothing | 16 |
| $76ED, $76F3 | draw a key with its letter | A the letter, X and Y the place | 25 |
| $5F1D | multiply A by X into X and A | A, X | 13 |
| $7A54 | a line | $00 to $03 the ends, $11 the color | 13 |
| $641B, $6415 | ask for a key, showing its letter | A the letter | 11 |
| $67B9 | a filled rectangle, columns X to X + $0E, both ends, and $0F rows | A the color, X and Y the corner, $0E and $0F the size | 10 |
| $5B4C | read the color of a dot | X, Y | 8 |
| $57CA | load a problem into the language card and run it at $F000 | A the problem | 6 |
| $5AF4 | one dot | A the color, X, Y | 6 |
| $5F4B | fill rows with a color | A the color, X the rows, Y the first | 5 |
| $5D66 | read the keyboard, the joystick or the Concept Keyboard | nothing | 4 |
| $5EEF | divide Y and X by A | A, X, Y | 4 |
| $4035 | load a part and start it | A the part | 3 |
| $677E | a rectangle's outline, four lines from X to X + $0E and Y to Y + $0F | as $67B9 | 3 |
| $67DB | flash the picture window, with a sound | nothing | 3 |

The rest are called once or twice: a key panel from a table ($66F8), keeping and putting back a
span ($77BA, $7958), the space bar's button alone ($5C45), two white lines across the screen
($5FFD), and inverting a span ($7870). What each text code does, the random routine's exact
range, and the third way of drawing an object, $6863, are read from the routines' first
instructions and not traced further.

| Routine | Animal Rescue | Nature Park |
|---|---|---|
| text | $6CE2 | $61C3 |
| picture | $7AFE | $6FDF |
| box | $65D2 | $5AB3 |
| sound | $425B | $4E12 |
| wait for the space bar | $5C23 | $513A |
| object, object keeping the ground | $686D, $686F | $5D4E, $5D50 |
| set the table of objects | $685A | $5D3B |
| fill, point test, outline | $7C57, $7C54, $7BAA | $7147, $7144, $709A |
| line, span, dot, read a dot | $7A54, $7947, $5AF4, $5B4C | $6F35, $6E28, $500C, $506C |
| the color table | $5FAD | $54FE |

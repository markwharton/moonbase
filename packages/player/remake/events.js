// What a step is, as an event: the same words for the original, where the pilot's observer sees
// the engine's routine called, and for the remake, where a script's step runs. Two runs are the
// same when their events are.

// the registers each routine takes, in order
export const TAKES = {
  box: 'axy', object: 'axy', 'object-keep': 'axy', 'object-mode': 'axy', objects: 'xy', span: 'axy', random: 'a', beep: 'a',
  'key-at': 'axy', key: 'a', multiply: 'ax', divide: 'axy', ask: 'a', 'ask-mode': 'a', 'ask-escape': 'a', rectangle: 'axy', 'read-dot': 'xy',
  problem: 'a', dot: 'axy', 'fill-rows': 'axy', part: 'a', 'rectangle-outline': 'axy', 'key-panel': 'a', 'keep-span': 'xy',
  'put-span': 'xy', 'white-lines': 'y', 'invert-span': 'xy',
  // Animal Rescue's problems: PROB1, the chimps' tree, a box by its letter
  label: 'a', 'flip-box': 'a', 'flash-box': 'a',
  // PROB2, the elephants: a mark on the path by its place, and a jump by how far it goes
  path: 'ax', jump: 'a',
  // PROB3, the parrots' food: a box of the grid by its column and row, what shows in it, and a pair
  cell: 'axy', 'cell-box': 'axy', pair: 'a',
  // PROB4, the puzzle box: a piece by its edges, where it goes, and its color in $11
  piece: 'axy',
  // Nature Park's PROB1, the colour pattern: a shape coloured in with a pen, the shape in $0E15
  colour: 'a',
  // PROB3, the truck: a turn of its loop, which gives the key down then, or 0
  tick: '',
  // Detect-A-Pet's card toolkit (its title's map): print takes its x in X and Y, its y in A, and
  // the carry for XDRAW; HPOSN its y in A and x in X and Y; HLIN its x in A and X and y in Y
  print: 'axyc', arrow: 'a', unpack: 'y', 'load-picture': 'a', 'action-cards': 'a', 'return-key': 'a', 'space-key': 'a',
  'wipe-rows': 'a', 'wipe-columns': 'a', 'text-card': 'a', 'fill-left': 'a', 'put-object': 'axy', 'draw-room-objects': 'yc', take: 'y',
  drop: 'y', effect: 'a', outport: 'a', cout: 'a',
  // Pieces of Eight's text: a character at the cursor, a message by its number, and a room's
  // description from one of three tables
  char: 'a', message: 'xy', describe: 'axy',
  // the Commodore 64's KERNAL (Zoopak): a character out, the cursor's place, a file's number,
  // device and secondary address, its name, a load or save, and the serial bus's bytes
  chrout: 'a', plot: 'xyc', close: 'a', chkin: 'x', chkout: 'x', setlfs: 'axy', setnam: 'axy', load: 'axy', save: 'axy', listen: 'a', second: 'a', ciout: 'a', talk: 'a', tksa: 'a', setmsg: 'a', tone: 'xy', 'load-objects': 'axy', hposn: 'axy', hlin: 'axy', hcolor: 'x', pause: 'a', 'bag-put': 'a',
};

// the inputs some problems' routines take from their own memory, at fixed addresses
const MEMORY = { colour: { shape: 0x0e15 }, 'card-frame': { x: 0x4078, high: 0x4079, y: 0x407a, width: 0x407b, height: 0x407c } };

// the inputs some routines take from the zero page rather than the registers: the line's ends
// and color, and a rectangle's width and height
const ZERO = { line: { x0: 0x00, x1: 0x01, y0: 0x02, y1: 0x03, color: 0x11 }, piece: { color: 0x11 }, rectangle: { width: 0x0e, height: 0x0f }, 'rectangle-outline': { width: 0x0e, height: 0x0f } };

// A step as an event: its name, any fixed input (a panel's number), the registers it takes,
// the zero page inputs, read through `read`, and the data it had inline (a text, a picture's
// name, a sound).
export function describe(name, fixed, regs, inline, read, peek) {
  const e = { step: name };
  if (fixed.length) e.n = fixed.map(Number);
  const takes = TAKES[name];
  if (name === 'objects') e.table = '$' + ((regs.x | regs.y << 8).toString(16).toUpperCase().padStart(4, '0'));
  // object 0 or 1 puts back the ground kept under an object, where it was: what is left in X and Y
  // then is whatever the steps before left there, and is no input
  else if (name.startsWith('object') && regs.a < 2) e.a = regs.a;
  else if (takes) for (const r of takes) e[r] = regs[r];
  if ((name === 'key-at' || name === 'key') && e.a !== undefined) e.a = String.fromCharCode(e.a & 0x7f);
  if (ZERO[name] && read) for (const [k, at] of Object.entries(ZERO[name])) e[k] = read(at);
  if (MEMORY[name] && peek) for (const [k, at] of Object.entries(MEMORY[name])) e[k] = peek(at);
  if (inline !== undefined) e.words = inline;
  return e;
}

// the outputs of a routine that a scene goes on to use, recorded as it returns
export const GIVES = { random: 'a', ask: 'ax', 'ask-mode': 'ax', 'ask-escape': 'axc', 'wait-or-escape': 'c', problem: 'c', 'read-key': 'a', 'read-dot': 'a', multiply: 'ax', divide: 'ax', 'blink-key': 'a', 'which-box': 'xy', tick: 'a', 'choose-action': 'a', take: 'a', drop: 'a', 'show-bag': 'a', 'bag-choose': 'a', getin: 'a', acptr: 'a', readst: 'a', load: 'cxy', chrin: 'a' };

// A call that does nothing is no step: the beep returns at once for A 0 ($6831 in Animal Rescue,
// $5D12 in Nature Park), and a scene that reads keys by polling beeps each one, 0 for none, until
// one comes. As steps those would be as many as the polls, which is how long the machine was
// watched, not what the title did.
export const nothing = (name, a) => name === 'beep' && a === 0;

// routines that poll for a key: each is a step only when it gives one
export const POLLS = new Set(['read-key', 'blink-key']);
// routines that wait for keys; any other, while it runs, is busy, and a key pressed then is not for it
export const WAITS = new Set(['wait', 'wait-erase', 'wait-or-escape', 'ask', 'ask-mode', 'ask-escape', 'which-box', 'tick', 'choose-action', 'take', 'drop', 'show-bag', 'bag-choose']);
export function result(name, regs) {
  const e = { result: name };
  for (const r of GIVES[name]) e[r] = regs[r];
  return e;
}

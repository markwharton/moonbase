// The keys a page's keyboard gives, as the machine a game was made for takes them: the one table of each, for every
// way to play (play.js reads them; an engine that reads the keyboard itself, a Commodore 64's matrix, Aztlan's menus'
// shortcuts, is handed the event as well).
//
//   code(event, kind)     the key's code for the machine of that kind ('prodos', 'dos33' or 'c64'; none for a title
//                         of its own engine), or undefined for a key it has none for
//   named(name, kind)     a key by its name in a route or ?keys= (space, return, left...), as the machine's code
//   typing(steps, kind)   a demonstration's steps (data.js `demonstrations`) as the one string the machine is to be
//                         given, as typed: each step a key by its name, { key: 'f4' }, or text, { type: '1 PISTONS' };
//                         a step of any other shape, or a key the machine has no name for, refused

// the Apple II's keyboard: the arrows as its control keys, DELETE, ESC, TAB
const APPLE = { ArrowLeft: 8, ArrowRight: 21, ArrowDown: 10, ArrowUp: 11, Enter: 13, Backspace: 127, Delete: 127, Escape: 27, Tab: 9, ' ': 32 };
// a Commodore 64's, in PETSCII: its cursor keys, DEL and RUN/STOP, and its letters capitals
const C64 = { ArrowLeft: 157, ArrowRight: 29, ArrowDown: 17, ArrowUp: 145, Enter: 13, Backspace: 20, Delete: 20, Escape: 3, ' ': 32 };
// the names a route's keys and ?keys= use, as the Apple's codes, and those a Commodore 64 has in their place
const NAMES = { space: 32, return: 13, escape: 27, delete: 127, left: 8, right: 21, down: 10, up: 11, 'control-e': 5, 'control-t': 20, none: -1 };
const PETSCII = { 8: 157, 21: 29, 10: 17, 11: 145, 127: 20, 27: 3 };
// and the keys a Commodore 64 alone has, by name: its function keys, CLR and HOME, INST and DEL, RUN/STOP, £ and ←, in
// PETSCII as the KERNAL's GETIN gives them
const C64_NAMES = { f1: 133, f2: 137, f3: 134, f4: 138, f5: 135, f6: 139, f7: 136, f8: 140, home: 19, clr: 147, inst: 148, del: 20, stop: 3, pound: 92, arrow: 95 };

export function code(e, kind) {
  if (!kind || e.metaKey || e.altKey) return undefined;
  const c64 = kind === 'c64';
  // control with a letter is the machine's control character (control-E opens a vector title's main menu)
  if (e.ctrlKey) return /^[a-z]$/i.test(e.key) ? e.key.toUpperCase().charCodeAt(0) & 0x1f : undefined;
  return (c64 ? C64 : APPLE)[e.key] ?? (e.key.length === 1 ? (c64 ? e.key.toUpperCase() : e.key).charCodeAt(0) : undefined);
}

export function named(name, kind) {
  if (kind === 'c64' && name in C64_NAMES) return C64_NAMES[name];
  const k = NAMES[name] ?? name.charCodeAt(0);
  return kind === 'c64' ? PETSCII[k] ?? k : k;
}

export function typing(steps, kind) {
  if (!Array.isArray(steps) || !steps.length) throw new Error('a demonstration is a list of steps, each { key } or { type }');
  return steps.map(s => {
    const [what, ...more] = Object.keys(s ?? {});
    if (more.length || !['key', 'type'].includes(what) || typeof s[what] !== 'string' || !s[what]) throw new Error('a step is { key: name } or { type: text }: ' + JSON.stringify(s));
    if (what === 'type') return kind === 'c64' ? s.type.toUpperCase() : s.type;   // (the 64's letters its capitals, as the keyboard gives them)
    if (s.key === 'none' || !(s.key in NAMES || (kind === 'c64' && s.key in C64_NAMES))) throw new Error(`no key named ${s.key} for a ${kind} game`);
    return String.fromCharCode(named(s.key, kind));
  }).join('');
}

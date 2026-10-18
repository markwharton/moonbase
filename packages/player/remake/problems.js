// A problem, rewritten for the remake: a generator function that takes the problem's helpers
// and yields whenever it waits for a key. Its steps are the same routines the scripts use, so
// they give the same events; a problem's own drawing routines are steps of their own, named in
// its title's map (`problems`), which the view draws however it likes.
//
//   function* (p) { yield* p.call('text', 'Hello'); const { x } = yield* p.call('ask', 202); }
import { describe } from './events.js';

export function helpers(e, routines) {
  const zero = e.title.map.vars.zero;
  // a step: run its routine, and wait for as long as it waits
  function* call(name, ...args) {
    const token = { words: [name] };   // what the view reads to know what the problem waits for
    const words = args.map(a => typeof a === 'string' && name === 'text' ? { string: a } : typeof a === 'number' ? String(a) : a);
    for (;;) {
      const r = routines[name](e, words, token);
      if (r !== 'wait') return { a: e.a, x: e.x, y: e.y, c: e.c };
      yield 'wait';
    }
  }
  // a problem's own drawing routine: its event, and what it leaves for the view
  // and the title's painter for it, if it has one (titles/<title>/paint.js), paints it into the
  // model of the original's screen
  const drawn = (name, a = 0, x, y) => { e.a = a & 0xff; if (x !== undefined) e.x = x & 0xff; if (y !== undefined) e.y = y & 0xff; e.title.paint?.[name]?.(e.title.model, e); e.emit(describe(name, [], e, undefined, z => e.mem[z + zero], a => e.mem[a])); };
  // A key, for a problem that reads keys itself: it waits, and the view shows what `kind` of wait
  // it is, 'wait' for the space bar's button or 'ask' for the keys e.askMode asks for.
  function* key(kind = 'wait') {
    const token = { words: [kind] };
    for (;;) {
      const k = e.key();
      // control-E: the Main Menu, from the key reader, as at any key the original read
      if (k === 5 && e.title?.menu) e.leave(...e.title.menu);
      // control-E or control-T in Nature Park: its menus, and back to waiting here
      if (e.title?.visit?.[k]) { e.visit(k); e.waitingOn = token; yield 'wait'; continue; }
      if (k !== undefined) { e.waitingOn = null; return k; }
      e.waitingOn = token;
      yield 'wait';
    }
  }
  // steps done inside a routine of the problem's own: drawn, and no steps of the transcript
  function* inside(run) { e.inside++; try { return yield* run; } finally { e.inside--; } }
  return { e, mem: e.mem, call, drawn, key, inside };
}

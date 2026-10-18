// A program's statements, as read from Blitz!'s code or by basic-lang.js from BASIC's text,
// compiled to JavaScript: a module, a step a statement, which an engine runs, each step's work
// done by the BASIC of basic.js (`b`, the engine's `basic`).
//
//   compile(statements, { name, source, mem, cost, render })  the module's text
//   instantiate(statements, { ... })                        the same, as the program itself
//     statements  the tree: statements, and labels where a jump goes
//     mem         memory as the program has it, for the text after each SYS: its parameters'
//                 expressions are compiled too (`params`), for the ROM's routines that the
//                 machine code reads them with
//     cost        the cycles a statement takes, for the page's clock
//     render      a statement as BASIC, each step's text
import { expression } from './basic-lang.js';

const hex = (v, w = 4) => v.toString(16).toUpperCase().padStart(w, '0');
const q = s => JSON.stringify(s);

// where an operation that can fail is, as the last argument of its call (evaluated after the
// others, so after any inner operation's): BASIC's error gives it (basic.js `here`)
const here = x => x.op !== undefined ? `, b.here(0x${x.op.toString(16)})` : '';
// an expression as JavaScript, and whether it is a string
function js(x) {
  switch (x.k) {
    case 'num': return String(x.v);
    case 'str': return q(x.s);
    case 'special': return { ti: 'b.ti()', 'ti$': 'b.tis()', st: 'b.st()', pi: String(Math.PI) }[x.n];
    case 'var': return `b.get(${q(x.n)})`;
    case 'elem': return `b.elem(${q(x.n)}, [${x.i.map(js).join(', ')}]${here(x)})`;
    case 'neg': return `-b.num(${js(x.a)})`;
    case 'not': return `b.not(${js(x.a)})`;
    case 'op': {
      const a = js(x.a), c = js(x.b);
      switch (x.o) {
        case '+': return `b.add(${a}, ${c}${here(x)})`;
        case '-': return `(b.num(${a}) - b.num(${c}))`;
        case '*': return `(b.num(${a}) * b.num(${c}))`;
        case '/': return `b.div(${a}, ${c}${here(x)})`;
        case '^': return `b.pow(${a}, ${c}${here(x)})`;
        case 'and': return `b.and(${a}, ${c}${here(x)})`;
        case 'or': return `b.or(${a}, ${c}${here(x)})`;
        default: return `b.cmp(${a}, ${c}, ${q(x.o)}${here(x)})`;
      }
    }
    case 'fn-call': return `b.fn(${q(x.n)}, ${js(x.a)})`;
    case 'fn': {
      const a = x.args.map(js);
      const F = { 'str$': 'str', 'chr$': 'chr', 'left$': 'left', 'right$': 'right', 'mid$': 'mid' };
      return `b.${F[x.n] ?? x.n}(${a.join(', ')}${a.length < 3 && (x.n === 'mid$') ? ', undefined' : ''}${here(x)})`;
    }
  }
  throw new Error('no expression ' + x.k);
}

// a place to store into: a variable or an array's element
const store = (t, v, s) => t.k === 'elem' ? `b.setElem(${q(t.n)}, [${t.i.map(js).join(', ')}], ${v}${s ? here(s) : ''})` : `b.set(${q(t.n)}, ${v}${s ? here(s) : ''})`;
const isString = t => t.n.endsWith('$');

export function compile(statements, { name, source, mem, cost = 0, render }) {
  // each statement a step, each label the step after it
  const labels = {}, steps = [];
  for (const s of statements) { if (s.label !== undefined) labels['L' + hex(typeof s.label === 'number' ? s.label : parseInt(s.label.slice(1), 16))] = steps.length; else steps.push(s); }
  // (a jump to a line not there is UNDEF'D STATEMENT when it is taken: `missing`)
  const step = to => { if (to?.missing !== undefined) return null; const k = labels['L' + hex(to)]; if (k === undefined) throw new Error('no label for $' + hex(to)); return k; };
  const params = new Map();
  const body = steps.map((s, k) => {
    const go = to => to?.missing !== undefined ? 'b.undef();' : `e.pc = ${step(to)};`;
    let c;
    switch (s.k) {
      case 'let': c = store(s.t, js(s.e), s); break;
      case 'dim': c = `b.dim(${q(s.n)}, [${s.sizes.map(js).join(', ')}]);`; break;
      case 'poke': c = `b.poke(${js(s.a)}, ${js(s.v)}${here(s)});`; break;
      case 'for': c = `b.for(${q(s.v)}, ${js(s.to)}, ${s.step ? js(s.step) : 1}, ${k + 1});`; break;
      case 'next': case 'next-var': c = `{ const back = b.next(${s.v ? q(s.v) : 'null'}); if (back !== null) e.pc = back; }`; break;
      case 'goto': c = go(s.to); break;
      case 'gosub': c = `b.gosub(${k + 1}); ${go(s.to)}`; break;
      case 'return': c = 'e.pc = b.ret();'; break;
      case 'on': c = `{ const n = b.on(${js(s.e)}${here(s)}); if (n >= 1 && n <= ${s.to.length}) { const to = [${s.to.map(step).join(', ')}][n - 1]; if (to === null) b.undef(); ${s.gosub ? `b.gosub(${k + 1}); ` : ''}e.pc = to; } }`; break;
      case 'unless': c = s.to < 0 ? `if (!b.num(${js(s.e)})) e.pc = ${steps.length};` : `if (!b.num(${js(s.e)})) ${go(s.to)}`; break;
      case 'if-goto': c = `if (b.num(${js(s.e)})) ${go(s.to)}`; break;
      case 'if-return': c = `if (b.num(${js(s.e)})) e.pc = b.ret();`; break;
      case 'print': c = `b.print(${js(s.args[0])});`; break;
      case 'print,': c = `b.print(${js(s.args[0])}); b.comma();`; break;
      case 'print-line': c = `b.print(${js(s.args[0])}); b.newline();`; break;
      case 'print-line#': c = `b.print(${js(s.args[0])}); b.newline(); b.clrchn();`; break;
      case 'print#': c = `b.output(${js(s.args[0])});`; break;
      case 'print#-line': c = `b.output(${js(s.args[0])}); b.newline(); b.clrchn();`; break;
      case 'clrchn': c = 'b.clrchn();'; break;
      case 'input#': c = `b.input(${js(s.args[0])});`; break;
      // GET#: the file the input, a character for each variable (none, ""), and the keyboard again
      case 'get#': c = `b.input(${js(s.args[0])}); ${s.targets.map(t => store(t, isString(t) ? 'b.getFrom()' : 'b.val(b.getFrom())')).join('; ')}; b.clrchn();`; break;
      // (an item of an INPUT given up, a read from the file timed out, leaves its variable)
      case 'input': case 'input-item': c = `{ const v = b.item(${isString(s.t)}, ${s.k === 'input'}); if (v !== undefined) ${store(s.t, 'v')}; }` + (s.last ? ' b.inputDone();' : ''); break;
      case 'input-start': c = ''; break;
      case 'open': c = `b.open([${s.args.map(js).join(', ')}]);`; break;
      case 'close': c = `b.close(${js(s.args[0])});`; break;
      // WAIT: this step again until the place's bits come, the wait the run stops for
      case 'wait': c = `if (!b.wait(${s.args.map(js).join(', ')})) { e.pc = ${k}; if (++e.idle > (e.routines.polls ?? 200) && !e.clock) e.polled = true; }`; break;
      case 'print-comma': c = 'b.comma();'; break;
      case 'newline': c = 'b.newline();'; break;
      case 'tab': c = `b.tab(${js(s.args[0])}${here(s)});`; break;
      case 'spc': c = `b.spc(${js(s.args[0])}${here(s)});`; break;
      case 'get': c = `{ const k = b.key(); if (k === null) { e.pc = ${k}; return; } ${store(s.t, isString(s.t) ? 'k' : 'b.val(k)')} }`; break;
      case 'read': case 'read$': c = store(s.t, `b.read(${isString(s.t)})`); break;
      case 'clr': c = 'b.clr();'; break;
      case 'restore': c = 'b.restore();'; break;
      // DEF FN: the function kept, its expression a function of the BASIC it runs on
      case 'def': c = `b.def(${q(s.n)}, ${q(s.p)}, b => ${js(s.e)});`; break;
      case 'end': case 'stop': c = 'e.ended = true;'; break;
      case 'ti$=': c = `b.setTis(${js(s.args[0])});`; break;
      // RUN, Blitz!'s: the files closed, the variables cleared, the program's start run again (its
      // DIMs), and on from after the RUN; the start's jump past the DATA is to there, or else to
      // the main code
      case 'run': c = `b.run(${k + 1}); ${s.to !== undefined ? go(s.to) : 'e.pc = 0;'}`; break;
      // a statement BASIC could not read: its error, when it is reached
      case 'fail': c = `b.failWith(${q(s.what)});`; break;
      case 'run-main': c = `e.pc = b.resume ?? ${steps.length ? step(s.to) : 0}; b.resume = undefined;`; break;
      case 'nop': case 'flag+40': case 'flag-40': case 'flag+80': case 'flag-80': c = ''; break;
      // SYS: the machine code at the address, with its text from just after SYS for its
      // parameters
      case 'sys': {
        c = `return b.sys(${js(s.e)}, 0x${hex(s.text)}, s[${k}]);`;
        if (mem) for (let at = s.text; at < s.end;) {
          while (mem[at] === 0x20 || mem[at] === 0x2c) at++;
          if (at >= s.end) break;
          // (as far as there are expressions: what follows SYS 2076, Blitz!'s own bytes, BASIC
          // never reads, the machine code never coming back to it)
          let x; try { x = expression(mem, at); } catch { break; }
          params.set(at, [x.end, js(x.e), x.e.k === 'str' ? x.e.at : null]);
          at = x.end;
        }
        break;
      }
      // what goes through the KERNAL's files and the rest: the library's
      default: c = `return b.statement(${q(s.k)}, [${(s.args ?? []).map(js).join(', ')}]${s.t ? ', ' + q(s.t.n) : ''}, s[${k}]);`;
    }
    // (and where the statement's own instruction is, for an error of its own, RETURN WITHOUT
    // GOSUB, before anything else in it notes its place)
    return (s.op !== undefined ? `b.here(0x${s.op.toString(16)}); ` : '') + c;
  });
  const out = [];
  out.push(`// ${name}, compiled from ${source} by @moonbase-machines/c64/basic-compile.js: compiled again, never edited`);
  out.push('export default {');
  out.push(`  labels: ${JSON.stringify(labels)},`);
  out.push('  data: [],');
  out.push('  steps: [');
  for (const [k, s] of steps.entries()) out.push(`    [0x${hex(s.at)}, ${k}, ${q(render(s))}],`);
  out.push('  ],');
  out.push('  run: {');
  for (const [k, c] of body.entries()) out.push(`    ${k}: (e, s) => { const b = e.basic;${cost ? ` b.cost(${cost});` : ''} ${c} },`);
  out.push('  },');
  // each SYS's parameters by where their text starts: where it ends, its value, and a string's
  // place in memory
  out.push('  params: {');
  for (const [at, [end, v, place]] of [...params].sort((a, b) => a[0] - b[0])) out.push(`    0x${hex(at)}: [0x${hex(end)}, b => ${v}${place !== null ? `, 0x${hex(place)}` : ''}],`);
  out.push('  },');
  out.push('};');
  return out.join('\n') + '\n';
}

// The same, as the program itself rather than its module's text: for a program compiled as it
// runs (moonbase's BASIC ROM's RUN, rom.js), from the very code the remake's are written
// with. (Its steps' functions are the text's, made by the browser's or Node's own JavaScript.)
export function instantiate(statements, options) {
  const text = compile(statements, options);
  return new Function('return ' + text.slice(text.indexOf('export default ') + 'export default '.length).replace(/;\s*$/, ''))();
}

// An expression of the tree as a function of BASIC (`b`, basic.js's methods), from the same
// code the compiled programs' are: for moonbase's BASIC ROM's evaluator, an expression read from
// BASIC's text as the original runs (basic-rom.js)
export const evaluator = x => new Function('b', 'return ' + js(x));

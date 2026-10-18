// A scene script compiled to JavaScript: moonbase-compile writes each title's scripts as modules
// beside them (its folder's compiled/<name>.js), and the remake runs those.
//
// The script's statements become JavaScript on the engine's registers, flags, stack and memory,
// each line with the script's line beside it, so the code can be read against the original's.
// A run of statements that does nothing but compute is one block, one function, from a label
// or the step after a jump, a call or a routine's step, to the next of those; a branch back to
// the block's own start is a loop in it. What can stop the run stays a step of its own, as the
// engine runs it: a routine's step (a wait for a key, a picture), and any read or write that may
// reach the I/O page (the keyboard, read until a key comes, or a tick), so that the title waits
// where it waited, step for step.
//
// Each run of lines to a branch starts with its time (Engine.time), the cycles of the original's
// instructions there, and a branch taken adds one, as the 6502's does.
//
// A compiled script is { labels, data, steps, run }: the labels by step, the data put into
// memory as the script is read, each step as [its address, its line in the scene, its text],
// and `run`, each block's function by the index of the step it starts at: (e, s) => ..., on the
// engine e and the script's steps s.
import { parse, operand, branchTaken } from './script.js';

const hex = (v, n = 2) => '0x' + v.toString(16).padStart(n, '0');
// the I/O page, the Apple's $C000 to $C0FF unless the title gives its own (compile's `io`)
let IO_FROM = 0xc000, IO_TO = 0xc0ff;
const IO = at => at >= IO_FROM && at <= IO_TO;

// an operand's address as JavaScript, and whether it may be on the I/O page: an address the
// code keeps (($26)[y], [$0D19][x]) can be anywhere, and so can a table indexed across $C000
function address(o) {
  if (o.through !== undefined) return { js: `(e.mem[${hex(o.through)}] | e.mem[${hex(o.through + 1)}] << 8) + e.y & 0xffff`, io: true };
  if (o.pair !== undefined) return { js: `e.mem[${hex(o.pair)} + e.x & 0xff] | e.mem[${hex(o.pair)} + e.x + 1 & 0xff] << 8`, io: true };
  if (o.via !== undefined) return { js: `(e.mem[${hex(o.via, 4)}] | e.mem[${hex(o.via + 1, 4)}] << 8)${o.index ? ' + e.' + o.index + ' & 0xffff' : ''}`, io: true };
  if (!o.index) return { js: hex(o.at, 4), io: IO(o.at) };
  const io = o.at <= IO_TO && o.at + 255 >= IO_FROM;
  return { js: o.at + 255 > 0xffff ? `(${hex(o.at, 4)} + e.${o.index}) & 0xffff` : `${hex(o.at, 4)} + e.${o.index}`, io };
}
// reading an operand, and writing one: { js, io }
// a read for a load, a compare or the like takes a cycle more where an index carries into the
// next page (Engine.ix); a read for a change in place (an increment, a shift) never does
function get(word, timed = true) {
  const o = operand(word);
  if (o.number !== undefined) return { js: String(o.number & 0xff) };
  if (o.reg === 'carry') return { js: 'e.c' };
  if (o.reg) return { js: 'e.' + o.reg };
  const a = address(o);
  if (timed && o.through !== undefined) return { js: `e.read(e.ix(e.mem[${hex(o.through)}] | e.mem[${hex(o.through + 1)}] << 8, e.y))`, io: true };
  if (timed && o.via !== undefined && o.index) return { js: `e.read(e.ix(e.mem[${hex(o.via, 4)}] | e.mem[${hex(o.via + 1, 4)}] << 8, e.${o.index}))`, io: true };
  if (timed && o.index && !o.zp) return { js: a.io ? `e.read(e.ix(${hex(o.at, 4)}, e.${o.index}))` : `e.mem[e.ix(${hex(o.at, 4)}, e.${o.index})]`, io: a.io };
  return { js: a.io ? `e.read(${a.js})` : `e.mem[${a.js}]`, io: a.io };
}
function put(word, v) {
  const o = operand(word);
  if (o.reg) return { js: `e.${o.reg} = ${v}` };
  const a = address(o);
  return { js: a.io ? `e.write(${a.js}, ${v})` : `e.mem[${a.js}] = ${v}`, io: a.io };
}
// a read, then a write of the same place: { at, js(read), write(v), io }
function place(word) {
  const o = operand(word);
  if (o.reg) return { pre: '', read: 'e.' + o.reg, write: v => `e.${o.reg} = ${v}` };
  const a = address(o);
  if (a.io) return { pre: `const at = ${a.js}; `, read: 'e.read(at)', write: v => `e.write(at, ${v})`, io: true };
  return { pre: '', read: `e.mem[${a.js}]`, write: v => `e.mem[${a.js}] = ${v}` };
}

const FLAGS = { zero: 'e.z', carry: 'e.c', negative: 'e.n', overflow: 'e.v' };
const TESTS = { '==': 'e.z', '!=': '!e.z', '>=': 'e.c', '<': '!e.c' };

// One step as JavaScript: { js, kind }. A statement's kind is 'compute', or 'io' if it may reach
// the I/O page; a jump, a call or a return ends a block ('end'); a branch may leave it
// ('branch', with its label); a routine's step is a block of its own ('routine').
function statement(step, k) {
  const w = step.words, [first, second] = w, s = `s[${k}]`;
  const of = (...parts) => ({ js: parts.map(p => p.js ?? p).join(''), kind: parts.some(p => p.io) ? 'io' : 'compute' });
  if (second === '=' && w.length === 3) {
    const v = get(w[2]), o = operand(first);
    if (o.reg === 'carry') return of('e.c = ', v, ' & 1;');
    if (o.reg) return of(`e.${o.reg} = e.flags(`, v, ');');   // a load sets the flags, a store does not
    const p = put(first, v.js);
    return { js: p.js + ';', kind: v.io || p.io ? 'io' : 'compute' };
  }
  if (second === '+=' || second === '-=') {
    const v = get(w[2]);
    if (w.length === 3) {   // an increment or a decrement
      const p = place(first);
      return { js: `${p.pre}${p.write(`e.flags(${p.read} ${second[0]} ${v.js} & 0xff)`)};`, kind: p.io || v.io ? 'io' : 'compute' };
    }
    // with the carry, as ADC and SBC: SBC adds the operand turned over
    return { js: second === '+=' ? `e.add(${v.js});` : `e.sub(${v.js});`, kind: v.io ? 'io' : 'compute' };
  }
  if (second === '&=' || second === '|=' || second === '^=') { const v = get(w[2]); return of(`e.a = e.flags(e.a ${second[0]} `, v, ');'); }
  if (second === '<<=' || second === '>>=' || second === 'rotate') {
    const p = place(first), left = second === '<<=' || w[2] === 'left';
    return { js: `${p.pre}${p.write(`e.shift(${p.read}, ${left}, ${second === 'rotate'})`)};`, kind: p.io ? 'io' : 'compute' };
  }
  switch (first) {
    case 'if': {
      const to = w.at(-1), cond = w.slice(1, -2);
      if (cond.length === 3 && /^[axy]$/.test(cond[0])) { const v = get(cond[2]); return { js: `e.compare(e.${cond[0]}, ${v.js}); if (${TESTS[cond[1]]})`, kind: 'branch', to, io: v.io }; }
      const not = cond[0] === 'not', flag = FLAGS[not ? cond[1] : cond[0]];
      if (!flag) throw new Error(step.where + ': no flag ' + cond.join(' '));
      return { js: `if (${not ? '!' : ''}${flag})`, kind: 'branch', to };
    }
    case 'goto':
      if (w[1].startsWith('(')) return { js: `return e.jumpThrough(${hex(parseInt(w[1].slice(2, -1), 16), 4)}, ${s});`, kind: 'end' };
      if (w[1].startsWith('[')) return { js: `return e.jumpTable(${hex(parseInt(w[1].slice(2), 16), 4)}, e.${w[2][0]});`, kind: 'end' };
      return { js: `return e.jump('${w[1]}', ${s});`, kind: 'end' };
    case 'call':
      if (w[1].startsWith('(')) return { js: `return e.callThrough(${hex(parseInt(w[1].slice(2, -1), 16), 4)}, ${s});`, kind: 'end' };
      return { js: `return e.call('${w[1]}', ${s});`, kind: 'end' };
    case 'return': return { js: `return e.ret(${s});`, kind: 'end' };
    case 'compare': return of(`e.compare(e.${w[1]}, `, get(w[2]), ');');
    case 'test': return of('e.test(', get(w[1]), ');');
    case 'push': return { js: `e.push(${w[1] === 'a'});`, kind: 'compute' };
    case 'pull': return { js: `e.pull(${w[1] === 'a'});`, kind: 'compute' };
    case 'asm': if (w[1] === 'RTI') return { js: `return e.ret(${s});`, kind: 'end' };
      return { js: ['TSX', 'TXS', 'CLV', 'SED', 'CLD', 'SEI', 'CLI'].includes(w[1]) ? `e.asm('${w[1]}');` : '', kind: 'compute' };
  }
  const args = w.slice(1).map(a => typeof a === 'string' ? `'${a}'` : `{ string: ${JSON.stringify(a.string)} }`).join(', ');
  return { js: `return e.routine('${first}', [${args}], ${s});`, kind: 'routine' };
}

export function compile(source, name, { io = [0xc000, 0xc0ff] } = {}) {
  [IO_FROM, IO_TO] = io;
  const { steps, labels, data } = parse(source, name);
  const code = steps.map((step, k) => statement(step, k));
  const starts = new Set([0, ...Object.values(labels)]);
  code.forEach((c, k) => {
    if (c.kind === 'routine' || c.kind === 'io' || c.io) starts.add(k);
    if (c.kind !== 'compute' && c.kind !== 'branch' || c.io) starts.add(k + 1);
  });
  const at = Object.fromEntries(Object.entries(labels).map(([l, k]) => [k, l]));
  const blocks = [];
  for (let k = 0; k < steps.length; k++) {
    if (!starts.has(k)) continue;
    let end = k + 1;
    while (end < steps.length && !starts.has(end)) end++;
    // a branch back to the block's own start: the block is a loop
    const loops = code.slice(k, end).some(c => c.kind === 'branch' && labels[c.to] === k);
    const lines = [];
    for (let i = k; i < end; i++) {
      // the time of the lines to the next branch, or the block's end (a routine's step counts its
      // own call)
      if ((i === k || code[i - 1].kind === 'branch') && code[i].kind !== 'routine') {
        let j = i; while (j < end - 1 && code[j].kind !== 'branch') j++;
        lines.push(`e.time(s, ${i}, ${j});`);
      }
      const c = code[i], text = steps[i].at === null ? steps[i].text : steps[i].at.toString(16).toUpperCase().padStart(4, '0') + '  ' + steps[i].text;
      let js = c.js;
      if (c.kind === 'branch') {
        const t = labels[c.to];
        const more = branchTaken(steps[i]), cy = more === 1 ? 'e.cycles++' : `e.cycles += ${more}`;
        js += t === undefined ? ` { ${cy}; e.pc = e.label('${c.to}'); return; }` : t === k && loops ? ` { ${cy}; continue; }` : ` { ${cy}; e.pc = ${t}; return; }`;
      }
      if (c.kind === 'end') js = `e.pc = ${i + 1}; ` + js;
      lines.push(js ? `${js.padEnd(48)} // ${text}` : `// ${text}`);
    }
    if (code[end - 1].kind !== 'end' && code[end - 1].kind !== 'routine' && end !== k + 1) lines.push(`e.pc = ${end};`);
    const label = at[k] ? `    // ${at[k]}\n` : '';
    // a step alone that gives what it returns: one line
    const one = lines.length === 1 && /^return (.*?);( +\/\/ .*)$/.exec(lines[0]);
    if (one) { blocks.push(`${label}    ${`${k}: (e, s) => ${one[1]},`.padEnd(60)}${one[2].trim() ? ' ' + one[2].trim() : ''}`); continue; }
    const body = loops ? ['for (;;) {', ...lines.map(l => '  ' + l), '  break;', '}'] : lines;
    blocks.push(`${label}    ${k}: (e, s) => {\n${body.map(l => '      ' + l).join('\n')}\n    },`);
  }
  return [
    `// ${name}, compiled from ${name}.scene by moonbase-compile (@moonbase-machines/player/remake/compile.js): compiled`,
    `// again from the scene, never edited`,
    `export default {`,
    `  labels: ${JSON.stringify(labels)},`,
    `  data: [${data.map(d => `\n    [${hex(d.at, 4)}, [${d.bytes.map(b => hex(b)).join(', ')}]],`).join('')}\n  ],`,
    `  steps: [${steps.map(s => `\n    [${s.at === null ? 'null' : hex(s.at, 4)}, ${+s.where.split(':').at(-1)}, ${JSON.stringify(s.text)}],`).join('')}\n  ],`,
    `  run: {`,
    ...blocks,
    `  },`,
    `};`,
    '',
  ].join('\n');
}

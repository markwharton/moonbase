// The lifter: a file's 6502 walked from its entries into a scene script, a step to a line
// (a tool prints them; the remake lifts at need in the browser, card.js).
import { OPS, SIZE, operand, hex } from '@moonbase-machines/mos6502/disasm.js';
import { INLINE as READERS } from '@moonbase-machines/vector/inline.js';
import { TAKES } from './events.js';

// the data after a call, read from the file, with the text quoted so that it reads as one word
export const readers = from => Object.fromEntries(Object.entries(from).map(([k, f]) => [k, (b, at) => { const r = f(i => b[i], at); return { length: r.length, words: k === 'text' || k === 'print' || k === 'say' ? JSON.stringify(r.value) : r.value }; }]));
const INLINE = readers(READERS);

// `stops` are addresses where data begins that is not a table of code addresses, the objects'
// tables and the objects themselves, so that a table of addresses read from the code ends there.
export function lift(bytes, origin, entries, routines, stops = new Set(), inline = INLINE) {
  const INLINE = inline;
  // `seen`: every byte an instruction or its data takes, for what is left as data; an instruction
  // is walked from where it starts, which may be inside another's bytes (the BIT that skips)
  const lines = new Map(), targets = new Set(entries), seen = new Set(), queue = [...entries];
  const inFile = a => a >= origin && a < origin + bytes.length;
  while (queue.length) {
    let pc = queue.pop();
    const regs = {};
    while (inFile(pc) && !lines.has(pc)) {
      seen.add(pc);
      const at = pc - origin, op = OPS[bytes[at]];
      if (op.name === '???') { lines.set(pc, { line: '.byte $' + hex(bytes[at], 2) + '   ; not an instruction', end: pc + 1 }); break; }
      const size = SIZE[op.mode], word = bytes[at + 1] | bytes[at + 2] << 8, ins = bytes.subarray(at, at + size);
      let line = (op.name + ' ' + operand(op.mode, ins, pc)).trim(), next = pc + size, stop = false;
      if (op.mode === 'imm' && 'LDA LDX LDY'.includes(op.name)) regs[op.name[2]] = bytes[at + 1];
      else if (op.name.startsWith('T') || op.name.startsWith('IN') || op.name.startsWith('DE') || op.name.startsWith('LD') || op.name === 'PLA') delete regs[op.name.at(-1)];
      if (op.name === 'JSR' && routines[word]) {
        const r = routines[word], data = INLINE[r]?.(bytes, next - origin);
        const args = ['A', 'X', 'Y'].map(k => regs[k] === undefined ? '' : k + '=' + regs[k]).filter(Boolean).join(' ');
        line = r + (data ? ' ' + data.words : '') + (args && !data ? '   ; ' + args : '');
        if (data) next += data.length;
        for (const k in regs) delete regs[k];
      } else if (op.name === 'JSR') { if (inFile(word)) { targets.add(word); queue.push(word); } for (const k in regs) delete regs[k]; }
      else if (op.name === 'JMP' && op.mode === 'abs') { if (inFile(word)) { targets.add(word); queue.push(word); } else line += '   ; into PART0' + (routines[word] ? ', ' + routines[word] : ''); stop = true; }
      else if (op.name === 'JMP' || op.name === 'RTS' || op.name === 'RTI' || op.name === 'BRK') stop = true;
      else if (op.mode === 'rel') { const t = (pc + 2 + (bytes[at + 1] << 24 >> 24)) & 0xffff; targets.add(t); queue.push(t); }
      // a table of addresses, read low byte then high byte, LDA t,X or t,Y and then LDA t+1 the same
      // way within a few instructions: every address in it that is in the file is code to follow
      if ((op.mode === 'abx' || op.mode === 'aby') && op.name === 'LDA' && inFile(word)) {
        for (let k = at + 3; k < at + 12 && k + 2 < bytes.length; k++) {
          if (bytes[k] !== bytes[at] || (bytes[k + 1] | bytes[k + 2] << 8) !== word + 1) continue;
          const table = [];
          for (let e = word - origin; e + 1 < bytes.length && table.length < 64; e += 2) { if (table.length && stops.has(origin + e)) break; const t = bytes[e] | bytes[e + 1] << 8; if (!inFile(t)) break; table.push(t); }
          line += '   ; a table of ' + table.length + ' addresses';
          for (const t of table) { targets.add(t); queue.push(t); }
          break;
        }
      }
      lines.set(pc, { line, end: next, op: op.name, mode: op.mode, value: size === 2 ? bytes[at + 1] : word, call: op.name === 'JSR' && routines[word] ? { name: routines[word], words: INLINE[routines[word]]?.(bytes, pc + 3 - origin)?.words } : null, stop });
      for (let a = pc + 1; a < next; a++) seen.add(a);
      if (stop) break;
      pc = next;
    }
  }
  const out = [];
  let last = null;
  for (const pc of [...lines.keys()].sort((a, b) => a - b)) {
    if (last !== null && pc !== last) out.push('');
    if (targets.has(pc)) out.push('L' + hex(pc, 4) + ':');
    out.push(hex(pc, 4) + '  ' + lines.get(pc).line);
    last = lines.get(pc).end;
  }
  // what the walk never reached: tables, data, and code reached only through a table
  const left = [];
  for (let a = origin; a < origin + bytes.length; ) { if (seen.has(a)) { a++; continue; } const s = a; while (a < origin + bytes.length && !seen.has(a)) a++; left.push([s, a - s]); }
  return { listing: out.join('\n'), left, reached: seen.size, size: bytes.length, lines, targets };
}

// The lifted code as a scene script, a step to a line, each line starting with the address it
// came from. A call into the engine is a step with its inputs, the loads before it folded in.
// Everything else is a statement on the registers a, x and y, the flags, and memory, written
// $866A for an address, $86E4[y] for one indexed, and ($12)[y] for one through the zero page.
// Each statement sets the flags as its instruction did, so a branch means what it meant:
// a compare and the branch after it are one `if a == 1 goto L8157`, and a branch alone tests a
// flag, `if zero goto L8157`. A jump through a table that the code writes into its own JMP is
// `goto [$86EC y]`. The bytes the walk never reached are kept as `data` lines, up to where the
// objects' tables begin: the objects come from those tables instead.
export function script({ lines, targets, left }, bytes, origin, { stops = new Set(), selfModified = false, memory = false, moved = [] } = {}) {
  const H = (n, w = 4) => '$' + hex(n, w);
  // With `selfModified`, an instruction whose operand the code writes as it runs takes it from
  // memory: an immediate is the byte at its own address, an address is [$0D19], the one the code
  // keeps there, and a jump or a call goes through it. The places written are every address a
  // store, an increment or a shift names; and `moved`, the bytes of instructions seen to change
  // as the original ran (as the pilots find them), however the code wrote them (through a pointer, as
  // Find Me does)
  const written = new Set(moved);
  if (selfModified) for (const r of lines.values()) if (/^(STA|STX|STY|INC|DEC|ASL|LSR|ROL|ROR)$/.test(r.op) && /^(abs|abx|aby)$/.test(r.mode)) written.add(r.value);
  let here = null;   // the address of the instruction being written
  // `memory`: code that other files write into, as the variables' file LIB.VARS, whose every
  // instruction takes its operand from memory
  const own = () => here !== null && (memory || written.has(here + 1) || written.has(here + 2));
  const place = r => {
    const v = r.value;
    if (own() && r.mode === 'imm' && (memory || written.has(here + 1))) return H(here + 1);
    if (own() && /^(abs|abx|aby)$/.test(r.mode)) return '[' + H(here + 1) + ']' + (r.mode === 'abs' ? '' : '[' + r.mode.at(-1) + ']');
    switch (r.mode) {
      case 'imm': return String(v);
      case 'zp': return H(v, 2);
      case 'zpx': return H(v, 2) + '[x]';
      case 'zpy': return H(v, 2) + '[y]';
      case 'abs': return H(v);
      case 'abx': return H(v) + '[x]';
      case 'aby': return H(v) + '[y]';
      case 'izy': return '(' + H(v, 2) + ')[y]';
      case 'izx': return '(' + H(v, 2) + '[x])';
      case 'acc': return 'a';
      default: return '?';
    }
  };
  const label = a => 'L' + hex(a, 4);
  const branch = { BEQ: 'zero', BNE: 'not zero', BCS: 'carry', BCC: 'not carry', BMI: 'negative', BPL: 'not negative', BVS: 'overflow', BVC: 'not overflow' };
  const fused = { BEQ: '==', BNE: '!=', BCS: '>=', BCC: '<' };
  const target = (pc, r) => (pc + 2 + (r.value << 24 >> 24)) & 0xffff;
  const pcs = [...lines.keys()].sort((a, b) => a - b), out = [];
  // An instruction that runs on into the bytes of another, as BIT $01A9 runs over the LDA #1 that
  // a jump to its second byte finds: the next line is not where it goes on, so a goto says where.
  const stopsHere = r => ['JMP', 'RTS', 'RTI'].includes(r.op);
  targets = new Set(targets);
  pcs.forEach((pc, i) => { const r = lines.get(pc); if (r.op && !stopsHere(r) && i + 1 < pcs.length && r.end !== pcs[i + 1] && lines.has(r.end)) targets.add(r.end); });
  let loads = [];   // immediate loads waiting to be folded into the next call
  const flush = () => { for (const [pc, reg, v] of loads) out.push(hex(pc, 4) + '  ' + reg + ' = ' + v); loads = []; };
  let last = null;   // the instruction before, and where it goes on
  for (let i = 0; i < pcs.length; i++) {
    const pc = pcs[i], r = lines.get(pc), next = lines.get(pcs[i + 1]), put = s => out.push(hex(pc, 4) + '  ' + s);
    here = pc;
    if (last && last.op && !stopsHere(last) && last.end !== pc && lines.has(last.end)) { flush(); out.push(hex(last.pc, 4) + '  goto ' + label(last.end)); }
    last = { ...r, pc: pcs[i] };
    if (targets.has(pc)) { flush(); out.push(label(pc) + ':'); }
    if (!r.op) { flush(); put('asm ' + r.line); continue; }
    const reg = r.op.at(-1).toLowerCase();
    if (r.call) {
      const [name, ...fixed] = r.call.name.split(' ');
      const takes = TAKES[name] || '';
      const given = Object.fromEntries(loads.map(([, g, v]) => [g, v]));
      // loads the call does not take stay as statements, before it
      const kept = loads.filter(([, g]) => !takes.includes(g)); loads = kept; flush();
      const args = [...fixed, ...[...takes].map(g => given[g] ?? g)];
      if (name === 'objects' && given.x !== undefined && given.y !== undefined) args.splice(fixed.length, 2, H(given.x | given.y << 8));
      if (name === 'key-at' || name === 'key') args[0] = given.a !== undefined ? JSON.stringify(String.fromCharCode(given.a & 0x7f)) : args[0];
      put([name, ...args, r.call.words ?? ''].join(' ').trim());
      continue;
    }
    switch (r.op) {
      case 'LDA': case 'LDX': case 'LDY':
        if (r.mode === 'imm' && !own()) { loads = loads.filter(([, g]) => g !== reg); loads.push([pc, reg, r.value]); break; }
        // the jump through a table: LDA T,Y  STA J+1  LDA T+1,Y  STA J+2  J: JMP
        if (r.mode === 'aby' || r.mode === 'abx') {
          const [s1, l2, s2, j] = [1, 2, 3, 4].map(k => lines.get(pcs[i + k]));
          if (s1?.op === 'STA' && l2?.op === 'LDA' && l2.value === r.value + 1 && s2?.op === 'STA' && j?.op === 'JMP' && s1.value === pcs[i + 4] + 1 && s2.value === pcs[i + 4] + 2) {
            flush(); put('goto [' + H(r.value) + ' ' + r.mode.at(-1) + ']'); i += 4; last = null; break;
          }
        }
        flush(); put(reg + ' = ' + place(r)); break;
      case 'STA': case 'STX': case 'STY': flush(); put(place(r) + ' = ' + reg); break;
      case 'TAX': case 'TAY': case 'TXA': case 'TYA': flush(); put(r.op[2].toLowerCase() + ' = ' + r.op[1].toLowerCase()); break;
      case 'INX': case 'INY': case 'DEX': case 'DEY': flush(); put(reg + (r.op[0] === 'I' ? ' += 1' : ' -= 1')); break;
      case 'INC': case 'DEC': flush(); put(place(r) + (r.op === 'INC' ? ' += 1' : ' -= 1')); break;
      case 'CLC': case 'SEC': flush(); put('carry = ' + (r.op === 'SEC' ? 1 : 0)); break;
      case 'ADC': flush(); put('a += ' + place(r) + ' + carry'); break;
      case 'SBC': flush(); put('a -= ' + place(r) + ' + borrow'); break;
      case 'AND': flush(); put('a &= ' + place(r)); break;
      case 'ORA': flush(); put('a |= ' + place(r)); break;
      case 'EOR': flush(); put('a ^= ' + place(r)); break;
      case 'ASL': case 'LSR': case 'ROL': case 'ROR': flush(); put(place(r) + ' ' + { ASL: '<<= 1', LSR: '>>= 1', ROL: 'rotate left', ROR: 'rotate right' }[r.op]); break;
      case 'BIT': flush(); put('test ' + place(r)); break;
      case 'CMP': case 'CPX': case 'CPY': {
        flush();
        const who = r.op === 'CMP' ? 'a' : r.op[2].toLowerCase();
        if (next && fused[next.op] && !targets.has(pcs[i + 1])) { put('if ' + who + ' ' + fused[next.op] + ' ' + place(r) + ' goto ' + label(target(pcs[i + 1], next))); i++; last = { ...next, pc: pcs[i] }; }
        else put('compare ' + who + ' ' + place(r));
        break;
      }
      case 'JMP': flush(); if (r.mode === 'abs' && own()) { put('goto (' + H(pc + 1) + ')'); break; } put(r.mode === 'abs' ? (r.value >= origin && r.value < origin + bytes.length ? 'goto ' + label(r.value) : 'goto-engine ' + H(r.value)) : 'goto (' + H(r.value) + ')'); break;
      case 'JSR': flush(); if (own()) { put('call (' + H(pc + 1) + ')'); break; } put(r.value >= origin && r.value < origin + bytes.length ? 'call ' + label(r.value) : 'call-engine ' + H(r.value)); break;
      case 'RTS': flush(); put('return'); break;
      case 'PHA': case 'PLA': case 'PHP': case 'PLP': flush(); put({ PHA: 'push a', PLA: 'pull a', PHP: 'push flags', PLP: 'pull flags' }[r.op]); break;
      case 'NOP': break;
      default:
        if (branch[r.op]) { flush(); put('if ' + branch[r.op] + ' goto ' + label(target(pc, r))); break; }
        flush(); put('asm ' + r.line);
    }
  }
  flush();
  // each run of bytes the walk never reached, up to where the objects begin
  for (const [a, whole] of left) {
    let n = 0; while (n < whole && !(n && stops.has(a + n)) && !stops.has(a)) n++;
    if (!n) continue;
    const row = [];
    for (let k = 0; k < n; k += 16) row.push('data ' + H(a + k) + ' ' + Array.from(bytes.subarray(a - origin + k, a - origin + Math.min(n, k + 16)), b => hex(b, 2)).join(' '));
    out.push('', ...row);
  }
  return out.join('\n') + '\n';
}


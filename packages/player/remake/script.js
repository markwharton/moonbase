// A scene script: the steps of a part or a problem, a step to a line, as a lifter's --script
// writes them and as they are edited after. A line may start with the address in the original
// it came from, which is kept so that the pilots can say where two runs part.
//
//   L8157:                         a label
//   8157  object 3 4 44            a step: the engine's work, with its inputs
//   814F  a = $8235                a statement on the registers a, x, y and memory
//   8152  if zero goto L8157       a branch on a flag, or on a compare: if a == 1 goto L8157
//   data $86E4 01 02 03 04         bytes of the original's tables, at their addresses
//   ; a comment
//
// parse() gives { steps, labels, data }: each step is { at, op, args, text }.

const WORD = /"(?:[^"\\]|\\.)*"|\S+/g;

export function parse(source, name = 'script') {
  const steps = [], labels = {}, data = [];
  source.split('\n').forEach((raw, n) => {
    const line = raw.replace(/^\s+|\s+$/g, '');
    if (!line || line.startsWith(';')) return;
    const where = name + ':' + (n + 1);
    let m;
    if ((m = /^(L[0-9A-F]{4}|[A-Za-z_][\w-]*):$/.exec(line))) { labels[m[1]] = steps.length; return; }
    if ((m = /^data \$([0-9A-F]+)((?: [0-9A-F]{2})+)$/i.exec(line))) { data.push({ at: parseInt(m[1], 16), bytes: m[2].trim().split(' ').map(h => parseInt(h, 16)) }); return; }
    m = /^([0-9A-F]{4})\s+(.*)$/.exec(line);
    const at = m ? parseInt(m[1], 16) : null, body = m ? m[2] : line;
    steps.push({ at, words: words(body), text: body, where, index: steps.length });
  });
  return { steps, labels, data };
}

// a line's words, a quoted one as { string }
export const words = body => body.match(WORD).map(w => w.startsWith('"') ? { string: JSON.parse(w) } : w);

// an operand: a number, a register, a flag, or a place in memory; [$0D19] is the address the
// code keeps at $0D19 and $0D1A, written there as it runs, as an instruction's own operand is
//   12  a  x  y  carry  $866A  $86E4[y]  $12[x]  ($12)[y]  ($12[x])  [$0D19][y]
export function operand(word) {
  if (typeof word !== 'string') return { string: word.string };
  if (/^-?\d+$/.test(word)) return { number: +word };
  if (/^[axy]$/.test(word) || word === 'carry' || word === 'borrow') return { reg: word };
  let m;
  if ((m = /^\$([0-9A-F]+)(?:\[([xy])\])?$/i.exec(word))) return { at: parseInt(m[1], 16), index: m[2], zp: m[1].length <= 2 };
  if ((m = /^\(\$([0-9A-F]{2})\)\[y\]$/i.exec(word))) return { through: parseInt(m[1], 16) };
  // ($27[x]): the address kept at the zero page's $27 plus X, as LDA ($27,X)
  if ((m = /^\(\$([0-9A-F]{2})\[x\]\)$/i.exec(word))) return { pair: parseInt(m[1], 16) };
  if ((m = /^\[\$([0-9A-F]{4})\](?:\[([xy])\])?$/i.exec(word))) return { via: parseInt(m[1], 16), index: m[2] };
  throw new Error('not an operand: ' + word);
}

// The cycles a branch takes more when it goes: one, and one more when it goes to another page
// than the instruction after it. A line that compares and branches (if a != 13 goto L) is two
// instructions, the compare's size before the branch's.
const SIZE = w => /^\d+$/.test(w) || /^\$[0-9A-F]{2}(\[[xy]\])?$/i.test(w) || /^\(\$/.test(w) ? 2 : 3;
export function branchTaken(step) {
  if (step.at === null) return 1;
  const w = step.words, to = parseInt(w.at(-1).slice(1), 16);
  const next = (step.at + (w.length === 6 ? SIZE(w[3]) : 0) + 2) & 0xffff;
  return /^L[0-9A-F]{4}$/.test(w.at(-1)) && (to & 0xff00) !== (next & 0xff00) ? 2 : 1;
}

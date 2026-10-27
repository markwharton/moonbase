// A BASIC program made from the disk as the page loads, where a title's driver says a script is one (its title.js
// `basic[name].program`): the file it is in, loaded where the original loaded it, read as statements, BASIC's own text
// (@moonbase-machines/c64/basic-lang.js) or Blitz!'s compiled code (`blitz`, @moonbase-machines/c64/blitz.js), and
// compiled to JavaScript (@moonbase-machines/c64/basic-compile.js). With `fixed`, the title's own fixes (its `fixes`
// module, `fixed(statements, render)`) are made to the statements first, and the program takes the fixed version's
// name. The time a statement costs is each kind's own, a Blitz! instruction's or a BASIC line's, unless the driver
// gives one (`cost`).
//
//   basic: { game: { program: { file: 'GAME' }, blitz: true, ... }, boot: { program: { file: 'GOLDFIELDS', at: 0x0801 } } }
//   fixed: { game: 'game-fixed' }, fixes: 'fixes'
import { Drive } from '@moonbase-machines/c64/drive.js';
import { instantiate } from '@moonbase-machines/c64/basic-compile.js';
import { lines } from '@moonbase-machines/c64/basic-lang.js';
import { statements, render } from '@moonbase-machines/c64/blitz.js';

const COST = { blitz: 150, basic: 2000 };

// a file of the disk as it loads: memory with its bytes where they go, at the address the file carries unless the
// driver gives one (the drive the engine will use, card.js)
function file(title, disk, name, at) {
  const found = (title.drive ??= new Drive(Uint8Array.from(atob(disk.image), c => c.charCodeAt(0)))).find(Uint8Array.from(name, c => c.charCodeAt(0)));
  if (!found) throw new Error(`no file ${name} on the disk`);
  const raw = found.raw, mem = new Uint8Array(0x10000);
  at ??= raw[0] | raw[1] << 8;
  mem.set(raw.subarray(2), at);
  return { mem, at };
}

export async function program(title, disk, name, { program: p, blitz, cost }, fixed, folder) {
  const { mem, at } = file(title, disk, p.file, p.at);
  const all = blitz ? statements(mem).out : lines(mem, at);
  const fixes = fixed && title.fixes ? (await import(new URL(title.fixes + '.js', folder).href)).fixed : null;
  const source = `${p.file}, ${blitz ? "Blitz!'s code" : "BASIC's text"}${fixes ? ', with its bugs fixed' : ''}`;
  return instantiate(fixes ? fixes(all, render) : all, { name: fixed || name, source, mem, cost: cost ?? COST[blitz ? 'blitz' : 'basic'], render });
}

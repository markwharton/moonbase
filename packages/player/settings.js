// A person's settings: what the player, its engines and a site's pages let a person choose (the sound, the printer,
// the old style text, a page's own choices), each declared where it acts, in one shape, and kept through the provider
// (provider.js) on a disk of the owner's, settings/<owner>, where the person's files go. The store is typed against
// the declarations: only a declared setting can be read or kept, every value checked against its type. Nothing here
// knows of an address: a site that lets its address set a setting for a visit reads it itself and gives the value.
//
// A declaration: { name, type, default, owner, words, labels?, title? }
//   name     its name, in the store's file (and for a site, in whatever sets it for a visit)
//   type     'boolean', or an array of its fixed values, an enum
//   default  its value where nothing gives one
//   owner    whose it is: 'person' (the only owner yet; a parent's or teacher's later is another layer here, with
//            nothing changed where the setting is declared)
//   words    what its control calls it; labels, an enum's values' words in order; title, a note on the control
//
//   check(type, value)       whether a value is of the type
//   describe(type)           the type in words, for saying what was refused
//
//   const settings = settingsStore({ disks, visit, fixed, hidden })
//     disks     { owner: disk }, the owner's settings disk (settings/<owner>), opened by the provider; its one file,
//               `settings`, the values by name
//     visit     def => a value for this visit, or undefined: the site's, from wherever it lets a visit set one (its
//               address, say); checked here, a value not of the type refused and said once; never kept
//     fixed     { name: value }, what the page fixes, over everything; hidden, [name], what it does not offer
//   settings.get(def)          its value: the page's fixed one, else the visit's, else the kept one where it is of
//                              the type (one that is not falls back, said), else its default
//   settings.set(def, value)   kept, for the next visit; a promise, kept when stored (a value not of the type throws)
//   settings.offered(def)      whether its control is shown: not where the page hides it or fixes it
import { textBytes, bytesText } from './disk/disk.js';

const FILE = 'settings';

export function check(type, value) {
  if (Array.isArray(type)) return type.includes(value);
  if (type === 'boolean') return typeof value === 'boolean';
  throw new Error('settings: no such type: ' + JSON.stringify(type));
}

export const describe = type => Array.isArray(type) ? 'one of ' + type.map(v => v === '' ? 'nothing' : v).join(', ') : 'on or off';

export function settingsStore({ disks, visit = () => undefined, fixed = {}, hidden = [] }) {
  const said = new Set();
  const say = (key, what) => { if (!said.has(key)) { said.add(key); console.warn(what); } };
  const layers = Object.fromEntries(Object.entries(disks).map(([owner, disk]) => {
    let kept = null;
    try { kept = JSON.parse(bytesText(disk.read(FILE)) ?? '{}'); } catch {}
    return [owner, { disk, kept: kept && typeof kept === 'object' && !Array.isArray(kept) ? kept : {} }];
  }));
  // (the declaration itself checked as it is first met: its owner has a store here, its default is of its type)
  const seen = new Set();
  const layer = def => {
    const l = layers[def.owner];
    if (!l) throw new Error(`settings: no store for the owner ${def.owner} (${def.name})`);
    if (!seen.has(def.name)) { seen.add(def.name); if (!check(def.type, def.default)) throw new Error(`settings: ${def.name}'s default ${JSON.stringify(def.default)} is not ${describe(def.type)}`); }
    return l;
  };
  return {
    get(def) {
      const l = layer(def);
      if (def.name in fixed) {
        if (!check(def.type, fixed[def.name])) throw new Error(`settings: ${def.name} fixed at ${JSON.stringify(fixed[def.name])}, not ${describe(def.type)}`);
        return fixed[def.name];
      }
      const v = visit(def);
      if (v !== undefined) {
        if (check(def.type, v)) return v;
        say('visit ' + def.name, `${def.name}: ${JSON.stringify(v)} for this visit refused: not ${describe(def.type)}`);
      }
      if (def.name in l.kept) {
        if (check(def.type, l.kept[def.name])) return l.kept[def.name];
        say('kept ' + def.name, `${def.name}: the kept ${JSON.stringify(l.kept[def.name])} is not ${describe(def.type)}; its default used`);
      }
      return def.default;
    },
    set(def, value) {
      const l = layer(def);
      if (!check(def.type, value)) throw new Error(`settings: ${def.name} cannot be ${JSON.stringify(value)}: not ${describe(def.type)}`);
      l.kept[def.name] = value;
      return l.disk.write(FILE, textBytes(JSON.stringify(l.kept)));
    },
    offered: def => !hidden.includes(def.name) && !(def.name in fixed),
  };
}

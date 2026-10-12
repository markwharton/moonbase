// A data disk to save games on, for a title that saves them (Detect-A-Pet): a ProDOS volume of
// its own in a drive beside the game's, its files kept in this browser's local storage, so a
// game saved is there after the page is loaded again.
//
//   const game = withSaves(slug, await (await fetch(...)).json())   before the machine starts
//   keepSaves(slug, files)                                          the machine's Files (mli.js)
export const SAVES = { 'detect-a-pet': 'SAVES' };

const key = slug => 'moonbase-saves-' + slug;
const load = slug => { try { return JSON.parse(localStorage.getItem(key(slug)) ?? '{}'); } catch { return {}; } };

// the game's disks with the data disk too, its files as they were last kept
export function withSaves(slug, game) {
  const name = SAVES[slug];
  if (!name) return game;
  return { ...game, volumes: { ...game.volumes, [name]: load(slug) } };
}

// after each call that changes a file, the data disk's files kept again
const CHANGES = new Set([0xc0, 0xc1, 0xcb, 0xcc, 0xd0]);   // CREATE, DESTROY, WRITE, CLOSE, SET_EOF
export function keepSaves(slug, files) {
  const name = SAVES[slug];
  if (!name || files.kept) return;
  files.kept = true;
  const call = files.call.bind(files);
  files.call = (cmd, ...rest) => {
    const r = call(cmd, ...rest);
    if (CHANGES.has(cmd)) {
      const out = {};
      for (const f of files.files.values()) if (f.volume.toUpperCase() === name) out[f.path] = { type: f.type, aux: f.aux, data: btoa(String.fromCharCode(...f.body)) };
      try { localStorage.setItem(key(slug), JSON.stringify(out)); } catch {}
    }
    return r;
  };
}

// The disk's own dialogs, the same in every game that hands saving to the system (as Aztlan for Macintosh
// handed it to the Mac's): a game is saved by name, and opened from the disk's list, or from a file
// downloaded before. A game that asks on its own screen (the 8-bit games) keeps its own prompt; the disk
// only keeps what it saves. Each is a modal window (../modal.js) opened where the game says, its host: in
// its screen, in the frame its own windows have (Aztlan's, window definition 1, the Mac's dialog box), and
// so looking as its own windows look; with no host, on the page, as the site's (site/assets/site.css).
//
//   const { saveAs, openFrom, ask, tell } = dialogs({ within, className })   the game's host
//   await saveAs(disk, { suggested })      a name, or null: offers to replace a file of that name
//   await openFrom(disk, { file })         { name, bytes } from the disk, or null: the disk's manager, the
//                                          same for every game, its games listed, each to open, download
//                                          or delete, and a downloaded one put back on it from a file
//                                          (`file`, the game's own: { extension, type }, '.zip' and its type)
//   await ask(heading, body, buttons, { aside })   a dialog of a game's own: [label, value] buttons, the
//                                          last the default, a function's value what it returns; `aside`,
//                                          buttons of the dialog's own on the same line, at its left
//   await tell(heading)                    a word, and OK
import { modal } from '../modal.js';

export function dialogs({ within, className = '' } = {}) {
  function ask(heading, body, buttons, { aside = [] } = {}) {
    return new Promise(done => {
      const content = document.createElement('div'); content.className = 'disk';
      const h = document.createElement('h2'); h.textContent = heading;
      const row = document.createElement('p'); row.className = 'buttons';
      for (const [label, value] of buttons) {
        const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label });
        b.onclick = async () => { m.close(); done(typeof value === 'function' ? await value() : value); };
        row.append(b);
      }
      row.lastChild?.classList.add('default');
      if (aside.length) { const left = document.createElement('span'); left.className = 'aside'; left.append(...aside); row.prepend(left); }
      content.append(h, ...body, row);
      // (Escape: nothing chosen)
      const m = modal({ within, className, content, cancel: () => { m.close(); done(null); } });
    });
  }
  const tell = heading => ask(heading, [], [['OK', null]]);

  async function saveAs(disk, { suggested = '' } = {}) {
    const input = Object.assign(document.createElement('input'), { value: suggested, maxLength: 31 });
    setTimeout(() => input.select());
    const label = document.createElement('label'); label.append('Save as ', input);
    const name = await ask('Save', [label, ...keptNote(disk)], [['Cancel', null], ['Save', () => input.value.trim() || null]]);
    if (!name) return null;
    if (disk.read(name) && !await ask(`Replace "${name}"?`, [], [['Cancel', false], ['Replace', true]])) return null;
    return name;
  }

  async function openFrom(disk, { file: { extension = '', type = 'application/octet-stream' } = {} } = {}) {
    const select = Object.assign(document.createElement('select'), { size: 6 });
    const note = document.createElement('p'); note.className = 'note';
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: [extension, type].filter(Boolean).join(','), hidden: true });
    const button = text => Object.assign(document.createElement('button'), { type: 'button', textContent: text });
    const from = button('File…'), download = button('Download'), remove = button('Delete');
    const fill = () => {
      select.replaceChildren(...disk.list().map(f => new Option(`${f.name}  ·  ${new Date(f.modified).toLocaleString()}`, f.name)));
      select.selectedIndex = select.options.length ? 0 : -1;
      select.hidden = !select.options.length;
      note.textContent = select.options.length ? 'On your disk:' : 'Nothing saved on your disk yet.';
      remove.disabled = download.disabled = !select.options.length;
    };
    fill();
    const chosen = ask('Open', [note, select, input, ...keptNote(disk)], [['Cancel', null], ['Open', () => select.value || null]], { aside: [from, download, remove] });
    const open = () => select.closest('.modal').querySelector('.default').click();
    // (File…: a game downloaded before, put back on the disk by its file's name, and opened)
    from.onclick = () => input.click();
    input.onchange = async () => {
      const f = input.files[0], n = f.name.slice(0, f.name.length - (extension && f.name.endsWith(extension) ? extension.length : 0));
      if (disk.read(n) && !await ask(`Replace "${n}"?`, [], [['Cancel', false], ['Replace', true]])) return;
      disk.write(n, new Uint8Array(await f.arrayBuffer()));
      fill(); select.value = n; open();
    };
    // (a game taken off the disk as its file, to keep, or for the original: Aztlan's for Infinite Mac)
    download.onclick = () => {
      const n = select.value; if (!n) return;
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([disk.read(n)], { type })), download: n + extension });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    // (a file deleted only once asked, in a dialog over this one, Cancel its default)
    remove.onclick = async () => {
      const n = select.value; if (!n) return;
      if (!await ask(`Delete "${n}"?`, [warning('It is gone from your disk for good.')], [['Delete', true], ['Cancel', false]])) return;
      await disk.remove(n); fill(); select.focus();
    };
    select.ondblclick = open;
    const name = await chosen;
    return name ? { name, bytes: disk.read(name) } : null;
  }
  return { saveAs, openFrom, ask, tell };
}

const warning = text => Object.assign(document.createElement('p'), { className: 'note', textContent: text });

// (where the browser keeps nothing, a word saying so: the game is there until the page closes)
function keptNote(disk) {
  if (disk.kept) return [];
  const p = document.createElement('p'); p.className = 'note';
  p.textContent = 'This browser is not keeping files: download a game to keep it.';
  return [p];
}

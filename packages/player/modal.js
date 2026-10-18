// A modal window, the one way every dialog and window over a game is shown: the disk's dialogs
// (disk/dialogs.js) and a program's own windows (Aztlan's help and About box, its macapp.js). It opens
// inside the place it is given, the game's screen, not over the whole page: what it covers is that place
// alone, which scrolls with it, and the rest of the page is the page's. Its frame and look are the place's
// (a class, as Aztlan's window definition 1 has it, and the place's own styles); without a place, the page.
//
//   const m = modal({ within, className, content, cancel })
//     within     the element it opens in (positioned), else the page
//     className  its frame's classes
//     content    what it shows
//     cancel()   what Escape does (closing it, else)
//   m.box, m.close()
// While it is open the rest of `within` is inert, and the keys are the topmost one's, wherever the focus
// is (WebKit leaves it on the page when a button is clicked): Escape cancels; Return presses its default
// button (`.default`), unless on a button, or in a box that takes Return itself; Tab stays inside it. When
// it closes the focus goes back where it was, or into the window under it.
const open = [];
// (listened for from the first one opened: a module the tests load in Node, with no page)
let listening = false;
const keys = e => {
  const m = open.at(-1);
  if (!m) return;
  if (e.key === 'Escape') { e.preventDefault(); m.cancel(); }
  else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement) && e.target.tagName !== 'TEXTAREA') {
    const d = m.box.querySelector('.default:not(:disabled)');
    if (d) { e.preventDefault(); d.click(); }
  }
  else if (e.key === 'Tab') {
    const f = focusable(m.box), at = f.indexOf(document.activeElement);
    if (f.length) { e.preventDefault(); f[(at + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus(); }
  }
  // (the game under it has none of the keys)
  e.stopPropagation();
};
const focusable = box => [...box.querySelectorAll('button:not(:disabled), input:not([type=hidden]):not([type=file]):not([hidden]), select:not([hidden]), [tabindex="0"]')];
const first = box => box.querySelector('input:not([type=file]), select:not([hidden])') ?? box.querySelector('.default') ?? focusable(box)[0];

export function modal({ within = document.body, className = '', content, cancel = null }) {
  if (!listening) { document.addEventListener('keydown', keys, true); listening = true; }
  const layer = document.createElement('div');
  layer.className = 'modal-layer' + (within === document.body ? ' page' : '');
  const box = document.createElement('div');
  box.className = 'modal ' + className;
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  box.append(content); layer.append(box);
  const before = document.activeElement;
  const others = [...within.children].filter(el => !el.inert);
  for (const el of others) el.inert = true;
  within.append(layer);
  const m = {
    box,
    cancel: () => (cancel ?? m.close)(),
    close() {
      layer.remove();
      open.splice(open.indexOf(m), 1);
      for (const el of others) el.inert = false;
      const under = open.at(-1);
      (under && !under.box.contains(before) ? first(under.box) : before)?.focus?.({ preventScroll: true });
    },
  };
  open.push(m);
  // (the first box to type in or list to choose from, else the default button, has the focus)
  first(box)?.focus({ preventScroll: true });
  return m;
}

// whether a modal window is open: a game's keys and commands wait while one is
export const modalOpen = () => open.length > 0;

// A Commodore 64 (machine.js) in a browser page: each key one key of the C64's matrix and nothing else, the arrows its
// cursor keys, Escape RUN/STOP, Control the Commodore key, Tab CTRL; the joystick a gamepad plugged in (an 8BitDo, or
// any in the browser's standard mapping), never a key; the frame painted on a canvas doubled; and the machine run 50
// frames a second, keeping up with the clock, two frames at most at a time.
//
//   const keys = keyboard(m, { ignore, onKey, log, listen })   ignore(e): a key the page keeps (a pane's); listen(type,
//                                                      f), where its keys come from (the window's, unless a player gives
//                                                      its own)
//   keys.press(column, row, frames)                    a key held for so many frames (RUN/STOP)
//   const draw = painter(canvas)                       draw(m.vic.frame)
//   pace(m, after)                                     the frames run; after() each animation frame
import { MATRIX, SHIFTED, WITH_SHIFT, CURSOR, MODIFIERS } from './keys.js';
import { PALETTE, WIDTH, HEIGHT } from './vic.js';

const PAD_DEAD = 0.4;   // a stick pushed less far than this is at rest (the dead zone)

export function keyboard(m, { ignore = () => false, onKey = () => {}, log = false, listen = (type, f) => window.addEventListener(type, f) } = {}) {
  // (a letter by the key it is, not the character the browser makes of it: in the C64's first
  // character set, capitals and graphics, a letter is a letter, Shift or Caps Lock or not, and
  // Option with it is its graphic, the C64's shifted letter; in the second, small letters and
  // capitals, Shift is a capital, as on the C64)
  const upper = () => !((m.vic?.r[0x18] ?? 0x15) & 2);
  // (a key let go within two frames of going down is held to the end of them: the KERNAL scans
  // the keyboard once a frame, and a tap shorter than that, which a real key never is, would
  // never be seen)
  const down = new Map(), held = [], pressed = new Map(), withCbm = new Set();
  let frame = 0;
  const release = (key, shift) => {
    const since = frame - (pressed.get(key) ?? -9);
    if (since >= 2) { m.key(key[0], key[1], false); if (shift) m.key(1, 7, false); return; }
    held.push([key[0], key[1], 2 - since]); if (shift) held.push([1, 7, 2 - since]);
  };
  listen('keydown', e => {
    if (ignore(e)) return;
    onKey(e);
    if (e.metaKey || e.repeat) return;
    if (MODIFIERS[e.key]) { m.key(...MODIFIERS[e.key], true); e.preventDefault(); }
    const letter = /^Key([A-Z])$/.exec(e.code)?.[1]?.toLowerCase(), cursor = CURSOR[e.key];
    const shifted = letter || cursor ? null : SHIFTED[e.key], key = cursor ? cursor.slice(0, 2) : letter ? MATRIX[letter] : shifted ? MATRIX[shifted] : MATRIX[e.key] || MATRIX[e.key.toLowerCase()];
    if (!key) { if (MODIFIERS[e.key]) e.preventDefault(); return; }
    // (the left shift: a letter's graphic, a shifted sign, the cursor going up or left, and Shift with a function key,
    // Home or DEL, F2, F4, F6 and F8, CLR and INST being shift with F1, F3, F5 and F7, HOME and DEL on the 64)
    if (cursor ? cursor[2] : letter ? (upper() ? e.altKey : e.shiftKey) : shifted || (e.key.length === 1 && e.key !== e.key.toLowerCase() && !/[0-9]/.test(e.key)) || (e.shiftKey && WITH_SHIFT.test(e.key))) m.key(1, 7, true);
    // (Control held, as the event says, the Commodore key down with the key, if Control's own
    // keydown has not put it there, and let go with it)
    const [cc, cr] = MODIFIERS.Control, cbm = e.ctrlKey && !(m.keys[cc] & 1 << cr) ? MODIFIERS.Control : null;
    if (cbm) { m.key(...cbm, true); pressed.set(cbm, frame); }
    m.key(key[0], key[1], true); down.set(e.code, key); pressed.set(key, frame); if (cbm) withCbm.add(e.code);
    if (log) console.log('key', JSON.stringify(e.key), '-> column', key[0], 'row', key[1]);
    e.preventDefault();
  });
  listen('keyup', e => {
    if (MODIFIERS[e.key]) m.key(...MODIFIERS[e.key], false);
    const key = down.get(e.code);
    if (key) { release(key, true); if (withCbm.delete(e.code)) release(MODIFIERS.Control, false); down.delete(e.code); } else m.key(1, 7, false);
  });
  // the page left (another window, another tab, Cmd-Tab): the browser sends no keyup for what was
  // held, so everything is let go, the keys, the joystick and fire, or a key (CTRL by Tab) would stay
  // down and every key after it be read wrongly
  const letGo = () => { m.keys.fill(0); m.joystick = 0; down.clear(); held.length = 0; pressed.clear(); withCbm.clear(); padBits = 0; padStop = false; };
  // a gamepad, read each frame in the browser's standard mapping: the D-pad or the left stick
  // (pushed past PAD_DEAD) the joystick in port 2, A or B its fire, Start RUN/STOP; let go with the
  // pad
  let padBits = 0, padStop = false;
  const readPads = () => {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
    let bits = 0, stop = false;
    for (const p of navigator.getGamepads()) {
      if (!p || !p.connected) continue;
      const b = i => !!p.buttons[i]?.pressed, x = p.axes[0] ?? 0, y = p.axes[1] ?? 0;
      if (b(12) || y < -PAD_DEAD) bits |= 1;
      if (b(13) || y > PAD_DEAD) bits |= 2;
      if (b(14) || x < -PAD_DEAD) bits |= 4;
      if (b(15) || x > PAD_DEAD) bits |= 8;
      if (b(0) || b(1)) bits |= 16;
      if (b(9)) stop = true;
    }
    m.joystick = (m.joystick & ~padBits) | bits; padBits = bits;
    if (stop !== padStop) { m.key(7, 7, stop); padStop = stop; }
  };
  window.addEventListener('blur', letGo);
  document.addEventListener('visibilitychange', () => { if (document.hidden) letGo(); });
  return {
    // a key held for so many frames, then let go (frame() lets them go)
    press(column, row, frames = 3) { m.key(column, row, true); held.push([column, row, frames]); },
    frame() { frame++; readPads(); for (let i = held.length - 1; i >= 0; i--) if (--held[i][2] <= 0) { m.key(held[i][0], held[i][1], false); held.splice(i, 1); } },
  };
}

export function painter(canvas) {
  const ctx = canvas.getContext('2d');
  canvas.width = WIDTH * 2; canvas.height = HEIGHT * 2;
  const rgba = new Uint8ClampedArray(WIDTH * 2 * HEIGHT * 2 * 4), image = new ImageData(rgba, WIDTH * 2, HEIGHT * 2);
  return f => {
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      const [r, g, b] = PALETTE[f[y * WIDTH + x]];
      for (let dy = 0; dy < 2; dy++) { let o = (((y * 2 + dy) * WIDTH * 2) + x * 2) * 4; for (let dx = 0; dx < 2; dx++) { rgba[o++] = r; rgba[o++] = g; rgba[o++] = b; rgba[o++] = 255; } }
    }
    ctx.putImageData(image, 0, 0);
  };
}

// the C64's 50 frames a second, kept up with the clock (two at most at a time, so a tab left in
// the background does not run on and on when it comes back); each(frame) after each one run
export function pace(m, after, each = () => {}) {
  let frames = 0;
  const started = performance.now();
  function tick() {
    const due = Math.min(2, Math.floor((performance.now() - started) / 20) - frames);
    for (let i = 0; i < due; i++) { m.runFrame(); frames++; each(frames); }
    after(frames);
    requestAnimationFrame(tick);
  }
  tick();
}

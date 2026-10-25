// The browser's keys as the C64's keyboard matrix, column then row: each key one key of the 64's, and nothing else.
// The joystick in port 2 is a joystick, a gamepad plugged in (browser.js), never a key.
export const MATRIX = {
  Backspace: [0, 0], Delete: [0, 0], Enter: [0, 1], F7: [0, 3], F1: [0, 4], F3: [0, 5], F5: [0, 6],
  '3': [1, 0], w: [1, 1], a: [1, 2], '4': [1, 3], z: [1, 4], s: [1, 5], e: [1, 6],
  '5': [2, 0], r: [2, 1], d: [2, 2], '6': [2, 3], c: [2, 4], f: [2, 5], t: [2, 6], x: [2, 7],
  '7': [3, 0], y: [3, 1], g: [3, 2], '8': [3, 3], b: [3, 4], h: [3, 5], u: [3, 6], v: [3, 7],
  '9': [4, 0], i: [4, 1], j: [4, 2], '0': [4, 3], m: [4, 4], k: [4, 5], o: [4, 6], n: [4, 7],
  '+': [5, 0], p: [5, 1], l: [5, 2], '-': [5, 3], '.': [5, 4], ':': [5, 5], '@': [5, 6], ',': [5, 7],
  '£': [6, 0], '\\': [6, 0], '*': [6, 1], ';': [6, 2], Home: [6, 3], '=': [6, 5], '^': [6, 6], '/': [6, 7],
  '1': [7, 0], _: [7, 1], '`': [7, 1], '2': [7, 3], ' ': [7, 4], q: [7, 6], Escape: [7, 7],
};
// (the 64's £ also on \ and its ← also on `, where a Mac's keyboard has them: £ near the top right, ← at the top left,
// as the 64's are; and ← on _ as before)
// keys that need shift on the C64: the shifted character (or function key) and its unshifted key
export const SHIFTED = { '!': '1', '"': '2', '#': '3', '$': '4', '%': '5', '&': '6', "'": '7', '(': '8', ')': '9', '?': '/', '<': ',', '>': '.', '[': ':', ']': ';',
  F2: 'F1', F4: 'F3', F6: 'F5', F8: 'F7' };   // (F2, F4, F6 and F8 are shift with F1, F3, F5 and F7 on the 64)
// keys that Shift with them makes the 64's shifted key: the function keys (F2, F4, F6, F8), Home (CLR), DEL (INST)
export const WITH_SHIFT = /^(F[1357]|Home|Backspace|Delete)$/;
// the C64's own modifier keys, where VICE puts them: Control the Commodore key, Tab CTRL
export const MODIFIERS = { Control: [7, 5], Tab: [7, 2] };
// the arrow keys are the cursor keys: down and right, and with shift, up and left
export const CURSOR = { ArrowDown: [0, 7, 0], ArrowRight: [0, 2, 0], ArrowUp: [0, 7, 1], ArrowLeft: [0, 2, 1] };

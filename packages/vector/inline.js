// The data the engine's routines take inline, after the call: the text routine's text, the
// picture routine's name and the sound routine's five bytes. `read` gives the byte at an
// address, so the same reading works on a file and on a running machine's memory. Each returns
// { length, value }: how many bytes the data takes, and what it says.

// Text: ASCII with the high bit set, $8D a new line, $80 the end. $1B comes before a code, and a
// code takes 0, 1, 2 or 4 bytes after it: $0F and $0C take two, $06 and $0B four, $07 to $0A,
// $0D, $0E, $10 and $11 none, and every other code one. A code is kept in the text in braces,
// {6:42,86,69,86}, its number and its bytes in hexadecimal, so that nothing is lost.
export function text(read, at) {
  let s = '', i = at;
  for (let guard = 0; guard < 4096; guard++) {
    const c = read(i++);
    if (c === undefined || c === 0x80) break;
    if (c === 0x1b) {
      const code = read(i++);
      const n = code === 0x0f || code === 0x0c ? 2 : code === 0x06 || code === 0x0b ? 4 : [7, 8, 9, 10, 13, 14, 16, 17].includes(code) ? 0 : 1;
      const bytes = []; for (let k = 0; k < n; k++) bytes.push(read(i + k).toString(16));
      s += '{' + code.toString(16) + (n ? ':' + bytes.join(',') : '') + '}';
      i += n; continue;
    }
    s += c === 0x8d ? '\n' : String.fromCharCode(c & 0x7f);
  }
  return { length: i - at, value: s };
}

// A picture's name: a length with the high bit set, then the name in small letters with
// underscores for spaces.
export function name(read, at) {
  const n = read(at) & 0x7f;
  let s = ''; for (let k = 1; k <= n; k++) s += String.fromCharCode(read(at + k) & 0x7f);
  return { length: n + 1, value: s };
}

// A sound: the end pitch, the start pitch, the clicks a step, the step and the repeats.
export function sound(read, at) {
  const b = []; for (let k = 0; k < 5; k++) b.push(read(at + k).toString(16));
  return { length: 5, value: b.join(' ') };
}

export const INLINE = { text, picture: name, sound };

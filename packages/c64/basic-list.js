// A Commodore BASIC V2 program as text, a line to a line: each line as the 64's own LIST prints it (basic-lang.js
// list, from its ROM at $A71A, its oddities kept), then as moonbase's listings write PETSCII (petscii.js text: the
// control characters by their names in braces). A program is lines, each the address of the next line, the line
// number, then the line, ending in a zero; two zeros end it. `lower`: the letters as the second character set
// shows them.
//
//   listing(bytes, { lower })   the program's text (its bytes after the load address)
import { list } from './basic-lang.js';
import { text } from './petscii.js';

export function listing(bytes, { lower = false } = {}) {
  const lines = [];
  for (let at = 0; at + 4 <= bytes.length && (bytes[at] | bytes[at + 1] << 8); ) {
    const number = bytes[at + 2] | bytes[at + 3] << 8;
    let end = at + 4;
    while (end < bytes.length && bytes[end]) end++;
    lines.push(number + ' ' + text(list(bytes.subarray(at + 4, end)), { lower }));
    at = end + 1;
  }
  return lines.join('\n') + '\n';
}

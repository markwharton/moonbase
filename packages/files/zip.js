// A zip read, in Node: its central directory, at the end, names each file, its sizes and where its local header
// is (a local header may leave the sizes as zero); each file's data follows its local header's 30 bytes, its name
// and its extra field, stored as it is (method 0) or deflated (method 8).
//
//   unzip(zip)            every file, [{ name, body, method }] (a folder's entry left out; a method other than
//                         0 or 8, its body null)
//   fromZip(zip, wanted)  the first file whose name `wanted` (a RegExp) matches, outside a Mac's __MACOSX folder:
//                         { name, body }; an error when none does
import { inflateRawSync } from 'node:zlib';

export function unzip(zip) {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a zip');
  const files = [];
  for (let at = zip.readUInt32LE(end + 16), n = zip.readUInt16LE(end + 10); n--; ) {
    const method = zip.readUInt16LE(at + 10), size = zip.readUInt32LE(at + 20), nameLength = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30), comment = zip.readUInt16LE(at + 32), local = zip.readUInt32LE(at + 42);
    const name = zip.toString('latin1', at + 46, at + 46 + nameLength);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28), data = zip.subarray(start, start + size);
    if (!name.endsWith('/')) files.push({ name, body: method === 0 ? data : method === 8 ? inflateRawSync(data) : null, method });
    at += 46 + nameLength + extra + comment;
  }
  return files;
}

export function fromZip(zip, wanted) {
  const f = unzip(zip).find(f => wanted.test(f.name) && !f.name.startsWith('__MACOSX'));
  if (!f) throw new Error('nothing in the zip matches ' + wanted);
  return { name: f.name, body: f.body };
}

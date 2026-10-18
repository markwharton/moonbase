// The player's disk: the files a person makes, kept by name on a disk of their own, one for each title
// and one for each program that saves (Microsoft BASIC's tape and disk, the editors). Every game and
// program that saves does so here, and only here; its files are its own bytes, in its own format, with
// what the format needs beside them (`meta`, a ProDOS file's type and aux).
//
// A disk is read whole when it is opened, before the program starts, and kept in memory: the machines
// read files at once, inside an instruction (@moonbase-machines/apple2e/machine.js's MLI call,
// @moonbase-machines/c64/drive.js's find), so a read is never waited for. A write changes the copy at once and is stored behind
// it, in order.
//
//   const disk = await openDisk(name, { backend })   backend: local() (local.js, the default)
//                                                     or memory() (memory.js)
//   disk.list()                 [{ name, size, modified, meta }], newest first
//   disk.read(name)             its bytes, or null
//   disk.write(name, bytes, meta)   a promise, kept when stored
//   disk.remove(name)           a promise
//   disk.written()              a promise: every write so far stored
//   disk.name, disk.kept        the disk's name; whether its files outlast the page
//
// A disk's name says whose it is, so a title and a program can never share one: titleDisk(slug), a title's
// player's, 'title/zoopak'; programDisk(name), one of the site's own programs', 'program/basic'.
//
// The backend is where a disk's files are kept: { kept, load(disk), put(disk, file), delete(disk, name) },
// a file { name, bytes, meta, modified }. This browser's is local(); an account's will be the API's.
import { local } from './local.js';
import { memory } from './memory.js';

export async function openDisk(name, { backend } = {}) {
  // (a browser that keeps nothing, as a private window may: the disk in memory, and said so)
  if (!backend) { try { backend = await local(); } catch { backend = memory({ kept: false }); } }
  const files = new Map((await backend.load(name)).map(f => [f.name, f]));
  let queue = Promise.resolve();
  const later = job => (queue = queue.then(job));
  return {
    name,
    kept: backend.kept,
    list: () => [...files.values()].sort((a, b) => b.modified - a.modified).map(({ name, bytes, meta, modified }) => ({ name, size: bytes.length, modified, meta })),
    read: n => files.get(n)?.bytes ?? null,
    write(n, bytes, meta = {}) {
      const f = { name: n, bytes: Uint8Array.from(bytes), meta, modified: Date.now() };
      files.set(n, f);
      return later(() => backend.put(name, f));
    },
    remove(n) {
      files.delete(n);
      return later(() => backend.delete(name, n));
    },
    written: () => queue,
  };
}

export const titleDisk = slug => `title/${slug}`;
export const programDisk = name => `program/${name}`;

// a text file's bytes and back, for the programs whose files are text (UTF-8)
export const textBytes = s => new TextEncoder().encode(s);
export const bytesText = b => b ? new TextDecoder().decode(b) : null;

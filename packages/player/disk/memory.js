// A disk's files kept in memory only, for as long as the page: for the tests, which run where there is no
// IndexedDB, and for a browser that will keep nothing (disk.js says which, `kept`).
//
//   memory({ kept })   a backend: { kept, load(disk), put(disk, file), delete(disk, name) }
export function memory({ kept = true } = {}) {
  const disks = new Map(), of = d => disks.get(d) ?? disks.set(d, new Map()).get(d);
  return {
    kept,
    load: async d => [...of(d).values()].map(f => ({ ...f, bytes: Uint8Array.from(f.bytes) })),
    put: async (d, f) => { of(d).set(f.name, { ...f, bytes: Uint8Array.from(f.bytes) }); },
    delete: async (d, n) => { of(d).delete(n); },
  };
}

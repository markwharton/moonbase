// A disk's files kept in this browser, in IndexedDB: the database `moonbase`, its store `files`, each file
// keyed by its account, its disk and its name. The account is `local`, this browser's own, until there
// are accounts; theirs will be kept by the API, behind the same calls.
//
//   await local({ account })   a backend: { kept, load(disk), put(disk, file), delete(disk, name) }
// (named here once, for a tool that puts a file on a disk too)
export const DB = 'moonbase', VERSION = 1, STORE = 'files', KEY = ['account', 'disk', 'name'], ACCOUNT = 'local';

const opened = () => new Promise((done, fail) => {
  const r = indexedDB.open(DB, VERSION);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: KEY });
  r.onsuccess = () => done(r.result);
  r.onerror = () => fail(r.error);
});
const asked = r => new Promise((done, fail) => { r.onsuccess = () => done(r.result); r.onerror = () => fail(r.error); });

export async function local({ account = ACCOUNT } = {}) {
  const db = await opened();
  const store = mode => db.transaction(STORE, mode).objectStore(STORE);
  return {
    kept: true,
    // (the disk's files: those keyed from [account, disk] up to the next disk's)
    load: async disk => (await asked(store('readonly').getAll(IDBKeyRange.bound([account, disk], [account, disk, []]))))
      .map(({ name, bytes, meta, modified }) => ({ name, bytes, meta, modified })),
    put: (disk, f) => asked(store('readwrite').put({ account, disk, ...f })),
    delete: (disk, name) => asked(store('readwrite').delete([account, disk, name])),
  };
}

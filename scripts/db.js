// Tiny IndexedDB key-value wrapper for the Continue Watching library
const DB_NAME = "local-video-player"
const STORE = "library"
let dbPromise

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

async function run(mode, action) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const request = action(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(request?.result)
    tx.onerror = () => reject(tx.error)
  })
}

export const db = {
  get: (key) => run("readonly", (store) => store.get(key)),
  all: () => run("readonly", (store) => store.getAll()),
  put: (value) => run("readwrite", (store) => store.put(value)),
  delete: (key) => run("readwrite", (store) => store.delete(key)),
  clear: () => run("readwrite", (store) => store.clear()),
}

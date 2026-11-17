// Watch history: position, duration and last-viewed time for every file, stored in IndexedDB.
// The gallery reads it to show progress and to sort by "Last viewed" and "In progress".
import { bus, elements, utils, state, STORAGE_PREFIX } from "./player.js"
import { db } from "./db.js"

const MAX_AGE = 365 * 24 * 60 * 60 * 1000
let current = null // the library entry for the open file
let lastWrite = 0
let pendingSave = Promise.resolve()

function write(entry) {
  pendingSave = pendingSave.then(async () => {
    try {
      await db.put(entry)
    } catch (error) {
      // Some browsers can't store file handles; keep the entry without one
      if (error?.name === "DataCloneError" && entry.handle) {
        delete entry.handle
        await db.put(entry).catch(() => {})
      } else console.warn("Could not update library:", error)
    }
  })
  return pendingSave
}

// Snapshots progress now, then writes to IndexedDB in order
function save() {
  // Ignore saves until the entry matches the file that is actually loaded
  if (!current || !utils.hasMedia() || STORAGE_PREFIX + current.key !== state.localStorageKey) return pendingSave
  const { currentTime, duration } = elements.video
  if (!Number.isFinite(duration)) return pendingSave
  const entry = current
  Object.assign(entry, { time: currentTime, duration, updated: Date.now() })
  lastWrite = Date.now()
  return write(entry)
}

export const library = {
  // Resolves once every queued write has landed
  settled: () => pendingSave,
}

// Drops history nobody has touched in a year
async function prune() {
  const entries = await db.all().catch(() => [])
  const now = Date.now()
  entries
    .filter((e) => now - (e.updated ?? e.cached ?? 0) > MAX_AGE)
    .forEach((e) => db.delete(e.key).catch(() => {}))
}

export function initLibrary() {
  bus.addEventListener("media:loaded", async ({ detail }) => {
    const { file, handle, key } = detail
    const existing = await db.get(key).catch(() => null)
    current = {
      ...existing,
      key,
      name: file.name,
      size: file.size,
      isAudio: file.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|flac|oga|opus)$/i.test(file.name),
      handle: handle ?? existing?.handle,
      updated: Date.now(),
    }
  })

  elements.video.addEventListener("timeupdate", () => {
    if (Date.now() - lastWrite > 5000) save()
  })
  elements.video.addEventListener("pause", () => save())
  // Finished: keep it in the history as fully watched
  elements.video.addEventListener("ended", () => save())
  bus.addEventListener("media:closing", () => {
    save() // snapshots synchronously, so the entry can be released right away
    current = null
  })
  bus.addEventListener("media:closed", () => {
    pendingSave.then(() => bus.dispatchEvent(new CustomEvent("library:updated")))
  })
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save()
  })
  prune()
}

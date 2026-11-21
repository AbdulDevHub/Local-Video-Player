// Watch history: position, duration, thumbnail and last-viewed time for every file, stored in IndexedDB.
// The gallery reads it to show progress and to sort by "Last viewed" and "In progress".
import { bus, elements, utils, state, STORAGE_PREFIX } from "./player.js"
import { db } from "./db.js"
import { probe, snapshot, toJpeg } from "./frames.js"
import { toast } from "./hud.js"

const MAX_AGE = 365 * 24 * 60 * 60 * 1000
let current = null // the library entry for the open file
let lastWrite = 0
let pendingSave = Promise.resolve()
let needsThumbnail = false
let currentFile = null

// field: "progressThumb" (where you are, shown while in progress) or "thumb" (the chosen frame)
function write(entry, canvas, field = "progressThumb") {
  pendingSave = pendingSave.then(async () => {
    if (canvas) entry[field] = (await toJpeg(canvas)) ?? entry[field]
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
function save({ thumbnail = false } = {}) {
  // Ignore saves until the entry matches the file that is actually loaded
  if (!current || !utils.hasMedia() || STORAGE_PREFIX + current.key !== state.localStorageKey) return pendingSave
  const { currentTime, duration } = elements.video
  if (!Number.isFinite(duration)) return pendingSave
  const entry = current
  Object.assign(entry, { time: currentTime, duration, updated: Date.now() })
  // The frame where you are, drawn right away (the video may be unloaded next, e.g. on close)
  const canvas = thumbnail && !entry.isAudio ? snapshot(elements.video) : null
  if (canvas) entry.progressThumbAt = Date.now()
  lastWrite = Date.now()
  return write(entry, canvas)
}

// ----------------------------- THUMBNAIL POINT -----------------------------
// Settings > Playback > Thumbnail: 0%, 5% or the frame on screen now, for the open video only
const pointRow = document.querySelector("#thumb-point-row")
const pointButtons = pointRow ? [...pointRow.querySelectorAll("[data-point]")] : []

function showPoint() {
  if (!pointRow) return
  pointRow.hidden = !current || current.isAudio
  const point = String(current?.thumbPoint ?? 5)
  pointButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.point === point)))
}

async function setThumbPoint(value) {
  const entry = current
  if (!entry || entry.isAudio || !utils.hasMedia()) return
  if (value === "custom") {
    const canvas = snapshot(elements.video)
    if (!canvas) return toast("The video isn't ready yet. Try again in a moment.")
    Object.assign(entry, { thumbPoint: "custom", thumbFor: "custom" })
    showPoint()
    await write(entry, canvas, "thumb")
    return toast(`Thumbnail saved at ${utils.secondsToTime(elements.video.currentTime)}`)
  }
  const point = Number(value)
  entry.thumbPoint = point
  showPoint()
  write(entry)
  // Grab that frame in a hidden video, so playback isn't disturbed
  const meta = await probe(currentFile, point)
  if (entry.thumbPoint !== point) return
  if (!meta?.thumb) return toast("Couldn't grab that frame now. The gallery will try again next time.")
  Object.assign(entry, { thumb: meta.thumb, thumbFor: point })
  write(entry)
}

pointButtons.forEach((b) => b.addEventListener("click", () => setThumbPoint(b.dataset.point)))
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
    const { file, handle, key, coverBlob } = detail
    const existing = await db.get(key).catch(() => null)
    current = {
      ...existing,
      key,
      name: file.name,
      size: file.size,
      isAudio: file.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|flac|oga|opus)$/i.test(file.name),
      handle: handle ?? existing?.handle,
      thumb: coverBlob ?? existing?.thumb,
      thumbFor: coverBlob ? "cover" : existing?.thumbFor,
      updated: Date.now(),
    }
    currentFile = file
    needsThumbnail = true
    showPoint()
  })

  // Grab a thumbnail once the first (or resumed) frame is ready
  const firstThumbnail = () => {
    if (!needsThumbnail || !current) return
    needsThumbnail = false
    save({ thumbnail: true })
  }
  elements.video.addEventListener("seeked", firstThumbnail)
  elements.video.addEventListener("loadeddata", () => setTimeout(firstThumbnail, 300))

  elements.video.addEventListener("timeupdate", () => {
    if (Date.now() - lastWrite > 5000) save({ thumbnail: Date.now() - (current?.progressThumbAt ?? 0) > 60000 })
  })
  elements.video.addEventListener("pause", () => save({ thumbnail: true }))
  // Finished: keep it in the history as fully watched
  elements.video.addEventListener("ended", () => save())
  bus.addEventListener("media:closing", () => {
    save({ thumbnail: true }) // snapshots synchronously, so the entry can be released right away
    current = null
    currentFile = null
    showPoint()
  })
  bus.addEventListener("media:closed", () => {
    pendingSave.then(() => bus.dispatchEvent(new CustomEvent("library:updated")))
  })
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save()
  })
  prune()
}

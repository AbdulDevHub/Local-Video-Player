// "Continue watching" shelf: partly watched files with a thumbnail and progress, stored in IndexedDB.
// On Chrome/Edge the file handle is stored too, so one click reopens the file.
import { bus, elements, utils, state, STORAGE_PREFIX } from "./player.js"
import { db } from "./db.js"
import { playlist } from "./playlist.js"
import { files } from "./files.js"
import { toast } from "./hud.js"

const list = document.querySelector("#cw-list")
const clearButton = document.querySelector("#cw-clear")
const emptyHint = document.querySelector("#cw-empty")
const MAX_ENTRIES = 12
const MAX_AGE = 30 * 24 * 60 * 60 * 1000
let current = null // the library entry for the open file
let lastWrite = 0
let pendingSave = Promise.resolve()
let needsThumbnail = false

// Draws the current frame synchronously (the video may be unloaded right after, e.g. on close)
function drawThumbnail() {
  const video = elements.video
  if (!video.videoWidth || video.readyState < 2) return null
  const canvas = document.createElement("canvas")
  canvas.width = 384
  canvas.height = Math.round((384 * video.videoHeight) / video.videoWidth)
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas
}

// Snapshots progress now, then writes to IndexedDB in order
function save({ thumbnail = false } = {}) {
  // Ignore saves until the entry matches the file that is actually loaded
  if (!current || !utils.hasMedia() || STORAGE_PREFIX + current.key !== state.localStorageKey) return pendingSave
  const { currentTime, duration } = elements.video
  if (!Number.isFinite(duration)) return pendingSave
  const entry = current
  Object.assign(entry, { time: currentTime, duration, updated: Date.now() })
  const canvas = thumbnail && !entry.isAudio ? drawThumbnail() : null
  if (canvas) entry.thumbAt = Date.now()
  lastWrite = Date.now()

  pendingSave = pendingSave.then(async () => {
    if (canvas) entry.thumb = (await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.75))) ?? entry.thumb
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

const formatAgo = (ms) => {
  const minutes = Math.round((Date.now() - ms) / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? "yesterday" : `${days} days ago`
}

async function resume(entry) {
  if (entry.handle) {
    try {
      let permission = await entry.handle.queryPermission({ mode: "read" })
      if (permission !== "granted") permission = await entry.handle.requestPermission({ mode: "read" })
      if (permission === "granted") {
        await entry.handle.getFile() // throws if the file was moved or deleted
        // Open paused at the saved spot, even if "Resume" is off in Settings
        return playlist.open([{ name: entry.name, handle: entry.handle, forceResume: true }], { autoplay: false })
      }
    } catch (error) {
      console.info("Stored file handle is no longer usable:", error)
    }
  }
  // No handle (Firefox/Safari) or file moved: picking the same file again resumes it
  toast(`Pick “${entry.name}” to continue where you left off`, { timeout: 6000 })
  files.pick()
}

export const library = {
  async render() {
    let entries = []
    try {
      entries = await db.all()
    } catch {
      return // IndexedDB unavailable (e.g. some private modes)
    }
    const now = Date.now()
    const stale = entries.filter((e) => now - e.updated > MAX_AGE)
    stale.forEach((e) => db.delete(e.key))
    entries = entries
      .filter((e) => now - e.updated <= MAX_AGE && e.time > 5 && e.time < e.duration * 0.97)
      .sort((a, b) => b.updated - a.updated)
    entries.slice(MAX_ENTRIES).forEach((e) => db.delete(e.key))
    entries = entries.slice(0, MAX_ENTRIES)

    list.querySelectorAll("img").forEach((img) => URL.revokeObjectURL(img.src))
    // The column stays put; an empty list shows a hint instead
    clearButton.hidden = !entries.length
    emptyHint.hidden = !!entries.length
    list.replaceChildren(...entries.map(card))
  },
}

function card(entry) {
  const li = document.createElement("li")
  li.className = "cw-card"
  const progress = Math.min(100, (entry.time / entry.duration) * 100)
  li.innerHTML = `
    <button type="button" class="cw-open">
      <span class="cw-thumb"><span class="material-icon cw-fallback" aria-hidden="true"></span><span class="cw-play material-icon" aria-hidden="true">play_circle</span><span class="cw-progress" style="--p:${progress}%"></span></span>
      <span class="cw-name"></span>
      <span class="cw-meta"></span>
    </button>
    <button type="button" class="cw-remove material-icon" title="Remove">close</button>`
  li.querySelector(".cw-fallback").textContent = entry.isAudio ? "music_note" : "movie"
  li.querySelector(".cw-name").textContent = entry.name.replace(/\.[^.]+$/, "")
  li.querySelector(".cw-open").title = `Resume ${entry.name}`
  li.querySelector(".cw-meta").textContent =
    `${utils.secondsToTime(Math.max(0, entry.duration - entry.time))} left · ${formatAgo(entry.updated)}`
  if (entry.thumb) {
    const img = document.createElement("img")
    img.alt = ""
    img.src = URL.createObjectURL(entry.thumb)
    li.querySelector(".cw-thumb").prepend(img)
  }
  li.querySelector(".cw-open").addEventListener("click", () => resume(entry))
  const remove = li.querySelector(".cw-remove")
  remove.setAttribute("aria-label", `Remove ${entry.name} from Continue watching`)
  remove.addEventListener("click", async () => {
    await db.delete(entry.key)
    library.render()
  })
  return li
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
      updated: Date.now(),
    }
    needsThumbnail = true
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
    if (Date.now() - lastWrite > 5000) save({ thumbnail: Date.now() - (current?.thumbAt ?? 0) > 60000 })
  })
  elements.video.addEventListener("pause", () => save({ thumbnail: true }))
  elements.video.addEventListener("ended", () => {
    if (!current) return
    const { key } = current
    current = null
    pendingSave = pendingSave.then(() => db.delete(key).catch(() => {}))
  })
  bus.addEventListener("media:closing", () => {
    save({ thumbnail: true }) // snapshots synchronously, so the entry can be released right away
    current = null
  })
  bus.addEventListener("media:closed", () => {
    pendingSave.then(library.render)
  })
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save()
  })

  clearButton.addEventListener("click", async () => {
    await db.clear()
    library.render()
  })
  library.render()
}

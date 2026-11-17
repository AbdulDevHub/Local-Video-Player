// Start screen modes: "Single" (the drop zone) and "Gallery" (every video in a folder, with progress).
// The gallery reads the watch history from IndexedDB and can sort by name, last viewed, date added,
// duration or in progress. On Chrome/Edge the folder handle is stored so it comes back after a reload.
import { bus, utils } from "./player.js"
import { db } from "./db.js"
import { playlist } from "./playlist.js"
import { toast } from "./hud.js"
import { library } from "./library.js"
import { setDropHandler, walkDirectoryHandle } from "./files.js"
import { extractCoverImage, extractMp4Cover } from "./cover.js"

const MEDIA_RE = /\.(mp4|m4v|mkv|webm|mov|avi|ogv|ts|m2ts|mpeg|mpg|3gp|3g2|mp3|m4a|aac|wav|flac|ogg|oga|opus)$/i
const AUDIO_RE = /\.(mp3|m4a|aac|wav|flac|oga|opus)$/i
const SUBTITLE_RE = /\.(srt|vtt)$/i
const FOLDER_KEY = "gallery:folder"
const MODE_KEY = "lvp-home-mode"
const SORT_KEY = "lvp-gallery-sort"
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
const baseName = (name) => name.replace(/\.[^.]+$/, "")

const $ = (id) => document.getElementById(id)
const hero = { single: $("hero-single"), gallery: $("hero-gallery") }
const modeButtons = document.querySelectorAll(".mode-btn")
const emptyView = $("gallery-empty")
const contentView = $("gallery-content")
const grid = $("gallery-grid")
const folderLabel = $("gallery-folder")
const countLabel = $("gallery-count")
const sortSelect = $("gallery-sort")
const searchInput = $("gallery-search")
const noMatches = $("gallery-none")
const dirButton = $("gallery-dir")
const reopenButton = $("gallery-reopen")
const folderInput = $("gallery-input")

// Natural direction for each sort; the arrow button flips it
const DEFAULT_DIR = { name: 1, viewed: -1, added: -1, duration: 1, progress: -1 }

const state = {
  mode: "single",
  items: [], // { name, file, handle, subtitle, key, added, size, isAudio, record, thumbUrl }
  query: "",
  sort: "name",
  dir: 1,
}
let loadToken = 0

const store = {
  get(key) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value)
    } catch {}
  },
}

// ----------------------------- MODE -----------------------------
function setMode(mode) {
  state.mode = mode === "gallery" ? "gallery" : "single"
  store.set(MODE_KEY, state.mode)
  modeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)))
  hero.single.hidden = state.mode !== "single"
  hero.gallery.hidden = state.mode !== "gallery"
  if (state.mode === "gallery" && !state.items.length) restoreFolder()
}

// ----------------------------- LOADING A FOLDER -----------------------------
async function loadFolder(entries, { name, directory } = {}) {
  const media = entries.filter((e) => MEDIA_RE.test(e.name))
  if (!media.length) {
    toast("No playable files found in that folder. Try MP4, MKV, WebM, MP3…")
    return
  }
  const token = ++loadToken
  const subs = entries.filter((e) => SUBTITLE_RE.test(e.name))

  const items = await Promise.all(
    media.map(async (entry) => {
      try {
        const file = entry.file ?? (await entry.handle.getFile())
        const sub = subs.find((s) => baseName(s.name).toLowerCase() === baseName(entry.name).toLowerCase())
        return {
          name: entry.name,
          file,
          handle: entry.handle,
          subtitleEntry: sub,
          key: await utils.hashFile(file),
          added: file.lastModified,
          size: file.size,
          isAudio: file.type.startsWith("audio/") || AUDIO_RE.test(entry.name),
          record: null,
          thumbUrl: null,
        }
      } catch {
        return null // unreadable file (moved, permissions)
      }
    })
  )
  if (token !== loadToken) return

  state.items.forEach((item) => item.thumbUrl && URL.revokeObjectURL(item.thumbUrl))
  state.items = items.filter(Boolean)
  folderLabel.textContent = name || "Videos"
  searchInput.value = state.query = ""
  emptyView.hidden = true
  contentView.hidden = false

  if (directory) {
    db.put({ key: FOLDER_KEY, handle: directory, name: directory.name, cached: Date.now() }).catch(() => {})
  }
  await refreshRecords()
  extractMissing(token)
}

async function pickFolder() {
  if ("showDirectoryPicker" in window) {
    try {
      const directory = await window.showDirectoryPicker({ mode: "read" })
      return loadFolder(await walkDirectoryHandle(directory), { name: directory.name, directory })
    } catch (error) {
      if (error.name === "AbortError") return
      console.warn("Folder picker failed, falling back to the file input:", error)
    }
  }
  folderInput.click()
}

// Chrome/Edge: bring back the last folder. Permission may need a click, so offer a button then
async function restoreFolder() {
  const saved = await db.get(FOLDER_KEY).catch(() => null)
  if (!saved?.handle || state.items.length) return
  const open = async () => loadFolder(await walkDirectoryHandle(saved.handle), { name: saved.name, directory: saved.handle })
  try {
    if ((await saved.handle.queryPermission({ mode: "read" })) === "granted") return await open()
  } catch {
    return
  }
  reopenButton.lastElementChild.textContent = `Reopen “${saved.name}”`
  reopenButton.hidden = false
  reopenButton.onclick = async () => {
    try {
      if ((await saved.handle.requestPermission({ mode: "read" })) === "granted") await open()
    } catch {
      reopenButton.hidden = true
      toast("That folder can't be opened anymore. Choose it again.")
    }
  }
}

// ----------------------------- WATCH HISTORY -----------------------------
async function refreshRecords() {
  await Promise.all(
    state.items.map(async (item) => {
      item.record = await db.get(item.key).catch(() => null)
      setThumb(item)
    })
  )
  render()
}

// Shows the File Explorer-style poster (cover art or first real frame), never a mid-watch frame
function setThumb(item) {
  const poster = item.record?.poster
  if (!poster || poster === item.thumbBlob) return
  if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl)
  item.thumbBlob = poster
  item.thumbUrl = URL.createObjectURL(poster)
}

const watched = (item) => Boolean(item.record?.updated)
const duration = (item) => item.record?.duration || 0
const position = (item) => item.record?.time || 0
const isInProgress = (item) => position(item) > 5 && position(item) < duration(item) * 0.97
const isFinished = (item) => duration(item) > 0 && position(item) >= duration(item) * 0.97

// Bumped when the poster rules change, so older posters get redone once
const POSTER_VERSION = 2

// Reads durations and posters for files that need them, two at a time
async function extractMissing(token) {
  // Files already probed with the current rules (even if that failed) aren't tried again
  const queue = state.items.filter((item) => item.record?.posterVersion !== POSTER_VERSION || !duration(item))
  const worker = async () => {
    while (queue.length && token === loadToken) {
      // Don't compete with the player for the decoder
      if (document.documentElement.dataset.view === "player") {
        await new Promise((r) => setTimeout(r, 1500))
        continue
      }
      const item = queue.shift()
      const meta = await probe(item.file, item.isAudio)
      if (token !== loadToken) continue
      // Merge into the latest record so watch progress written meanwhile is kept
      const latest = (await db.get(item.key).catch(() => null)) ?? { key: item.key, name: item.name, size: item.size }
      if (meta?.duration) latest.duration ||= meta.duration
      if (meta?.poster) latest.poster = meta.poster
      delete latest.thumb // old mid-watch frames from the removed shelf
      latest.posterVersion = POSTER_VERSION
      latest.cached = Date.now()
      latest.isAudio = item.isAudio
      await db.put(latest).catch(() => {})
      item.record = latest
      setThumb(item)
      updateCard(item)
    }
    if (state.sort === "duration") render()
  }
  await Promise.all([worker(), worker()])
}

// Matches Windows File Explorer, worked out by comparing against its real thumbnails:
// embedded cover art (MP4 covr, MP3 ID3) wins; otherwise the first frame that isn't "blank",
// i.e. no single colour covers more than ~70% of it (black intros, solid title cards, small logos
// are skipped). If every frame is blank, the very first frame is used.
async function probe(file, isAudio) {
  const cover = (await extractMp4Cover(file)) ?? (await extractCoverImage(file))
  const video = document.createElement("video")
  const url = URL.createObjectURL(file)
  video.muted = true
  video.preload = "auto"
  const wait = (event) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 8000)
      video.addEventListener(event, () => (clearTimeout(timer), resolve()), { once: true })
      video.addEventListener("error", () => (clearTimeout(timer), reject(video.error)), { once: true })
    })
  const seek = (time) => {
    const done = wait("seeked")
    video.currentTime = time
    return done
  }
  try {
    const loaded = wait("loadeddata")
    video.src = url
    await loaded
    // Some WebM files don't store their length: seeking far past the end makes the browser work it out
    if (!Number.isFinite(video.duration)) await seek(1e9)
    const length = Number.isFinite(video.duration) ? video.duration : 0
    if (cover || isAudio || !video.videoWidth) return { duration: length, poster: cover }

    const sample = document.createElement("canvas")
    sample.width = 64
    sample.height = 36
    const sampleContext = sample.getContext("2d", { willReadFrequently: true })
    const isBlank = () => {
      sampleContext.drawImage(video, 0, 0, sample.width, sample.height)
      const pixels = sampleContext.getImageData(0, 0, sample.width, sample.height).data
      const counts = new Map()
      let top = 0
      for (let i = 0; i < pixels.length; i += 4) {
        const colour = ((pixels[i] >> 4) << 8) | ((pixels[i + 1] >> 4) << 4) | (pixels[i + 2] >> 4)
        const count = (counts.get(colour) ?? 0) + 1
        counts.set(colour, count)
        if (count > top) top = count
      }
      return top / (pixels.length / 4) > 0.7
    }

    await seek(0)
    let found = isBlank() ? null : 0
    if (found === null && length) {
      // Step forward 1, 2, 4, 8… seconds to find content, then narrow down to where it starts
      let low = 0
      for (let t = 1; t < length && found === null; t = Math.min(t * 2, length - 0.05)) {
        await seek(t)
        if (isBlank()) low = t
        else found = t
        if (t >= length - 0.05) break
      }
      while (found !== null && found - low > 0.1) {
        const mid = (low + found) / 2
        await seek(mid)
        if (isBlank()) low = mid
        else found = mid
      }
    }
    await seek(found ?? 0)

    const canvas = document.createElement("canvas")
    canvas.width = 384
    canvas.height = Math.round((384 * video.videoHeight) / video.videoWidth)
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height)
    const poster = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.8))
    return { duration: length, poster }
  } catch {
    return null
  } finally {
    video.removeAttribute("src")
    video.load()
    URL.revokeObjectURL(url)
  }
}

// ----------------------------- SORTING -----------------------------
// Missing values (never viewed, unknown duration) always go last, whatever the direction
function compareBy(value, dir) {
  return (a, b) => {
    const va = value(a)
    const vb = value(b)
    if (!va !== !vb) return va ? -1 : 1
    return dir * (va - vb) || collator.compare(a.name, b.name)
  }
}

function sorted() {
  const { dir } = state
  const comparators = {
    name: (a, b) => dir * collator.compare(a.name, b.name),
    viewed: compareBy((i) => i.record?.updated, dir),
    added: (a, b) => dir * (a.added - b.added) || collator.compare(a.name, b.name),
    duration: compareBy(duration, dir),
    // Videos you're partway through first, most recently watched on top; the rest by name
    progress: (a, b) =>
      isInProgress(b) - isInProgress(a) ||
      (isInProgress(a) ? dir * (a.record.updated - b.record.updated) : collator.compare(a.name, b.name)),
  }
  return [...state.items].sort(comparators[state.sort])
}

function setSort(sort, dir = DEFAULT_DIR[sort]) {
  state.sort = sort in DEFAULT_DIR ? sort : "name"
  state.dir = dir === -1 ? -1 : 1
  sortSelect.value = state.sort
  dirButton.textContent = state.dir === 1 ? "arrow_upward" : "arrow_downward"
  store.set(SORT_KEY, `${state.sort}:${state.dir}`)
  render()
}

// ----------------------------- RENDERING -----------------------------
const formatAgo = (ms) => {
  const minutes = Math.round((Date.now() - ms) / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? "yesterday" : `${days} days ago`
}
const formatDate = (ms) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })

function meta(item) {
  if (isInProgress(item)) return `${utils.secondsToTime(duration(item) - position(item))} left · ${formatAgo(item.record.updated)}`
  if (isFinished(item)) return `Watched · ${formatAgo(item.record.updated)}`
  if (watched(item)) return `Opened ${formatAgo(item.record.updated)}`
  return `Added ${formatDate(item.added)}`
}

function card(item) {
  const li = document.createElement("li")
  li.dataset.key = item.key
  li.innerHTML = `
    <button type="button" class="gallery-card">
      <span class="gc-thumb"><span class="material-icon gc-fallback" aria-hidden="true"></span><span class="gc-play material-icon" aria-hidden="true">play_circle</span></span>
      <span class="gc-name"></span>
      <span class="gc-meta"></span>
    </button>`
  li.querySelector(".gc-fallback").textContent = item.isAudio ? "music_note" : "movie"
  li.querySelector(".gc-name").textContent = baseName(item.name)
  li.querySelector(".gallery-card").title = item.name
  li.querySelector(".gallery-card").addEventListener("click", () => play(item))
  fillCard(li, item)
  return li
}

// Parts that change once a thumbnail or duration arrives
function fillCard(li, item) {
  const thumb = li.querySelector(".gc-thumb")
  thumb.querySelectorAll("img, .gc-duration, .gc-progress, .gc-done").forEach((el) => el.remove())
  if (item.thumbUrl) {
    const img = document.createElement("img")
    img.alt = ""
    img.loading = "lazy"
    img.src = item.thumbUrl
    thumb.prepend(img)
  }
  if (duration(item)) {
    const pill = document.createElement("span")
    pill.className = "gc-duration"
    pill.textContent = utils.secondsToTime(duration(item))
    thumb.append(pill)
  }
  if (isInProgress(item)) {
    const bar = document.createElement("span")
    bar.className = "gc-progress"
    bar.style.setProperty("--p", `${Math.min(100, (position(item) / duration(item)) * 100)}%`)
    thumb.append(bar)
  } else if (isFinished(item)) {
    const done = document.createElement("span")
    done.className = "gc-done"
    done.innerHTML = `<span class="material-icon" aria-hidden="true">check_circle</span>Watched`
    thumb.append(done)
  }
  li.querySelector(".gc-meta").textContent = meta(item)
}

function updateCard(item) {
  const li = grid.querySelector(`[data-key="${item.key}"]`)
  if (li) fillCard(li, item)
}

// Every word typed has to appear in the name, in any order ("ep 3 final" finds "Final Ep. 3")
function visible() {
  const words = state.query.toLowerCase().split(/\s+/).filter(Boolean)
  const list = sorted()
  return words.length ? list.filter((item) => words.every((w) => item.name.toLowerCase().includes(w))) : list
}

function render() {
  if (!state.items.length) return
  const shown = visible()
  countLabel.textContent = shown.length === state.items.length ? state.items.length : `${shown.length} / ${state.items.length}`
  noMatches.hidden = shown.length > 0
  noMatches.textContent = shown.length ? "" : `No videos match “${state.query.trim()}”`
  // Keep keyboard focus on the same video across re-renders
  const focusedKey = grid.contains(document.activeElement) ? document.activeElement.closest("li")?.dataset.key : null
  grid.replaceChildren(...shown.map(card))
  if (focusedKey) grid.querySelector(`[data-key="${focusedKey}"] .gallery-card`)?.focus()
}

const readSubtitle = (entry) => Promise.resolve(entry.file ?? entry.handle.getFile()).catch(() => undefined)

// Plays the clicked video with the rest of the list queued in the order shown
async function play(item) {
  const order = visible()
  const index = order.indexOf(item)
  const items = order.map((it) => ({ name: it.name, file: it.file, handle: it.handle, forceResume: true }))
  // Only the clicked video waits for its subtitles; the rest load in the background
  if (item.subtitleEntry) items[index].subtitle = await readSubtitle(item.subtitleEntry)
  order.forEach((it, i) => {
    if (i !== index && it.subtitleEntry) readSubtitle(it.subtitleEntry).then((sub) => (items[i].subtitle = sub))
  })
  playlist.items = items
  await playlist.play(index)
}

// ----------------------------- SETUP -----------------------------
export function initGallery() {
  modeButtons.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)))
  $("gallery-pick").addEventListener("click", pickFolder)
  $("gallery-change").addEventListener("click", pickFolder)
  folderInput.addEventListener("change", () => {
    const files = [...folderInput.files]
    folderInput.value = ""
    if (!files.length) return
    loadFolder(files.map((file) => ({ name: file.name, file })), {
      name: files[0].webkitRelativePath.split("/")[0],
    })
  })

  sortSelect.addEventListener("change", () => setSort(sortSelect.value))

  searchInput.addEventListener("input", () => {
    state.query = searchInput.value
    render()
  })
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && searchInput.value) {
      e.stopPropagation()
      searchInput.value = ""
      searchInput.dispatchEvent(new Event("input"))
    }
  })
  // "/" jumps to the search box while the gallery is showing
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || contentView.hidden || hero.gallery.hidden) return
    if (document.documentElement.dataset.view === "player" || e.target.closest?.("input, textarea, select, dialog")) return
    e.preventDefault()
    searchInput.focus()
  })
  dirButton.addEventListener("click", () => setSort(state.sort, -state.dir))

  // Folders dropped on the start screen fill the gallery instead of playing right away
  setDropHandler((entries) => {
    if (state.mode !== "gallery" || document.documentElement.dataset.view === "player") return false
    // A lone file still just plays; a folder or a batch of videos becomes the gallery
    if (!entries.directory && entries.filter((e) => MEDIA_RE.test(e.name)).length < 2) return false
    loadFolder(entries, { name: entries.directory?.name ?? "Dropped files", directory: entries.directory })
    return true
  })

  // Back on the start screen: show the progress just saved
  bus.addEventListener("library:updated", () => library.settled().then(refreshRecords))

  const [sort, dir] = (store.get(SORT_KEY) ?? "").split(":")
  setSort(sort || "name", sort ? Number(dir) : undefined)
  setMode(store.get(MODE_KEY))
}

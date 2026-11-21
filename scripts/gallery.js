// Start screen modes: "Single" (the drop zone) and "Gallery" (every video in a folder, with progress).
// The gallery reads the watch history from IndexedDB and can sort by name, last viewed, date added,
// duration or in progress. On Chrome/Edge the folder handle is stored so it comes back after a reload.
import { bus, utils } from "./player.js"
import { db } from "./db.js"
import { playlist } from "./playlist.js"
import { toast } from "./hud.js"
import { library } from "./library.js"
import { setDropHandler, walkDirectoryHandle } from "./files.js"
import { pointOf, probe, thumbIsCurrent } from "./frames.js"
import { extractCoverImage } from "./cover.js"

const MEDIA_RE = /\.(mp4|m4v|mkv|webm|mov|avi|ogv|ts|m2ts|mpeg|mpg|3gp|3g2|mp3|m4a|aac|wav|flac|ogg|oga|opus)$/i
const AUDIO_RE = /\.(mp3|m4a|aac|wav|flac|oga|opus)$/i
const SUBTITLE_RE = /\.(srt|vtt)$/i
const FOLDER_KEY = "gallery:folder" // older single-folder record
const RECENT_KEY = "gallery:recent"
const MODE_KEY = "lvp-home-mode"
const SORT_KEY = "lvp-gallery-sort"
const COLS_KEY = "lvp-gallery-cols"
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
const baseName = (name) => name.replace(/\.[^.]+$/, "")

const $ = (id) => document.getElementById(id)
const hero = { single: $("hero-single"), gallery: $("hero-gallery") }
const modeButtons = document.querySelectorAll(".mode-btn")
const emptyView = $("gallery-empty")
const loadingView = $("gallery-loading")
const loadingText = $("gallery-loading-text")
const contentView = $("gallery-content")
const grid = $("gallery-grid")
const folderLabel = $("gallery-folder")
const countLabel = $("gallery-count")
const sortButton = $("gallery-sort")
const sortLabel = $("gallery-sort-label")
const sortMenu = $("gallery-sort-menu")
const sortOptions = [...sortMenu.children]
const searchInput = $("gallery-search")
const noMatches = $("gallery-none")
const dirButton = $("gallery-dir")
const recentSection = $("gallery-recent")
const recentList = $("gallery-recent-list")
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
function setMode(mode, { fromClick = false } = {}) {
  state.mode = mode === "gallery" ? "gallery" : "single"
  store.set(MODE_KEY, state.mode)
  modeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)))
  hero.single.hidden = state.mode !== "single"
  hero.gallery.hidden = state.mode !== "gallery"
  if (state.mode === "gallery" && !state.items.length) restoreFolder({ fromClick })
}

// ----------------------------- LOADING A FOLDER -----------------------------
// Spinner while the folder is read, so the short wait never looks like nothing happened
function showLoading(text) {
  loadingText.textContent = text
  loadingView.hidden = false
  emptyView.hidden = true
  contentView.hidden = true
}

function hideLoading() {
  loadingView.hidden = true
  const hasItems = state.items.length > 0
  contentView.hidden = !hasItems
  emptyView.hidden = hasItems
}

// entries can be a promise (e.g. a folder still being listed): the spinner shows right away
async function loadFolder(entriesOrPromise, { name, directory } = {}) {
  const token = ++loadToken
  showLoading(`Opening “${name || "folder"}”…`)
  let entries
  try {
    entries = await entriesOrPromise
  } catch (error) {
    if (token === loadToken) hideLoading()
    throw error
  }
  if (token !== loadToken) return
  // Only the folder's own files: videos inside its subfolders are left out
  entries = entries.filter((e) => !e.nested)
  const media = entries.filter((e) => MEDIA_RE.test(e.name))
  if (!media.length) {
    hideLoading()
    toast("No playable files found in that folder. Try MP4, MKV, WebM, MP3…")
    return
  }
  showLoading(`Reading ${media.length} ${media.length === 1 ? "video" : "videos"}…`)
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
  loadingView.hidden = true
  emptyView.hidden = true
  contentView.hidden = false

  if (directory) rememberFolder(directory)
  await refreshRecords()
  extractMissing(token)
}

async function pickFolder() {
  if ("showDirectoryPicker" in window) {
    try {
      const directory = await window.showDirectoryPicker({ mode: "read" })
      return loadFolder(walkDirectoryHandle(directory), { name: directory.name, directory })
    } catch (error) {
      if (error.name === "AbortError") return
      console.warn("Folder picker failed, falling back to the file input:", error)
    }
  }
  folderInput.click()
}

// ----------------------------- RECENT FOLDERS -----------------------------
// Chrome/Edge keep folder handles in IndexedDB, so a folder can be reopened after a reload without
// browsing to it again. The browser may still ask "Allow this site to view files?" once per visit
// (or never again if you pick "Allow on every visit").
const RECENT_LIMIT = 8

async function recentFolders() {
  const saved = await db.get(RECENT_KEY).catch(() => null)
  if (saved?.folders) return saved.folders
  // Older versions kept only the last folder
  const last = await db.get(FOLDER_KEY).catch(() => null)
  return last?.handle ? [{ handle: last.handle, name: last.name, opened: last.cached ?? Date.now() }] : []
}

async function saveRecent(folders) {
  await db.put({ key: RECENT_KEY, folders: folders.slice(0, RECENT_LIMIT), cached: Date.now() }).catch(() => {})
  db.delete(FOLDER_KEY).catch(() => {})
}

async function rememberFolder(directory) {
  const folders = await recentFolders()
  const kept = []
  for (const folder of folders) {
    if (!(await folder.handle.isSameEntry(directory).catch(() => false))) kept.push(folder)
  }
  await saveRecent([{ handle: directory, name: directory.name, opened: Date.now() }, ...kept])
  renderRecent()
}

async function forgetFolder(folder) {
  const folders = await recentFolders()
  const kept = []
  for (const f of folders) {
    if (!(await f.handle.isSameEntry(folder.handle).catch(() => false))) kept.push(f)
  }
  await saveRecent(kept)
  renderRecent()
}

// Asks for access if needed (needs a click), then loads the folder
async function openRecent(folder, { prompt = true } = {}) {
  try {
    let permission = await folder.handle.queryPermission({ mode: "read" })
    if (permission !== "granted" && prompt) permission = await folder.handle.requestPermission({ mode: "read" })
    if (permission !== "granted") return false
    await loadFolder(walkDirectoryHandle(folder.handle), { name: folder.name, directory: folder.handle })
    return true
  } catch {
    toast(`“${folder.name}” can't be opened anymore. It may have been moved or deleted.`)
    forgetFolder(folder)
    return false
  }
}

async function renderRecent() {
  const folders = await recentFolders()
  recentList.replaceChildren(
    ...folders.map((folder) => {
      const li = document.createElement("li")
      li.innerHTML = `
        <button type="button" class="recent-open"><span class="material-icon" aria-hidden="true">folder</span><span class="recent-name"></span></button>
        <button type="button" class="recent-remove material-icon">close</button>`
      li.querySelector(".recent-name").textContent = folder.name
      li.querySelector(".recent-open").title = `Open ${folder.name}`
      li.querySelector(".recent-open").addEventListener("click", () => openRecent(folder))
      const remove = li.querySelector(".recent-remove")
      remove.title = "Remove from recent folders"
      remove.setAttribute("aria-label", `Remove ${folder.name} from recent folders`)
      remove.addEventListener("click", () => forgetFolder(folder))
      return li
    })
  )
  recentSection.hidden = !folders.length
}

// On load or when switching to Gallery: reopen the last folder if the browser still allows it.
// fromClick: the Gallery button was just clicked, so the permission prompt may be shown
async function restoreFolder({ fromClick = false } = {}) {
  if (state.items.length) return
  await renderRecent()
  const [last] = await recentFolders()
  if (last && !state.items.length) await openRecent(last, { prompt: fromClick })
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

// In progress: the frame where you stopped. Otherwise: the video's chosen frame (0%, 5% or saved).
function setThumb(item) {
  const record = item.record
  const thumb = (isInProgress(item) && record?.progressThumb) || record?.thumb
  if (!thumb || thumb === item.thumbBlob) return
  if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl)
  item.thumbBlob = thumb
  item.thumbUrl = URL.createObjectURL(thumb)
}

const watched = (item) => Boolean(item.record?.updated)
const duration = (item) => item.record?.duration || 0
const position = (item) => item.record?.time || 0
const isInProgress = (item) => position(item) > 5 && position(item) < duration(item) * 0.97
const isFinished = (item) => duration(item) > 0 && position(item) >= duration(item) * 0.97

// A video's frame is (re)made when it doesn't match the video's chosen point: new files, records
// from older versions, and after picking 0% or 5% in Settings. Saved ("custom") frames are kept.
// Music uses the track's own cover art, read once. Files that couldn't be read ("probed" without a
// duration) aren't retried on every visit.
const wantsFrame = (item) => (item.isAudio ? !item.record?.thumbFor : !thumbIsCurrent(item.record))
const needsProbe = (item) => wantsFrame(item) || (!duration(item) && !item.record?.probed)

// Reads durations and thumbnail frames, two files at a time
async function extractMissing(token) {
  const queue = state.items.filter(needsProbe)
  const worker = async () => {
    while (queue.length && token === loadToken) {
      // Don't compete with the player for the decoder
      if (document.documentElement.dataset.view === "player") {
        await new Promise((r) => setTimeout(r, 1500))
        continue
      }
      const item = queue.shift()
      const point = pointOf(item.record)
      const wantFrame = wantsFrame(item) && point !== "custom"
      // Music: the track's own picture (ID3 cover art), like the player shows while it plays
      const cover = item.isAudio && wantFrame ? await extractCoverImage(item.file) : null
      const percent = wantFrame && !item.isAudio ? point : null
      // Length already known and frame up to date: no need to open the file
      const meta = percent !== null || !duration(item) ? await probe(item.file, percent) : { duration: duration(item) }
      if (token !== loadToken) continue
      // Merge into the latest record so watch progress written meanwhile is kept
      const latest = (await db.get(item.key).catch(() => null)) ?? { key: item.key, name: item.name, size: item.size }
      if (meta?.duration) latest.duration ||= meta.duration
      // Skip if the point was changed in the player meanwhile
      if (wantFrame && pointOf(latest) === point) {
        if (item.isAudio) {
          if (cover) latest.thumb = cover
          latest.thumbFor = "cover"
        } else {
          if (meta?.thumb) latest.thumb = meta.thumb
          latest.thumbFor = point // even if unreadable, so it isn't retried every visit
        }
      }
      latest.probed = true
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
  sortOptions.forEach((li) => li.setAttribute("aria-selected", String(li.dataset.value === state.sort)))
  const chosen = sortOptions.find((li) => li.dataset.value === state.sort)
  sortLabel.textContent = chosen.dataset.label ?? chosen.dataset.value
  sortButton.setAttribute("aria-label", `Sort videos by: ${sortLabel.textContent}`)
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
  // Shimmer until the preview frame has been read
  li.classList.toggle("pending", !item.thumbUrl && wantsFrame(item))
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

// A video's series and part number come from the last number in its name, so "Show Ep 3" is
// part 3 of the series "show ep #". The last number is used so "Season 1 Episode 4" counts
// episodes, and only names that match apart from that number count as the same series.
function partOf(item) {
  const name = baseName(item.name).toLowerCase()
  const match = [...name.matchAll(/\d+/g)].pop()
  if (!match) return null
  return {
    series: name.slice(0, match.index) + "#" + name.slice(match.index + match[0].length),
    number: Number(match[0]),
  }
}

// The clicked video followed by its later parts (searched in the whole folder, whatever the
// search box or sort says). A video with no later parts plays on its own.
function queueFor(item) {
  const part = partOf(item)
  if (!part) return [item]
  const later = state.items
    .map((it) => ({ it, p: partOf(it) }))
    .filter(({ it, p }) => it !== item && p?.series === part.series && p.number > part.number)
    .sort((a, b) => a.p.number - b.p.number || collator.compare(a.it.name, b.it.name))
    .map(({ it }) => it)
  return [item, ...later]
}

// Picks any video on screen, preferring ones not watched to the end yet
function playRandom() {
  const shown = visible()
  const unfinished = shown.filter((item) => !isFinished(item))
  const pool = unfinished.length ? unfinished : shown
  if (!pool.length) return toast("No videos to pick from")
  const item = pool[Math.floor(Math.random() * pool.length)]
  toast(`Random pick: ${baseName(item.name)}`)
  play(item)
}

// Plays the clicked video, with its next parts (if any) queued after it
async function play(item) {
  const order = queueFor(item)
  const index = 0
  const items = order.map((it) => ({ name: it.name, file: it.file, handle: it.handle, forceResume: true }))
  // Only the clicked video waits for its subtitles; the rest load in the background
  if (item.subtitleEntry) items[index].subtitle = await readSubtitle(item.subtitleEntry)
  order.forEach((it, i) => {
    if (i !== index && it.subtitleEntry) readSubtitle(it.subtitleEntry).then((sub) => (items[i].subtitle = sub))
  })
  playlist.items = items
  await playlist.play(index)
}

// ----------------------------- SORT MENU -----------------------------
// A styled listbox instead of the browser's <select>: click or Enter/Space/↓ to open,
// ↑/↓/Home/End to move, Enter/Space to pick, Esc or a click outside to close
function initSortMenu() {
  let active = 0
  sortOptions.forEach((li, i) => {
    li.id = `gallery-sort-${li.dataset.value}`
    li.addEventListener("click", () => pick(i))
    li.addEventListener("mousemove", () => highlight(i))
  })
  // Material icon names are text too, so read the label from the text node only
  sortOptions.forEach((li) => {
    li.dataset.label = [...li.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").trim()
  })

  const highlight = (i) => {
    active = (i + sortOptions.length) % sortOptions.length
    sortOptions.forEach((li, j) => li.classList.toggle("active", j === active))
    sortMenu.setAttribute("aria-activedescendant", sortOptions[active].id)
  }
  const open = () => {
    sortMenu.hidden = false
    sortButton.setAttribute("aria-expanded", "true")
    highlight(sortOptions.findIndex((li) => li.dataset.value === state.sort))
    sortMenu.focus()
  }
  const close = ({ focusButton = true } = {}) => {
    if (sortMenu.hidden) return
    sortMenu.hidden = true
    sortButton.setAttribute("aria-expanded", "false")
    if (focusButton) sortButton.focus()
  }
  const pick = (i) => {
    const value = sortOptions[i].dataset.value
    close()
    if (value !== state.sort) setSort(value)
  }

  sortButton.addEventListener("click", () => (sortMenu.hidden ? open() : close()))
  sortButton.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      open()
    }
  })
  sortMenu.addEventListener("keydown", (e) => {
    const keys = {
      ArrowDown: () => highlight(active + 1),
      ArrowUp: () => highlight(active - 1),
      Home: () => highlight(0),
      End: () => highlight(sortOptions.length - 1),
      Enter: () => pick(active),
      " ": () => pick(active),
      Escape: () => close(),
      Tab: () => close({ focusButton: false }),
    }
    if (!keys[e.key]) return
    if (e.key !== "Tab") e.preventDefault()
    e.stopPropagation()
    keys[e.key]()
  })
  document.addEventListener("pointerdown", (e) => {
    if (!sortMenu.hidden && !e.target.closest(".sort-picker")) close({ focusButton: false })
  })
}

// ----------------------------- SETUP -----------------------------
export function initGallery() {
  modeButtons.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode, { fromClick: true })))
  $("gallery-pick").addEventListener("click", pickFolder)
  // Back to the folder chooser, with recent folders one click away
  $("gallery-change").addEventListener("click", () => {
    renderRecent()
    contentView.hidden = true
    emptyView.hidden = false
    $("gallery-pick").focus()
  })
  folderInput.addEventListener("change", () => {
    const files = [...folderInput.files]
    folderInput.value = ""
    if (!files.length) return
    // webkitRelativePath is "Folder/file.mp4"; anything deeper is in a subfolder
    loadFolder(files.map((file) => ({ name: file.name, file, nested: file.webkitRelativePath.split("/").length > 2 })), {
      name: files[0].webkitRelativePath.split("/")[0],
    })
  })

  initSortMenu()

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
  $("gallery-random").addEventListener("click", playRandom)

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

  // Videos per row: 3, 5 (default) or 10, remembered between visits
  const colButtons = document.querySelectorAll(".cols-toggle button")
  const setCols = (cols) => {
    if (!["3", "5", "10"].includes(cols)) cols = "5"
    grid.dataset.cols = cols
    colButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.cols === cols)))
    store.set(COLS_KEY, cols)
  }
  colButtons.forEach((b) => b.addEventListener("click", () => setCols(b.dataset.cols)))
  setCols(store.get(COLS_KEY) ?? "5")
  setMode(store.get(MODE_KEY))
}

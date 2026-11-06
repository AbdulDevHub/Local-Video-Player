// Getting files in: drag & drop (files or folders), file/folder pickers, OS "Open with" (PWA).
// Uses File System Access handles where available (Chrome/Edge) so the library can reopen files
// later, and falls back to plain File objects everywhere else (Firefox/Safari).
import { utils } from "./player.js"
import { playlist } from "./playlist.js"
import { subtitles } from "./subtitles.js"
import { toast } from "./hud.js"

const MEDIA_EXT = [
  ".mp4", ".m4v", ".mkv", ".webm", ".mov", ".avi", ".ogv", ".ts", ".m2ts", ".mpeg", ".mpg", ".3gp", ".3g2",
  ".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".oga", ".opus",
]
const SUBTITLE_EXT = [".srt", ".vtt"]
const ext = (name) => name.slice(name.lastIndexOf(".")).toLowerCase()
const baseName = (name) => name.replace(/\.[^.]+$/, "").toLowerCase()
const isMedia = (name) => MEDIA_EXT.includes(ext(name))
const isSubtitle = (name) => SUBTITLE_EXT.includes(ext(name))
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

const overlay = document.querySelector("#drop-overlay")
const fileInput = document.querySelector("#file-input")
const folderInput = document.querySelector("#folder-input")
const supportsHandles = "showOpenFilePicker" in window
let appendNext = false

// ----------------------------- COLLECTING ENTRIES -----------------------------
// Entry: { name, file?, handle? }
async function walkDirectoryHandle(dir, depth = 0, out = []) {
  for await (const entry of dir.values()) {
    if (entry.kind === "file") out.push({ name: entry.name, handle: entry })
    else if (depth < 3) await walkDirectoryHandle(entry, depth + 1, out)
  }
  return out
}

function walkEntry(entry, depth = 0) {
  // Legacy FileSystemEntry API (Firefox/Safari folder drops)
  if (entry.isFile) {
    return new Promise((resolve) => entry.file((file) => resolve([{ name: file.name, file }]), () => resolve([])))
  }
  if (depth > 3) return Promise.resolve([])
  const reader = entry.createReader()
  const readAll = (acc = []) =>
    new Promise((resolve) =>
      reader.readEntries(async (batch) => {
        if (!batch.length) return resolve(acc)
        resolve(readAll(acc.concat(batch)))
      }, () => resolve(acc))
    )
  return readAll().then((children) => Promise.all(children.map((c) => walkEntry(c, depth + 1)))).then((r) => r.flat())
}

// DataTransfer items are only readable synchronously inside the drop event, so grab everything first
function entriesFromDataTransfer(dataTransfer) {
  const items = [...dataTransfer.items].filter((item) => item.kind === "file")
  if (items.length && "getAsFileSystemHandle" in DataTransferItem.prototype) {
    const plainFiles = items.map((item) => item.getAsFile())
    const handles = items.map((item) => item.getAsFileSystemHandle())
    return Promise.all(handles).then(async (resolved) => {
      const out = []
      for (const [i, handle] of resolved.entries()) {
        if (!handle) {
          if (plainFiles[i]) out.push({ name: plainFiles[i].name, file: plainFiles[i] })
          continue
        }
        if (handle.kind === "directory") out.push(...(await walkDirectoryHandle(handle)))
        else out.push({ name: handle.name, handle })
      }
      return out
    })
  }
  const entries = items.map((item) => item.webkitGetAsEntry?.()).filter(Boolean)
  if (entries.length) return Promise.all(entries.map((e) => walkEntry(e))).then((r) => r.flat())
  return Promise.resolve([...dataTransfer.files].map((file) => ({ name: file.name, file })))
}

// ----------------------------- OPENING -----------------------------
async function readFile(entry) {
  return entry.file ?? entry.handle.getFile()
}

// Splits entries into media and subtitles, pairs subtitles to videos by name, then plays
export async function openEntries(entries, { append = false } = {}) {
  const media = entries.filter((e) => isMedia(e.name)).sort((a, b) => collator.compare(a.name, b.name))
  const subs = entries.filter((e) => isSubtitle(e.name))

  if (!media.length) {
    if (subs.length && utils.hasMedia()) return subtitles.load(await readFile(subs[0]))
    if (subs.length) return toast("Open a video first, then drop the subtitles onto it")
    return toast("No playable files found. Try MP4, MKV, WebM, MP3…")
  }

  for (const item of media) {
    const match = subs.find((s) => baseName(s.name) === baseName(item.name))
    if (match) item.subtitle = await readFile(match)
  }
  // A single subtitle dropped with a single video belongs to it whatever its name
  if (media.length === 1 && !media[0].subtitle && subs.length === 1) media[0].subtitle = await readFile(subs[0])

  await playlist.open(media, { append })
}

export const files = {
  async pick({ append = false } = {}) {
    if (!supportsHandles) {
      appendNext = append
      return fileInput.click()
    }
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: "Videos, audio and subtitles",
            accept: {
              "video/*": MEDIA_EXT.slice(0, 13),
              "audio/*": MEDIA_EXT.slice(13),
              "text/vtt": [".vtt"],
              "application/x-subrip": [".srt"],
            },
          },
        ],
      })
      await openEntries(handles.map((handle) => ({ name: handle.name, handle })), { append })
    } catch (error) {
      if (error.name !== "AbortError") console.warn(error)
      else console.info("The user cancelled the file picker.")
    }
  },

  async pickFolder() {
    if (!("showDirectoryPicker" in window)) return folderInput.click()
    try {
      const dir = await window.showDirectoryPicker({ mode: "read" })
      await openEntries(await walkDirectoryHandle(dir))
    } catch (error) {
      if (error.name !== "AbortError") console.warn(error)
    }
  },
}

// ----------------------------- DRAG & DROP -----------------------------
const hasFiles = (e) => e.dataTransfer?.types.includes("Files")

function showOverlay() {
  overlay.hidden = false
  document.querySelectorAll(".droppable").forEach((el) => (el.dataset.fileHover = true))
}

function hideOverlay() {
  overlay.hidden = true
  document.querySelectorAll(".droppable").forEach((el) => delete el.dataset.fileHover)
}

export function initFiles() {
  document.addEventListener("dragenter", (e) => {
    if (hasFiles(e)) showOverlay()
  })
  overlay.addEventListener("dragover", (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
  })
  overlay.addEventListener("dragleave", (e) => {
    if (e.target === overlay) hideOverlay()
  })
  overlay.addEventListener("drop", async (e) => {
    e.preventDefault()
    hideOverlay()
    const entries = await entriesFromDataTransfer(e.dataTransfer)
    openEntries(entries)
  })
  // Avoid the browser navigating to a file dropped anywhere else
  window.addEventListener("dragover", (e) => hasFiles(e) && e.preventDefault())
  window.addEventListener("drop", (e) => hasFiles(e) && e.preventDefault())

  document.querySelector("#file-picker").addEventListener("click", () => files.pick())
  document.querySelector("#folder-picker").addEventListener("click", () => files.pickFolder())
  document.querySelector("#playlist-add").addEventListener("click", () => files.pick({ append: true }))

  const fromInput = (input, options) => {
    input.addEventListener("change", () => {
      const entries = [...input.files].map((file) => ({ name: file.name, file }))
      input.value = ""
      openEntries(entries, options())
    })
  }
  fromInput(fileInput, () => {
    const append = appendNext
    appendNext = false
    return { append }
  })
  fromInput(folderInput, () => ({}))

  // Installed web app: files opened with "Open with → Local Video Player" from the OS
  if ("launchQueue" in window) {
    window.launchQueue.setConsumer((params) => {
      if (params.files?.length) openEntries(params.files.map((handle) => ({ name: handle.name, handle })))
    })
  }
}

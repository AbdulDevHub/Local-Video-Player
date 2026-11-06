// Play queue: built from several files or a folder, auto-advances when a video ends
import { elements, fileManagement } from "./player.js"
import { settings } from "./settings.js"
import { subtitles } from "./subtitles.js"
import { toast } from "./hud.js"

const panel = document.querySelector("#playlist-panel")
const list = document.querySelector("#playlist-list")
const count = document.querySelector("#playlist-count")
const nextBtn = document.querySelector(".next-btn")
const playlistBtn = document.querySelector(".playlist-btn")

// Item: { name, file?, handle?, subtitle?: File }
export const playlist = {
  items: [],
  index: -1,

  // autoplay: undefined = follow Settings; Continue watching passes false
  async open(items, { append = false, autoplay } = {}) {
    if (!items.length) return
    if (append && playlist.items.length) {
      playlist.items.push(...items)
      playlist.render()
      toast(`Added ${items.length} ${items.length === 1 ? "file" : "files"} to the playlist`)
      return
    }
    playlist.items = items
    await playlist.play(0, { autoplay })
    if (items.length > 1) toast(`Playlist: ${items.length} files`)
  },

  async play(index, { autoplay = settings.autoplay } = {}) {
    const item = playlist.items[index]
    if (!item) return
    try {
      await fileManagement.processFile(item)
    } catch (error) {
      console.warn("Could not open file:", error)
      toast(`Couldn't open “${item.name}”. It may have been moved or deleted.`)
      return
    }
    playlist.index = index
    if (item.subtitle) await subtitles.load(item.subtitle)
    if (autoplay) elements.video.play().catch(() => {}) // may be blocked until the user interacts
    playlist.render()
  },

  next() {
    if (playlist.index < playlist.items.length - 1) playlist.play(playlist.index + 1)
    else toast("End of playlist")
  },

  previous() {
    // Like music players: restart the current file unless we're near its beginning
    if (elements.video.currentTime > 5 || playlist.index <= 0) elements.video.currentTime = 0
    else playlist.play(playlist.index - 1)
  },

  remove(index) {
    if (index === playlist.index) return
    playlist.items.splice(index, 1)
    if (index < playlist.index) playlist.index--
    playlist.render()
  },

  togglePanel(force) {
    const open = force ?? panel.hidden
    panel.hidden = !open
    playlistBtn.classList.toggle("active", open)
    if (open) list.querySelector("[aria-current]")?.scrollIntoView({ block: "nearest" })
  },

  render() {
    const many = playlist.items.length > 1
    nextBtn.hidden = !many || playlist.index >= playlist.items.length - 1
    count.textContent = many ? `${playlist.index + 1} / ${playlist.items.length}` : ""

    list.replaceChildren(
      ...playlist.items.map((item, i) => {
        const li = document.createElement("li")
        const button = document.createElement("button")
        button.type = "button"
        button.className = "playlist-item"
        button.innerHTML = `<span class="num"></span><span class="name"></span>`
        button.querySelector(".num").textContent = i === playlist.index ? "▶" : i + 1
        button.querySelector(".name").textContent = item.name.replace(/\.[^.]+$/, "")
        button.title = item.name
        if (i === playlist.index) button.setAttribute("aria-current", "true")
        button.addEventListener("click", () => playlist.play(i))
        li.append(button)

        if (i !== playlist.index) {
          const remove = document.createElement("button")
          remove.type = "button"
          remove.className = "material-icon remove"
          remove.textContent = "close"
          remove.setAttribute("aria-label", `Remove ${item.name} from playlist`)
          remove.addEventListener("click", () => playlist.remove(i))
          li.append(remove)
        }
        return li
      })
    )

    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("nexttrack", many ? playlist.next : null)
      navigator.mediaSession.setActionHandler("previoustrack", many ? playlist.previous : null)
    }
  },
}

export function initPlaylist() {
  playlistBtn.addEventListener("click", () => playlist.togglePanel())
  document.querySelector("#playlist-close").addEventListener("click", () => playlist.togglePanel(false))
  nextBtn.addEventListener("click", playlist.next)

  elements.video.addEventListener("ended", () => {
    if (playlist.index < playlist.items.length - 1) {
      const next = playlist.items[playlist.index + 1]
      toast(`Up next: ${next.name.replace(/\.[^.]+$/, "")}`)
      playlist.play(playlist.index + 1, { autoplay: true })
    }
  })
}

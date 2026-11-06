// New shortcuts and power tools (A-B loop, frame stepping, screenshots, % jumps) plus on-screen
// feedback for the original shortcuts. The original key handler in player.js runs first.
import { bus, elements, utils, fileManagement, state as playerState } from "./player.js"
import { hud, toast } from "./hud.js"
import { playlist } from "./playlist.js"
import { subtitles } from "./subtitles.js"
import { files } from "./files.js"
import { shortcutsDialog } from "./shortcuts.js"

const video = elements.video
const loopEl = document.querySelector("#loop-range")
const loop = { a: null, b: null }
let frameDuration = 1 / 30
const fmt = (t) => utils.secondsToTime(Math.max(0, t || 0))

// ----------------------------- A-B LOOP -----------------------------
function renderLoop() {
  const { duration } = video
  if (loop.a === null || !Number.isFinite(duration)) return (loopEl.hidden = true)
  loopEl.hidden = false
  const end = loop.b ?? loop.a
  loopEl.style.left = `${(loop.a / duration) * 100}%`
  loopEl.style.width = `${((end - loop.a) / duration) * 100}%`
  loopEl.classList.toggle("partial", loop.b === null)
}

function setLoopPoint(which) {
  const t = video.currentTime
  if (which === "a") {
    loop.a = t
    if (loop.b !== null && loop.b <= t) loop.b = null
    hud.show("repeat", `Loop start ${fmt(t)}`)
  } else {
    if (loop.a === null || t <= loop.a) loop.a = Math.max(0, Math.min(t - 5, loop.a ?? 0))
    loop.b = t
    hud.show("repeat_on", `Looping ${fmt(loop.a)} → ${fmt(t)}`)
  }
  renderLoop()
}

function clearLoop(silent) {
  if (loop.a === null && loop.b === null) return
  loop.a = loop.b = null
  renderLoop()
  if (!silent) hud.show("repeat", "Loop cleared")
}

// ----------------------------- FRAMES & SCREENSHOTS -----------------------------
function stepFrame(direction) {
  if (!video.paused) video.pause()
  video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + direction * frameDuration))
  hud.show(direction > 0 ? "chevron_right" : "chevron_left", `Frame ${fmt(video.currentTime)}`)
}

// Learns the real frame rate from presented frames while playing at 1×
function trackFrameRate() {
  if (!("requestVideoFrameCallback" in HTMLVideoElement.prototype)) return
  let last = null
  const onFrame = (_now, meta) => {
    if (last && video.playbackRate === 1 && meta.presentedFrames - last.presentedFrames === 1) {
      const d = meta.mediaTime - last.mediaTime
      if (d > 0.004 && d < 0.1) frameDuration = d
    }
    last = meta
    video.requestVideoFrameCallback(onFrame)
  }
  video.requestVideoFrameCallback(onFrame)
}

function screenshot() {
  if (!video.videoWidth) return hud.show("hide_image", "Nothing to capture")
  const canvas = document.createElement("canvas")
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  canvas.getContext("2d").drawImage(video, 0, 0)
  canvas.toBlob((blob) => {
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${elements.fileName.textContent} ${fmt(video.currentTime).replaceAll(":", "-")}.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    hud.show("photo_camera", "Screenshot saved")
  }, "image/png")
}

// ----------------------------- KEYS -----------------------------
function onKeyDown(e) {
  if (e.ctrlKey || e.altKey || e.metaKey) return
  if (e.key === "?") return shortcutsDialog.toggle()
  if (e.shiftKey || utils.isOverlayOpen()) return

  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (key === "o") return files.pick()
  if (key === "Escape" && !document.querySelector("#playlist-panel").hidden) return playlist.togglePanel(false)
  if (!utils.hasMedia()) return

  const actions = {
    n: playlist.next,
    b: playlist.previous,
    l: () => playlist.togglePanel(),
    y: subtitles.toggle,
    i: screenshot,
    "[": () => setLoopPoint("a"),
    "]": () => setLoopPoint("b"),
    "\\": () => clearLoop(),
    ",": () => stepFrame(-1),
    ".": () => stepFrame(1),
    // Feedback for the original shortcuts (their actions already ran)
    ArrowLeft: () => hud.show("replay_10", `−10s · ${fmt(video.currentTime)}`),
    ArrowRight: () => hud.show("forward_10", `+10s · ${fmt(video.currentTime)}`),
    ArrowUp: showVolume,
    ArrowDown: showVolume,
    m: showVolume,
    c: () => hud.show("crop", video.style.objectFit === "cover" ? "Crop to fill" : "Fit to screen"),
    u: () => hud.show("aspect_ratio", playerState.stretchingModeActive ? "Stretch to fill" : "Original aspect"),
  }
  if (/^[0-9]$/.test(key) && Number.isFinite(video.duration)) {
    video.currentTime = (video.duration * Number(key)) / 10
    return hud.show("start", `${key}0% · ${fmt(video.currentTime)}`)
  }
  if (actions[key]) {
    if (key.length === 1 || key === "Escape") e.preventDefault()
    actions[key]()
  }
}

function showVolume() {
  const value = elements.volumeControls.valueAsNumber
  hud.show(value === 0 ? "volume_off" : value > 100 ? "campaign" : "volume_up", value === 0 ? "Muted" : `Volume ${value}%`)
}

export function initTools() {
  document.addEventListener("keydown", onKeyDown)
  trackFrameRate()

  video.addEventListener("timeupdate", () => {
    if (loop.a !== null && loop.b !== null && video.currentTime >= loop.b) video.currentTime = loop.a
  })
  video.addEventListener("loadedmetadata", renderLoop)
  bus.addEventListener("media:loaded", () => clearLoop(true))

  // Feedback for speed changes from any source (keys, buttons, restored state)
  video.addEventListener("ratechange", () => {
    if (utils.hasMedia()) hud.show("speed", `${video.playbackRate.toFixed(2).replace(/0$/, "")}×`)
  })
  video.addEventListener("play", () => hud.pulse("play_arrow"))
  video.addEventListener("pause", () => {
    if (!video.ended && utils.hasMedia()) hud.pulse("pause")
  })

  bus.addEventListener("media:resumed", ({ detail }) => {
    toast(`Resumed at ${fmt(detail.time)}`, {
      action: { label: "Start over", onClick: () => (video.currentTime = 0) },
      timeout: 6000,
    })
  })

  document.querySelector(".home-btn").addEventListener("click", () => {
    playlist.togglePanel(false)
    fileManagement.close()
  })
}

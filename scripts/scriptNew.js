"use strict"

// ----------------------------- GLOBAL VARIABLES -----------------------------
const preferences = { timeSkip: 10 }
let localStorageKey
let stretchedFullscreenActive = false
let pressedGKey = false
let stretchingModeActive = false
let isVideoReady = false
let originalTime
let isActivated = false
let scaleX = 1
let scaleY = 1

const elements = {
  dragPanel: document.querySelector("#drag-panel"),
  dropOverlay: document.querySelector("#drop-overlay"),
  droppableElements: document.querySelectorAll(".droppable"),
  fileName: document.querySelector("#file-name"),
  video: document.querySelector("video"),
  seekerPreview: document.querySelector("#seeker-preview"),
  filePicker: document.querySelector("#file-picker"),
  player: document.querySelector(".player"),
  playBtn: document.querySelector(".play-btn"),
  fullscreenBtn: document.querySelector(".fullscreen-btn"),
  zoomBtn: document.querySelector(".zoom-btn"),
  speedControls: document.querySelector("#speed-controls"),
  controls: document.querySelector(".controls"),
  progressBar: document.querySelector("#video-bar"),
  previewBar: document.querySelector("#preview-bar"),
  timeIndicator: document.querySelector("#time-indicator"),
  currentTime: document.querySelector(".current-time"),
  timeRemaining: document.querySelector(".time-remaining"),
  replayBtn: document.querySelector(".replay-btn"),
  forwardBtn: document.querySelector(".forward-btn"),
  duration: document.querySelector(".duration"),
}

// ----------------------------- EVENT LISTENERS -----------------------------
function initializeEventListeners() {
  elements.droppableElements.forEach((droppable) => {
    droppable.addEventListener("dragenter", handleDragEnter)
  })
  elements.dropOverlay.addEventListener("dragover", (e) => e.preventDefault())
  elements.dropOverlay.addEventListener("drop", handleDrop)
  elements.dropOverlay.addEventListener("dragleave", handleDragEnd)
  elements.filePicker.addEventListener("click", openFilePicker)

  elements.playBtn.onclick = elements.video.onclick = togglePlay
  elements.video.onpause = () => (elements.playBtn.textContent = "play_arrow")
  elements.video.onplay = () => (elements.playBtn.textContent = "pause")

  elements.fullscreenBtn.onclick = toggleStretchedFullScreen
  document.onfullscreenchange = updateFullScreenIcon
  elements.video.addEventListener("dblclick", toggleFullScreen)

  document.addEventListener("visibilitychange", handleVisibilityChange)
}

// ----------------------------- VIDEO SELECTION -----------------------------
function handleDragEnter(e) {
  if (e.dataTransfer.items[0].type.startsWith("video/")) {
    e.target.dataset.fileHover = true
    elements.dropOverlay.hidden = false
    console.info(`A video file has entered #${e.target.id}'s dragging area.`)
  }
}

async function handleDrop(e) {
  e.preventDefault()
  const fileHandle = await e.dataTransfer.items[0].getAsFileSystemHandle()
  manageFileHandle(fileHandle)
  handleDragEnd()
  console.info(`A ${e.dataTransfer.items[0].type} file was dropped.`)
}

function handleDragEnd() {
  elements.dropOverlay.hidden = true
  elements.droppableElements.forEach((el) => delete el.dataset.fileHover)
  console.info("The drag event has ended. The drop overlay was hidden.")
}

async function openFilePicker() {
  try {
    const [fileHandle] = await window.showOpenFilePicker({
      excludeAcceptAllOption: true,
      types: [
        {
          description: "Videos",
          accept: {
            "video/*": [
              ".avi",
              ".mp4",
              ".mpeg",
              ".ogv",
              ".ts",
              ".webm",
              ".3gp",
              ".3g2",
            ],
          },
        },
      ],
      multiple: false,
    })
    manageFileHandle(fileHandle)
  } catch {}
}

async function manageFileHandle(fileHandle) {
  const file = await fileHandle.getFile()

  if (elements.video.src) {
    console.info(
      "Video change detected, saving old video state in local storage…"
    )
    updateLocalStorage()
    URL.revokeObjectURL(elements.video.src)
  } else {
    elements.dragPanel.hidden = true
    elements.player.hidden = false
    console.info("The drag panel was hidden. The player is now visible.")
  }

  localStorageKey = await hashFile(file)
  elements.video.src = URL.createObjectURL(file)
  elements.video.addEventListener("seeked", updateMediaSession, { once: true })

  // Remove file extension
  elements.fileName.textContent = file.name.replace(/\.[^.]+$/, "")

  // Bind global media controls to video
  ;[
    ["seekbackward", replay],
    ["seekforward", forward],
  ].forEach(([action, handler]) =>
    navigator.mediaSession.setActionHandler(action, handler)
  )
}

function updateMediaSession() {
  const artwork = captureFrame()
  navigator.mediaSession.metadata = new MediaMetadata({
    title: elements.fileName.textContent,
    artwork: [{ src: artwork, sizes: "512x512", type: "image/png" }],
  })
  console.info("Title and artwork for Global Media Controls updated.")
}

// ----------------------------- CONTROL PANEL [BOTTOM NAVIGATION] -----------------------------
const fullscreenActions = {
  toggleStretchedFullScreen() {
    stretchedFullscreenActive ? exitFullScreen() : enterFullScreen()
  },

  enterFullScreen() {
    elements.player.requestFullscreen()
    if (!stretchingModeActive) toggleStretchVideo()
    stretchedFullscreenActive = true
  },

  exitFullScreen() {
    document.exitFullscreen()
    if (stretchingModeActive) toggleStretchVideo()
    stretchedFullscreenActive = false
  },

  updateFullScreenIcon() {
    elements.fullscreenBtn.textContent = stretchedFullscreenActive
      ? "fullscreen_exit"
      : "fullscreen"
  },

  toggleFullScreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen()
      if (elements.controls.classList.contains("hidden")) {
        elements.controls.classList.remove("hidden")
        elements.previewBar.style.display = "none"
      }
      stretchedFullscreenActive = false
    } else elements.player.requestFullscreen()
  },
}

// Zoom and Stretch Functionality
elements.zoomBtn.onclick = toggleZoom

function toggleZoom() {
  if (!elements.controls.classList.contains("hidden")) {
    elements.controls.classList.add("hidden")
  } else {
    elements.controls.classList.remove("hidden")
    elements.previewBar.style.display = "none"
  }
  if (stretchedFullscreenActive) {
    toggleStretchVideo()
    toggleStretchVideo()
  } else fullscreenActions.toggleStretchedFullScreen()
}

function toggleZoomCrop() {
  const isZoomedIn = elements.zoomBtn.textContent === "zoom_out_map"
  elements.video.style.objectFit = isZoomedIn ? "cover" : "contain"
  elements.zoomBtn.textContent = isZoomedIn ? "crop_free" : "zoom_out_map"
}

// Playback Speed Handling
function updatePlaybackRate() {
  elements.speedControls.value = parseFloat(
    elements.speedControls.value
  ).toFixed(2)
  elements.video.playbackRate = clamp(0.1, elements.speedControls.value, 16)
}

elements.video.onratechange = () =>
  (elements.speedControls.value = elements.video.playbackRate.toFixed(2))
elements.speedControls.onchange = elements.speedControls.oninput =
  updatePlaybackRate

// ----------------------------- TIME -----------------------------
elements.video.addEventListener("loadedmetadata", initializeVideo)
elements.video.addEventListener("timeupdate", updateTimeAndProgress)
elements.video.addEventListener(
  "emptied",
  () => (elements.playBtn.textContent = "play_arrow")
)
elements.progressBar.addEventListener("input", seekVideo)
elements.progressBar.onfocus = () => elements.progressBar.blur()
elements.replayBtn.onclick = replay
elements.forwardBtn.onclick = forward

// Time and Progress Utilities
const timeUtils = {
  secondsToTime(seconds) {
    // Convert seconds to time in format (h:)mm:ss
    return new Date(seconds * 1000)
      .toISOString()
      .substring(seconds >= 3600 ? 12 : 14, 19)
  },

  updateTimeAndProgress() {
    if (elements.video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      updateProgressBarValue()
      updateIndicators()
    } else console.info("Video metadata not loaded yet.")
  },
}

function initializeVideo() {
  localStorage.getItem(localStorageKey)
    ? restoreFromLocalStorage()
    : console.info("No video state found in local storage.")
  updateProgressBarValue()
  updateIndicators()
  elements.duration.textContent = timeUtils.secondsToTime(
    elements.video.duration
  )
}

function seekVideo() {
  elements.video.currentTime =
    (elements.progressBar.valueAsNumber * elements.video.duration) / 100
  updateIndicators()
}

function updateProgressBarValue() {
  elements.progressBar.valueAsNumber =
    (elements.video.currentTime * 100) / elements.video.duration
}

function updateIndicators() {
  const progressBarValue = elements.progressBar.valueAsNumber
  elements.progressBar.style.setProperty("--progress", `${progressBarValue}%`)
  elements.previewBar.style.setProperty("--progress", `${progressBarValue}%`)
  elements.currentTime.textContent = timeUtils.secondsToTime(
    elements.video.currentTime
  )
  elements.timeRemaining.textContent = `-${timeUtils.secondsToTime(
    elements.video.duration - elements.video.currentTime
  )}`
}

function replay() {
  elements.video.currentTime = Math.max(
    elements.video.currentTime - preferences.timeSkip,
    0
  )
}

function forward() {
  elements.video.currentTime = Math.min(
    elements.video.currentTime + preferences.timeSkip,
    elements.video.duration
  )
}

// Toggle current time/remaining time
elements.timeIndicator.addEventListener("click", () => {
  ;[elements.timeRemaining.hidden, elements.currentTime.hidden] = [
    elements.currentTime.hidden,
    elements.timeRemaining.hidden,
  ]
})

// Save time in local storage when window closed/refreshed
window.onbeforeunload = () => {
  if (elements.video.src && !elements.video.ended) updateLocalStorage()
}

// CLEANUP
console.groupCollapsed(
  "Saved states of videos last opened more than 30 days ago will be deleted."
)
Object.keys(localStorage).forEach((key) => {
  const entryDate = new Date(JSON.parse(localStorage.getItem(key)).last_opened)
  const isExpired = entryDate < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  isExpired ? localStorage.removeItem(key) : console.info(`${key} kept.`)
})
console.groupEnd()

elements.video.onended = () => {
  localStorage.removeItem(localStorageKey)
  console.info("Video ended. Video state deleted from local storage.")
}

// Basic Video Features
const videoFeatures = {
  togglePlay() {
    elements.video.paused ? elements.video.play() : elements.video.pause()
  },

  toggleMute() {
    elements.video.muted = !elements.video.muted
  },

  togglePictureInPicture() {
    document.pictureInPictureElement
      ? document.exitPictureInPicture()
      : elements.video.requestPictureInPicture()
  },
}

// ----------------------------- KEYBOARD SHORTCUTS -----------------------------
function setupKeyboardShortcuts() {
  document.addEventListener("keydown", handleKeyboardShortcuts)
  document.addEventListener("keydown", handleCtrlStretch)
}

function handleKeyboardShortcuts(e) {
  // Ignore key presses when a modifier key is pressed
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
  if (e.key !== " ") document.activeElement.blur()

  const keyActions = {
    " ": () => {
      // Toggle play
      if (document.activeElement.tagName !== "BUTTON")
        videoFeatures.togglePlay()
    },
    g: () => {
      // Toggle stretched full screen
      pressedGKey = true
      if (
        stretchedFullscreenActive &&
        elements.controls.classList.contains("hidden")
      ) {
        toggleStretchVideo()
        document.exitFullscreen()
        if (!elements.controls.classList.contains("hidden")) {
          elements.controls.classList.add("hidden")
        } else {
          elements.controls.classList.remove("hidden")
          elements.previewBar.style.display = "none"
        }
        stretchedFullscreenActive = false
      } else toggleZoom()
    },
    d: () => {
      // Slow down
      elements.speedControls.stepDown()
      elements.speedControls.dispatchEvent(new Event("change"))
    },
    s: () => {
      // Speed up
      elements.speedControls.stepUp()
      elements.speedControls.dispatchEvent(new Event("change"))
    },
    ArrowLeft: () => {
      // Rewind
      if (document.activeElement.tagName !== "INPUT") replay()
    },
    ArrowRight: () => {
      // Advance
      if (document.activeElement.tagName !== "INPUT") forward()
    },
    a: () => {
      // Reset speed
      elements.video.playbackRate = elements.video.defaultPlaybackRate
    },
    q: () => {
      // Preferred fast speed
      if (elements.video.playbackRate === 1.7) elements.video.playbackRate = 1
      else elements.video.playbackRate = 1.7
    },
    w: () => {
      // Preferred fast speed
      if (elements.video.playbackRate === 2) elements.video.playbackRate = 1
      else elements.video.playbackRate = 2
    },
    e: () => {
      // Preferred fast speed
      if (elements.video.playbackRate === 2.7) elements.video.playbackRate = 1
      else elements.video.playbackRate = 2.7
    },
    t: () => {
      // Preferred fast speed
      if (elements.video.playbackRate === 4) elements.video.playbackRate = 1
      else elements.video.playbackRate = 4
    },
    r: () => {
      // Traverse Speeds
      if (elements.video.playbackRate === 3) elements.video.playbackRate = 4
      else elements.video.playbackRate = 3
    },
    h: () => {
      // Hide Playbar/Controls
      if (stretchedFullscreenActive) {
        if (elements.controls.classList.contains("hidden")) {
          toggleStretchVideo()
          if (!elements.controls.classList.contains("hidden")) {
            elements.controls.classList.add("hidden")
          } else {
            elements.controls.classList.remove("hidden")
            elements.previewBar.style.display = "none"
          }
          toggleStretchVideo()
        } else toggleZoom()
      } else {
        if (elements.controls.classList.contains("hidden")) {
          elements.controls.classList.remove("hidden")
          elements.previewBar.style.display = "none"
        } else {
          elements.controls.classList.add("hidden")
        }
      }
    },
    v: () => {
      // Show Preview Bar
      if (elements.controls.classList.contains("hidden")) {
        if (
          !elements.previewBar.style.display ||
          elements.previewBar.style.display === "none"
        ) {
          elements.previewBar.style.display = "block"
        } else elements.previewBar.style.display = "none"
      }
    },
    m: toggleMute(), // Toggle mute
    c: toggleZoomCrop(), // Toggle zoom
    u: toggleStretchVideo(), // Toggle video stretching
    p: togglePictureInPicture(), // Toggle PiP
    f: () => {
      // Toggle full screen
      if (
        document.activeElement.tagName !== "BUTTON" &&
        document.activeElement.tagName !== "INPUT"
      ) {
        if (
          stretchedFullscreenActive &&
          elements.controls.classList.contains("hidden")
        ) {
          toggleStretchVideo()
          if (!elements.controls.classList.contains("hidden")) {
            elements.controls.classList.add("hidden")
          } else {
            elements.controls.classList.remove("hidden")
            elements.previewBar.style.display = "none"
          }
          toggleStretchVideo()
        } else {
          pressedGKey = true
          toggleStretchedFullScreen()
        }
      }
    },
  }

  // Key action execution
  const action = keyActions[e.key.toLowerCase()]
  if (action) action()
}

function handleCtrlStretch(e) {
  if (e.ctrlKey) {
    switch (e.key) {
      case "ArrowUp":
        scaleY += 0.01
        break
      case "ArrowDown":
        scaleY -= 0.01
        break
      case "ArrowRight":
        scaleX += 0.01
        break
      case "ArrowLeft":
        scaleX -= 0.01
        break
      default:
        scaleX = scaleY = 1
    }
    elements.video.style.transform = `scaleX(${scaleX}) scaleY(${scaleY})`
  }
  if (e.key === "u") elements.video.style.transform = `scaleX(1) scaleY(1)`
}

// Page is not visible (switched tab)
function handleVisibilityChange() {
  if (document.visibilityState === "hidden") {
    if (stretchingModeActive) toggleStretchVideo()
    elements.controls.classList.remove("hidden")
    elements.previewBar.style.display = "none"
    stretchedFullscreenActive = false
  }
}

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) {
    if (stretchingModeActive) toggleStretchVideo()
    if (elements.controls.classList.contains("hidden")) {
      elements.controls.classList.remove("hidden")
      elements.previewBar.style.display = "none"
    }
    stretchedFullscreenActive = false
  }
})

// ----------------------------- UTILITIES -----------------------------
function clamp(min, value, max) {
  return Math.min(Math.max(value, min), max)
}

async function hashFile(file) {
  const arrayBuffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest("SHA-1", arrayBuffer)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function updateLocalStorage() {
  let state = {
    timer: elements.video.currentTime,
    playbackRate: elements.video.playbackRate,
    last_opened: Date.now(),
  }
  localStorage.setItem(localStorageKey, JSON.stringify(state))
  console.info("Video state saved in local storage.")
}

function restoreFromLocalStorage() {
  let state = JSON.parse(localStorage.getItem(localStorageKey))
  elements.video.currentTime = state.timer
  elements.video.playbackRate = state.playbackRate
  console.info("Video state restored from local storage.")
}

function captureFrame() {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 512

  const scale = Math.min(
    canvas.width / elements.video.videoWidth,
    canvas.height / elements.video.videoHeight
  )
  const x = canvas.width / 2 - (elements.video.videoWidth / 2) * scale
  const y = canvas.height / 2 - (elements.video.videoHeight / 2) * scale
  const context = canvas.getContext("2d")
  context.drawImage(
    elements.video,
    x,
    y,
    elements.video.videoWidth * scale,
    elements.video.videoHeight * scale
  )
  return canvas.toDataURL()
}

// ----------------------------- VIDEO STRETCHING -----------------------------
elements.video.onloadedmetadata = () => {
  isVideoReady = true
  if (stretchedFullscreenActive) toggleStretchVideo()
}

function toggleStretchVideo() {
  if (!isVideoReady) return

  const aspect = elements.video.videoWidth / elements.video.videoHeight
  const mode =
    aspect >= 1.77
      ? elements.controls.classList.contains("hidden")
        ? "mode-1"
        : "fullscreen-mode-1"
      : elements.controls.classList.contains("hidden")
      ? "mode-2"
      : "fullscreen-mode-2"

  if (!stretchingModeActive) {
    stretchingModeActive = true
    elements.video.classList.add("stretchClass", mode)
    console.log(`Video stretching enabled. Mode: ${mode}`)
  } else {
    stretchingModeActive = false
    elements.video.classList.remove(
      "stretchClass",
      "mode-1",
      "mode-2",
      "fullscreen-mode-1",
      "fullscreen-mode-2"
    )
    console.log(`Video stretching disabled. Mode: ${mode}`)
  }
}

// ----------------------------- PROGRESS BAR SEEKER GIANT -----------------------------
window.addEventListener("keydown", (e) => {
  if (e.key === "A") {
    isActivated = !isActivated
    if (isActivated) {
      originalTime = elements.video.currentTime
      if (!elements.video.paused) elements.video.pause()
    } else elements.video.currentTime = originalTime
  }
})

window.addEventListener("mousemove", (e) => {
  if (!isActivated) return
  let rect = elements.progressBar.getBoundingClientRect()
  const percent = (e.clientX - rect.left) / rect.width
  elements.video.currentTime = percent * elements.video.duration
})

elements.progressBar.addEventListener("click", (e) => {
  if (!isActivated) return
  let rect = e.target.getBoundingClientRect()
  const percent = (e.clientX - rect.left) / rect.width
  originalTime = percent * elements.video.duration
  elements.video.currentTime = originalTime
  isActivated = false
})

elements.video.addEventListener("play", () => {
  if (isActivated) {
    isActivated = false
    originalTime = elements.video.currentTime
  }
})

// ----------------------------- PROGRESS BAR SEEKER SMALL -----------------------------
document.addEventListener("DOMContentLoaded", () => {
  const previewVideo = document.createElement("video")

  let isVideoLoaded = false
  let isSeekerActive = false
  let aspectRatio, seekerWidth

  elements.video.addEventListener("loadedmetadata", () => {
    isVideoLoaded = true
    aspectRatio = mainVideo.videoWidth / mainVideo.videoHeight
    seekerWidth = aspectRatio >= 1.77 ? 340 : 260
  })

  document.addEventListener(
    "keydown",
    (e) => (isSeekerActive = e.key === "a" ? !isSeekerActive : isSeekerActive)
  )
  elements.video.addEventListener("play", () => (isSeekerActive = false))
  elements.progressBar.addEventListener("click", () => (isSeekerActive = false))

  elements.progressBar.addEventListener("mousemove", (e) => {
    if (!isVideoLoaded || !isSeekerActive) return

    const rect = elements.progressBar.getBoundingClientRect()
    const percent = (e.clientX - rect.left) / rect.width
    const previewTime = percent * elements.video.duration
    const previewLeft = e.clientX - seekerWidth / 2

    elements.seekerPreview.style.left = `${previewLeft}px`
    elements.seekerPreview.style.display = "block"
    elements.previewVideo.src = elements.video.src
    elements.previewVideo.currentTime = previewTime
    elements.seekerPreview.innerHTML = `<div>${formatTime(previewTime)}</div>`
    elements.seekerPreview.prepend(previewVideo)
  })

  elements.progressBar.addEventListener(
    "mouseleave",
    () => (elements.seekerPreview.style.display = "none")
  )

  // Format time in M:SS
  function formatTime(time) {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${String(seconds).padStart(2, "0")}`
  }
})

// ----------------------------- INITIALIZATION CALL -----------------------------
function initApp() {
  initializeEventListeners()
  setupKeyboardShortcuts()

  // Event Bindings
  elements.video.addEventListener("timeupdate", timeUtils.updateTimeAndProgress)
  elements.video.addEventListener(
    "emptied",
    () => (elements.playBtn.textContent = "play_arrow")
  )
}

initApp()

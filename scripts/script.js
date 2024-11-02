"use strict"

// ----------------------------- GLOBAL VARIABLES -----------------------------
let preferences = { speed: 1.8, timeSkip: 10 }
let localStorageKey
let stretchedFullscreenActive = false
let pressedGKey = false
let stretchingModeActive = false
let isVideoReady = false
let originalTime
let isActivated = false

const dragPanel = document.querySelector("#drag-panel")
const dropOverlay = document.querySelector("#drop-overlay")
const droppableElements = document.querySelectorAll(".droppable")
const fileName = document.querySelector("#file-name")
const video = document.querySelector("video")
const filePicker = document.querySelector("#file-picker")

const player = document.querySelector(".player")
const playBtn = document.querySelector(".play-btn")
const fullscreenBtn = document.querySelector(".fullscreen-btn")
const zoomBtn = document.querySelector(".zoom-btn")
const speedControls = document.querySelector("#speed-controls")

const controls = document.querySelector(".controls")
const progressBar = document.querySelector("#video-bar")
const previewBar = document.querySelector("#preview-bar")
const timeIndicator = document.querySelector("#time-indicator")
const currentTime = document.querySelector(".current-time")
const timeRemaining = document.querySelector(".time-remaining")
const replayBtn = document.querySelector(".rewind-btn")
const forwardBtn = document.querySelector(".forward-btn")
const duration = document.querySelector(".duration")

// ----------------------------- VIDEO SELECTION -----------------------------
droppableElements.forEach((droppable) => {
  droppable.addEventListener("dragenter", handleDragEnter)
})
dropOverlay.addEventListener("dragover", (e) => e.preventDefault())
dropOverlay.addEventListener("drop", handleDrop)
dropOverlay.addEventListener("dragleave", handleDragEnd)
filePicker.addEventListener("click", openFilePicker)

function handleDragEnter(e) {
  if (e.dataTransfer.items[0].type.startsWith("video/")) {
    e.target.dataset.fileHover = true
    dropOverlay.hidden = false
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
  dropOverlay.hidden = true
  droppableElements.forEach((el) => delete el.dataset.fileHover)
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
            "video/*": [".avi", ".mp4", ".mpeg", ".ogv", ".ts", ".webm", ".3gp", ".3g2"],
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

  if (video.src) {
    console.info("A video change was detected. Saving the old video state in local storage…")
    updateLocalStorage()
    URL.revokeObjectURL(video.src)
  } else {
    dragPanel.hidden = true
    player.hidden = false
    console.info("The drag panel was hidden. The player is now visible.")
  }

  localStorageKey = await hashFile(file)
  video.src = URL.createObjectURL(file)

  // Remove file extension
  fileName.textContent = file.name.replace(/\.[^.]+$/, "")

  // Update media session on first play
  video.addEventListener("seeked", updateMediaSession, { once: true })

  // Bind global media controls to video
  ;[
    ["seekbackward", replay],
    ["seekforward", forward],
  ].forEach(([action, handler]) => navigator.mediaSession.setActionHandler(action, handler))
}

function updateMediaSession() {
  const artwork = captureFrame()
  navigator.mediaSession.metadata = new MediaMetadata({
    title: fileName.textContent,
    artwork: [{ src: artwork, sizes: "512x512", type: "image/png" }],
  })
  console.info("Title and artwork for Global Media Controls updated.")
}

// ----------------------------- CONTROL PLAYBACK [BOTTOM NAVIGATION] -----------------------------
// Play/pause
playBtn.onclick = video.onclick = togglePlay
video.onpause = () => (playBtn.textContent = "play_arrow")
video.onplay = () => (playBtn.textContent = "pause")

fullscreenBtn.onclick = handleFullScreenButton
document.onfullscreenchange = updateFullScreenIcon
video.addEventListener("dblclick", toggleFullScreen)

// Fullscreen
function handleFullScreenButton() {
  stretchedFullscreenActive ? exitFullScreen() : enterFullScreen()
}

function enterFullScreen() {
  player.requestFullscreen()
  if (!stretchingModeActive) toggleStretchVideo()
  stretchedFullscreenActive = true
}

function exitFullScreen() {
  document.exitFullscreen()
  if (stretchingModeActive) toggleStretchVideo()
  stretchedFullscreenActive = false
}

function updateFullScreenIcon() {
  fullscreenBtn.textContent = stretchedFullscreenActive ? "fullscreen_exit" : "fullscreen"
}

function toggleFullScreen() {
  if (document.fullscreenElement) {
    // Check if the document is currently in fullscreen
    document.exitFullscreen()
    if (controls.classList.contains("hidden")) {
      controls.classList.remove("hidden") // Show the controls if they're hidden
      previewBar.style.display = "none"
    }
    stretchedFullscreenActive = false
  } else player.requestFullscreen()
}

// Zoom
zoomBtn.onclick = toggleZoom

function toggleZoom() {
  if (!controls.classList.contains("hidden")) {
    controls.classList.add("hidden") // Hide the controls if they're not hidden
  } else {
    controls.classList.remove("hidden") // Show the controls if they're hidden
    previewBar.style.display = "none"
  }
  if (stretchedFullscreenActive) {
    toggleStretchVideo() // Update stretch mode based on new visibility state of video bar
    toggleStretchVideo()
  } else handleFullScreenButton() // Go fullscreen and stretch video
}

function toggleZoomCrop() {
  const isZoomedIn = zoomBtn.textContent === "zoom_out_map"
  video.style.objectFit = isZoomedIn ? "cover" : "contain"
  zoomBtn.textContent = isZoomedIn ? "crop_free" : "zoom_out_map"
}

// Speed
function updatePlaybackRate() {
  speedControls.value = parseFloat(speedControls.value).toFixed(2)
  video.playbackRate = clamp(0.1, speedControls.value, 16)
}

video.onratechange = () => (speedControls.value = video.playbackRate.toFixed(2))
speedControls.onchange = speedControls.oninput = updatePlaybackRate

// ----------------------------- TIME -----------------------------
video.addEventListener("loadedmetadata", initializeVideo)
video.addEventListener("timeupdate", updateTimeAndProgress)
video.addEventListener("emptied", () => (playBtn.textContent = "play_arrow"))
progressBar.addEventListener("input", seekVideo)
progressBar.onfocus = () => progressBar.blur()
replayBtn.onclick = replay
forwardBtn.onclick = forward

// Convert seconds to time in format (h:)mm:ss
function secondsToTime(seconds) {
  return new Date(seconds * 1000).toISOString().substring(seconds >= 3600 ? 12 : 14, 19)
}

function initializeVideo() {
  localStorage.getItem(localStorageKey)
    ? restoreFromLocalStorage()
    : console.info("No video state found in local storage.")
  updateProgressBarValue()
  updateIndicators()
  duration.textContent = secondsToTime(video.duration)
}

function updateTimeAndProgress() {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    updateProgressBarValue()
    updateIndicators()
  } else console.info("Video metadata not loaded yet. Skipping timeupdate event.")
}

function seekVideo() {
  video.currentTime = (progressBar.valueAsNumber * video.duration) / 100
  updateIndicators() // Need to show time in real-time when progress bar dragged
}

function updateProgressBarValue() {
  progressBar.valueAsNumber = (video.currentTime * 100) / video.duration
}

function updateIndicators() {
  progressBar.style.setProperty("--progress", `${progressBar.valueAsNumber}%`)
  previewBar.style.setProperty("--progress", `${progressBar.valueAsNumber}%`)
  currentTime.textContent = secondsToTime(video.currentTime)
  timeRemaining.textContent = `-${secondsToTime(video.duration - video.currentTime)}`
}

function replay() {
  video.currentTime = Math.max(video.currentTime - preferences.timeSkip, 0)
}

function forward() {
  video.currentTime = Math.min(video.currentTime + preferences.timeSkip, video.duration)
}

// Toggle current time/remaining time
timeIndicator.addEventListener("click", () => {
  ;[timeRemaining.hidden, currentTime.hidden] = [currentTime.hidden, timeRemaining.hidden]
})

// Save time in local storage when window is closed/refreshed
window.onbeforeunload = () => {
  if (video.src && !video.ended) updateLocalStorage()
}

// CLEANUP
console.groupCollapsed("Saved states of videos last opened more than 30 days ago will be deleted.")
Object.keys(localStorage).forEach((key) => {
  const entryDate = new Date(JSON.parse(localStorage.getItem(key)).last_opened)
  const isExpired = entryDate < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  isExpired ? localStorage.removeItem(key) : console.info(`${key} kept.`)
})
console.groupEnd()

video.onended = () => {
  localStorage.removeItem(localStorageKey)
  console.info("Video ended. Video state deleted from local storage.")
}

// ----------------------------- KEYBOARD SHORTCUTS -----------------------------
document.addEventListener("keydown", (e) => {
  // Ignore key presses when a modifier key is pressed
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
  if (e.key !== " ") document.activeElement.blur()

  switch (e.key) {
    case " ": // Toggle play
      if (document.activeElement.tagName === "BUTTON") break
      togglePlay()
      break
    case "g":
    case "G":
      pressedGKey = true
      if (stretchedFullscreenActive && controls.classList.contains("hidden")) {
        // If video is in fullscreen state
        toggleStretchVideo() // Exit fullscreen and unstretch the video
        document.exitFullscreen()
        if (!controls.classList.contains("hidden")) {
          controls.classList.add("hidden") // Hide controls if they're not hidden
        } else {
          controls.classList.remove("hidden") // Show controls if they're hidden
          previewBar.style.display = "none"
        }
        stretchedFullscreenActive = false
      } else {
        toggleZoom()
      }
      break
    case "d": // Slow down
    case "D":
      speedControls.stepDown()
      speedControls.dispatchEvent(new Event("change"))
      break
    case "s": // Speed up
    case "S":
      speedControls.stepUp()
      speedControls.dispatchEvent(new Event("change"))
      break
    case "ArrowLeft": // Rewind
      if (document.activeElement.tagName !== "INPUT") replay()
      break
    case "ArrowRight": // Advance
      if (document.activeElement.tagName !== "INPUT") forward()
      break
    case "a": // Reset speed
    case "A":
      video.playbackRate = video.defaultPlaybackRate
      break
    case "q": // Preferred fast speed
    case "Q":
      if (video.playbackRate === 1.7) video.playbackRate = 1
      else video.playbackRate = 1.7
      break
    case "w": // Preferred fast speed
    case "W":
      if (video.playbackRate === 2) video.playbackRate = 1
      else video.playbackRate = 2
      break
    case "e": // Preferred fast speed
    case "E":
      if (video.playbackRate === 2.7) video.playbackRate = 1
      else video.playbackRate = 2.7
      break
    case "t": // Preferred fast speed
    case "T":
      if (video.playbackRate === 4) video.playbackRate = 1
      else video.playbackRate = 4
      break
    case "r": // Traverse Speeds
    case "R":
      if (video.playbackRate === 3) video.playbackRate = 4
      else video.playbackRate = 3
      break
    case "h":
    case "H": // Hide Playbar/Controls
      if (stretchedFullscreenActive) {
        // If the video is in fullscreen state
        if (controls.classList.contains("hidden")) {
          // Same as pressing 'f'
          toggleStretchVideo()
          if (!controls.classList.contains("hidden")) {
            controls.classList.add("hidden") // Hide the controls if they're not hidden
          } else {
            controls.classList.remove("hidden") // Show the controls if they're hidden
            previewBar.style.display = "none"
          }
          toggleStretchVideo()
        } else {
          // Same as pressing 'g'
          toggleZoom()
        }
      } else {
        // If not in fullscreen mode, hide the video bar normally
        if (controls.classList.contains("hidden")) {
          controls.classList.remove("hidden")
          previewBar.style.display = "none"
        } else {
          controls.classList.add("hidden")
        }
      }
      break
    case "v": // Show Preview Bar
    case "V":
      if (controls.classList.contains("hidden")) {
        if (!previewBar.style.display || previewBar.style.display === "none") {
          previewBar.style.display = "block"
        } else {
          previewBar.style.display = "none"
        }
      }
      break
    case "m": // Toggle mute
      toggleMute()
      break
    case "c": // Toggle zoom
      toggleZoomCrop()
      break
    case "u": // Toggle video stretching
      toggleStretchVideo()
      break
    case "p": // Toggle PiP
      togglePictureInPicture()
      break
    case "f":
    case "F":
      if (
        document.activeElement.tagName !== "BUTTON" &&
        document.activeElement.tagName !== "INPUT"
      ) {
        if (stretchedFullscreenActive && controls.classList.contains("hidden")) {
          // If the video is in fullscreen state
          toggleStretchVideo()
          if (!controls.classList.contains("hidden")) {
            controls.classList.add("hidden") // Hide the controls if they're not hidden
          } else {
            controls.classList.remove("hidden") // Show the controls if they're hidden
            previewBar.style.display = "none"
          }
          toggleStretchVideo()
        } else {
          pressedGKey = true // Set the variable to true when 'f' is pressed
          handleFullScreenButton()
        }
      }
  }
})

// ----------------------------- CTRL STRECH FEATURE -----------------------------
let scaleX = 1,
  scaleY = 1
document.addEventListener("keydown", (e) => {
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
        scaleX = 1
        scaleY = 1
    }
    video.style.transform = `scaleX(${scaleX}) scaleY(${scaleY})`
  }
})

document.addEventListener("keydown", (e) => {
  if (e.key === "u") video.style.transform = `scaleX(1) scaleY(1)`
})

// ----------------------------- BASIC VIDEO FEATURES -----------------------------
function togglePlay() {
  video.paused ? video.play() : video.pause()
}
function toggleMute() {
  video.muted = !video.muted
}
function clamp(min, value, max) {
  return Math.min(Math.max(value, min), max)
}
function togglePictureInPicture() {
  document.pictureInPictureElement
    ? document.exitPictureInPicture()
    : video.requestPictureInPicture()
}

// Add this function to check visibility state
function handleVisibilityChange() {
  if (document.visibilityState === "hidden") {
    // Page is not visible, perform actions here
    if (stretchingModeActive) toggleStretchVideo()
    controls.classList.remove("hidden")
    previewBar.style.display = "none"
    stretchedFullscreenActive = false
  }
}

// Attach the event listener for visibility change
document.addEventListener("visibilitychange", handleVisibilityChange)
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) {
    if (stretchingModeActive) toggleStretchVideo()
    if (controls.classList.contains("hidden")) {
      controls.classList.remove("hidden")
      previewBar.style.display = "none"
    }
    stretchedFullscreenActive = false
  }
})

// ----------------------------- VIDEO STRETCHING -----------------------------
video.onloadedmetadata = () => {
  isVideoReady = true
  if (stretchedFullscreenActive) toggleStretchVideo()
}

function toggleStretchVideo() {
  if (!isVideoReady) return

  // Calculate the scale factor based on the video's aspect ratio
  const aspect = video.videoWidth / video.videoHeight
  const mode =
    aspect >= 1.77
      ? controls.classList.contains("hidden")
        ? "mode-1"
        : "fullscreen-mode-1"
      : controls.classList.contains("hidden")
      ? "mode-2"
      : "fullscreen-mode-2"

  if (!stretchingModeActive) {
    stretchingModeActive = true
    video.classList.add("stretchClass", mode)
    console.log(`Video stretching enabled. Mode: ${mode}`)
  } else {
    stretchingModeActive = false
    video.classList.remove(
      "stretchClass",
      "mode-1",
      "mode-2",
      "fullscreen-mode-1",
      "fullscreen-mode-2"
    )
    console.log(`Video stretching disabled. Mode: ${mode}`)
  }
}

// ----------------------------- UTILITIES -----------------------------
async function hashFile(file) {
  const arrayBuffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest("SHA-1", arrayBuffer)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function updateLocalStorage() {
  let state = {
    timer: video.currentTime,
    playbackRate: video.playbackRate,
    last_opened: Date.now(),
  }
  localStorage.setItem(localStorageKey, JSON.stringify(state))
  console.info("Video state saved in local storage.")
}

function restoreFromLocalStorage() {
  let state = JSON.parse(localStorage.getItem(localStorageKey))
  video.currentTime = state.timer
  video.playbackRate = state.playbackRate
  console.info("Video state restored from local storage.")
}

function captureFrame() {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 512

  const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight)
  const x = canvas.width / 2 - (video.videoWidth / 2) * scale
  const y = canvas.height / 2 - (video.videoHeight / 2) * scale
  const context = canvas.getContext("2d")
  context.drawImage(video, x, y, video.videoWidth * scale, video.videoHeight * scale)
  return canvas.toDataURL()
}

// ----------------------------- PROGRESS BAR SEEKER GIANT -----------------------------
window.addEventListener("keydown", (e) => {
  if (e.key === "A") {
    isActivated = !isActivated
    if (isActivated) {
      originalTime = video.currentTime
      if (!video.paused) video.pause()
    } else video.currentTime = originalTime
  }
})

window.addEventListener("mousemove", (e) => {
  if (!isActivated) return
  let rect = progressBar.getBoundingClientRect()
  const percent = (e.clientX - rect.left) / rect.width
  video.currentTime = percent * video.duration
})

progressBar.addEventListener("click", (e) => {
  if (!isActivated) return
  let rect = e.target.getBoundingClientRect()
  const percent = (e.clientX - rect.left) / rect.width
  originalTime = percent * video.duration // Update original time to clicked position
  video.currentTime = originalTime // Update video's current time to clicked position
  isActivated = false
})

video.addEventListener("play", () => {
  if (isActivated) {
    isActivated = false
    originalTime = video.currentTime
  }
})

// ----------------------------- PROGRESS BAR SEEKER SMALL -----------------------------
document.addEventListener("DOMContentLoaded", () => {
  const videoBar = document.getElementById("video-bar")
  const seekerPreview = document.getElementById("seeker-preview")
  const mainVideo = document.getElementById("main-video")
  const previewVideo = document.createElement("video")

  let isVideoLoaded = false
  let isSeekerActive = false
  let aspectRatio, seekerWidth

  mainVideo.addEventListener("loadedmetadata", () => {
    isVideoLoaded = true
    aspectRatio = mainVideo.videoWidth / mainVideo.videoHeight
    seekerWidth = aspectRatio >= 1.77 ? 340 : 260
  })

  document.addEventListener(
    "keydown",
    (e) => (isSeekerActive = e.key === "a" ? !isSeekerActive : isSeekerActive)
  )
  mainVideo.addEventListener("play", () => (isSeekerActive = false))
  videoBar.addEventListener("click", () => (isSeekerActive = false))

  videoBar.addEventListener("mousemove", (e) => {
    if (!isVideoLoaded || !isSeekerActive) return

    const rect = videoBar.getBoundingClientRect()
    const percent = (e.clientX - rect.left) / rect.width
    const previewTime = percent * mainVideo.duration
    const previewLeft = e.clientX - seekerWidth / 2

    seekerPreview.style.left = `${previewLeft}px`
    seekerPreview.style.display = "block"
    previewVideo.src = mainVideo.src
    previewVideo.currentTime = previewTime
    seekerPreview.innerHTML = `<div>${formatTime(previewTime)}</div>`
    seekerPreview.prepend(previewVideo)
  })

  videoBar.addEventListener("mouseleave", () => (seekerPreview.style.display = "none"))

  // Helper function to format time in M:SS
  function formatTime(time) {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${String(seconds).padStart(2, "0")}`
  }
})

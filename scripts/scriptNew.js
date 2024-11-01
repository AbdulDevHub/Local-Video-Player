"use strict"

// ----------------------------- GLOBAL VARIABLES -----------------------------
const state = {
  preferences: { timeSkip: 10 },
  localStorageKey: null,
  stretchedFullscreenActive: false,
  pressedGKey: false,
  stretchingModeActive: false,
  isVideoReady: false,
  originalTime: null,
  scaleX: 1,
  scaleY: 1,
  isVideoLoaded: false,
  isGiantSeekerActive: false,
  isSmallSeekerActive: false,
  aspectRatio: null,
  seekerWidth: null,
}

const elements = {
  dragPanel: document.querySelector("#drag-panel"),
  dropOverlay: document.querySelector("#drop-overlay"),
  droppableElements: document.querySelectorAll(".droppable"),
  fileName: document.querySelector("#file-name"),
  video: document.querySelector("video"),
  seekerPreview: document.querySelector("#seeker-preview"),
  previewVideo: document.querySelector("#preview-video"),
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
  rewindBtn: document.querySelector(".rewind-btn"),
  forwardBtn: document.querySelector(".forward-btn"),
  duration: document.querySelector(".duration"),
}

// ----------------------------- UTILITIES -----------------------------
const utils = {
  clamp: (min, value, max) => Math.min(Math.max(value, min), max),

  async hashFile(file) {
    const arrayBuffer = await file.arrayBuffer()
    const hashBuffer = await crypto.subtle.digest("SHA-1", arrayBuffer)
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  },

  // Format time in M:SS
  formatTime(time) {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${String(seconds).padStart(2, "0")}`
  },

  secondsToTime(seconds) {
    // Convert seconds to time in format (h:)mm:ss
    return new Date(seconds * 1000).toISOString().substring(seconds >= 3600 ? 12 : 14, 19)
  },

  captureFrame() {
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
  },
}

// ----------------------------- LOCAL STORAGE MANAGEMENT -----------------------------
const storage = {
  save() {
    if (!elements.video.src || elements.video.ended) return
    const state = {
      timer: elements.video.currentTime,
      playbackRate: elements.video.playbackRate,
      last_opened: Date.now(),
    }
    localStorage.setItem(state.localStorageKey, JSON.stringify(state))
    console.info("Video state saved in local storage.")
  },

  restore() {
    const state = JSON.parse(localStorage.getItem(state.localStorageKey))
    elements.video.currentTime = state.timer
    elements.video.playbackRate = state.playbackRate
    console.info("Video state restored from local storage.")
  },

  cleanup() {
    console.log("Video states over 30 days will be deleted.")
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    Object.keys(localStorage).forEach((key) => {
      const entryDate = JSON.parse(localStorage.getItem(key)).last_opened
      if (new Date(entryDate) < new Date(thirtyDaysAgo)) localStorage.removeItem(key)
    })
  },
}

// ----------------------------- VIDEO CONTROLS -----------------------------
const videoControls = {
  togglePlay() {
    elements.video.paused ? elements.video.play() : elements.video.pause()
  },

  toggleMute() {
    elements.video.muted = !elements.video.muted
  },

  async togglePictureInPicture() {
    document.pictureInPictureElement
      ? await document.exitPictureInPicture()
      : await elements.video.requestPictureInPicture()
  },

  updatePlaybackRate() {
    elements.speedControls.value = parseFloat(elements.speedControls.value).toFixed(2)
    elements.video.playbackRate = utils.clamp(0.1, elements.speedControls.value, 16)
  },

  rewind() {
    elements.video.currentTime = Math.max(
      elements.video.currentTime - state.preferences.timeSkip,
      0
    )
  },

  forward() {
    elements.video.currentTime = Math.min(
      elements.video.currentTime + state.preferences.timeSkip,
      elements.video.duration
    )
  },

  updateProgressBarValue() {
    elements.progressBar.valueAsNumber =
      (elements.video.currentTime * 100) / elements.video.duration
  },

  updateTimeAndProgress() {
    if (elements.video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      this.updateProgressBarValue()
      this.updateIndicators()
    } else console.info("Video metadata not loaded yet.")
  },

  updateIndicators() {
    this.updateProgressBarValue()
    this.updateTimeDisplay()
  },

  updateProgressBar() {
    const progressBarValue = elements.progressBar.valueAsNumber
    elements.progressBar.style.setProperty("--progress", `${progressBarValue}%`)
    elements.previewBar.style.setProperty("--progress", `${progressBarValue}%`)
  },

  updateTimeDisplay() {
    elements.currentTime.textContent = utils.secondsToTime(elements.video.currentTime)
    elements.timeRemaining.textContent = `-${utils.secondsToTime(
      elements.video.duration - elements.video.currentTime
    )}`
  },
}

// ----------------------------- FULLSCREEN HANDLING -----------------------------
const fullscreenHandler = {
  async toggle() {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
      if (elements.controls.classList.contains("hidden")) {
        elements.controls.classList.remove("hidden")
        elements.previewBar.style.display = "none"
      }
      state.stretchedFullscreenActive = false
    } else await elements.player.requestFullscreen()
  },

  handleExit() {
    if (state.stretchingModeActive) videoStretching.toggle()
    if (elements.controls.classList.contains("hidden")) {
      elements.controls.classList.remove("hidden")
      elements.previewBar.style.display = "none"
    }
    state.stretchedFullscreenActive = false
  },

  updateIcon() {
    elements.fullscreenBtn.textContent = state.stretchedFullscreenActive
      ? "fullscreen_exit"
      : "fullscreen"
  },
}

// ----------------------------- VIDEO STRETCHING -----------------------------
const videoStretching = {
  getStretchMode() {
    const aspect = elements.video.videoWidth / elements.video.videoHeight
    const hasHiddenControls = elements.controls.classList.contains("hidden")
    return aspect >= 1.77
      ? hasHiddenControls
        ? "mode-1"
        : "fullscreen-mode-1"
      : hasHiddenControls
      ? "mode-2"
      : "fullscreen-mode-2"
  },

  toggle() {
    if (!state.isVideoReady) return

    const mode = this.getStretchMode()
    if (!state.stretchingModeActive) {
      state.stretchingModeActive = true
      elements.video.classList.add("stretchClass", mode)
    } else {
      state.stretchingModeActive = false
      elements.video.classList.remove(
        "stretchClass",
        "mode-1",
        "mode-2",
        "fullscreen-mode-1",
        "fullscreen-mode-2"
      )
    }
  },

  async toggleStretchedFullscreen() {
    if (state.stretchedFullscreenActive) {
      await document.exitFullscreen()
      if (state.stretchingModeActive) this.toggle()
    } else {
      await elements.player.requestFullscreen()
      if (!state.stretchingModeActive) this.toggle()
    }
    state.stretchedFullscreenActive = !state.stretchedFullscreenActive
  },
}

// ----------------------------- EVENT HANDLERS -----------------------------
const eventHandlers = {
  handleDrop: async (e) => {
    e.preventDefault()
    const fileHandle = await e.dataTransfer.items[0].getAsFileSystemHandle()
    fileManagement.processFile(fileHandle)
    fileManagement.handleDragEnd()
    console.info(`A ${e.dataTransfer.items[0].type} file was dropped.`)
  },

  handleKeyboardShortcuts: (e) => {
    // Ignore key presses when a modifier key is pressed
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
    if (e.key !== " ") document.activeElement.blur()

    const keyActions = {
      " ": () => {
        // Toggle play
        if (document.activeElement.tagName !== "BUTTON") videoControls.togglePlay()
      },
      g: () => {
        // Toggle stretched full screen
        state.pressedGKey = true
        if (state.stretchedFullscreenActive && elements.controls.classList.contains("hidden")) {
          videoStretching.toggle()
          document.exitFullscreen()
          if (!elements.controls.classList.contains("hidden")) {
            elements.controls.classList.add("hidden")
          } else {
            elements.controls.classList.remove("hidden")
            elements.previewBar.style.display = "none"
          }
          state.stretchedFullscreenActive = false
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
        if (document.activeElement.tagName !== "INPUT") videoControls.rewind()
      },
      ArrowRight: () => {
        // Advance
        if (document.activeElement.tagName !== "INPUT") videoControls.forward()
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
        if (state.stretchedFullscreenActive) {
          if (elements.controls.classList.contains("hidden")) {
            videoStretching.toggle()
            if (!elements.controls.classList.contains("hidden")) {
              elements.controls.classList.add("hidden")
            } else {
              elements.controls.classList.remove("hidden")
              elements.previewBar.style.display = "none"
            }
            videoStretching.toggle()
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
          if (!elements.previewBar.style.display || elements.previewBar.style.display === "none") {
            elements.previewBar.style.display = "block"
          } else elements.previewBar.style.display = "none"
        }
      },
      m: videoControls.toggleMute(), // Toggle mute
      c: toggleZoomCrop(), // Toggle zoom
      u: videoStretching.toggle(), // Toggle video stretching
      p: videoControls.togglePictureInPicture(), // Toggle PiP
      f: () => {
        // Toggle full screen
        if (
          document.activeElement.tagName !== "BUTTON" &&
          document.activeElement.tagName !== "INPUT"
        ) {
          if (state.stretchedFullscreenActive && elements.controls.classList.contains("hidden")) {
            videoStretching.toggle()
            if (!elements.controls.classList.contains("hidden")) {
              elements.controls.classList.add("hidden")
            } else {
              elements.controls.classList.remove("hidden")
              elements.previewBar.style.display = "none"
            }
            videoStretching.toggle()
          } else {
            state.pressedGKey = true
            videoStretching.toggleStretchedFullscreen()
          }
        }
      },
    }

    // Key action execution
    const action = keyActions[e.key.toLowerCase()]
    if (action) action()
  },

  handleCtrlStretch(e) {
    if (e.ctrlKey) {
      switch (e.key) {
        case "ArrowUp":
          state.scaleY += 0.01
          break
        case "ArrowDown":
          state.scaleY -= 0.01
          break
        case "ArrowRight":
          state.scaleX += 0.01
          break
        case "ArrowLeft":
          state.scaleX -= 0.01
          break
        default:
          state.scaleX = scaleY = 1
      }
      elements.video.style.transform = `scaleX(${state.scaleX}) scaleY(${state.scaleY})`
    }
    if (e.key === "u") elements.video.style.transform = `scaleX(1) scaleY(1)`
  },

  // Page is not visible (switched tab)
  handleVisibilityChange() {
    if (document.visibilityState === "hidden") {
      if (state.stretchingModeActive) videoStretching.toggle()
      elements.controls.classList.remove("hidden")
      elements.previewBar.style.display = "none"
      state.stretchedFullscreenActive = false
    }
  },
}

// ----------------------------- FILE MANAGEMENT -----------------------------
const fileManagement = {
  async processFile(fileHandle) {
    const file = await fileHandle.getFile()

    if (elements.video.src) {
      console.info("Video changed, saving old video in storage…")
      storage.save()
      URL.revokeObjectURL(elements.video.src)
    } else {
      elements.dragPanel.hidden = true
      elements.player.hidden = false
    }

    state.localStorageKey = await utils.hashFile(file)
    elements.video.src = URL.createObjectURL(file)
    elements.fileName.textContent = file.name.replace(/\.[^.]+$/, "")

    this.updateMediaSession()
  },

  updateMediaSession() {
    elements.video.addEventListener(
      "seeked",
      () => {
        const artwork = utils.captureFrame()
        navigator.mediaSession.metadata = new MediaMetadata({
          title: elements.fileName.textContent,
          artwork: [{ src: artwork, sizes: "512x512", type: "image/png" }],
        })
      },
      { once: true }
    )

    // Bind global media controls to video
    navigator.mediaSession.setActionHandler("seekbackward", () => videoControls.rewind)
    navigator.mediaSession.setActionHandler("seekforward", () => videoControls.forward)
  },

  handleDragEnter(e) {
    if (e.dataTransfer.items[0].type.startsWith("video/")) {
      e.target.dataset.fileHover = true
      elements.dropOverlay.hidden = false
      console.info(`A video file has entered #${e.target.id}'s dragging area.`)
    }
  },

  handleDragEnd() {
    elements.dropOverlay.hidden = true
    elements.droppableElements.forEach((el) => delete el.dataset.fileHover)
    console.info("The drag event has ended. The drop overlay was hidden.")
  },

  async openFilePicker() {
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
      this.processFile(fileHandle)
    } catch {}
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
  if (state.stretchedFullscreenActive) {
    videoStretching.toggle()
    videoStretching.toggle()
  } else videoStretching.toggleStretchedFullscreen()
}

function toggleZoomCrop() {
  const isZoomedIn = elements.zoomBtn.textContent === "zoom_out_map"
  elements.video.style.objectFit = isZoomedIn ? "cover" : "contain"
  elements.zoomBtn.textContent = isZoomedIn ? "crop_free" : "zoom_out_map"
}

function seekVideo() {
  elements.video.currentTime =
    (elements.progressBar.valueAsNumber * elements.video.duration) / 100
  videoControls.updateIndicators()
}

// ----------------------------- INITIALIZATION -----------------------------
function initializeVideo() {
  localStorage.getItem(state.localStorageKey)
    ? storage.restore()
    : console.info("No video state found in local storage.")
  videoControls.updateProgressBarValue()
  videoControls.updateIndicators()
  elements.duration.textContent = utils.secondsToTime(elements.video.duration)
}

function initializeEventListeners() {
  // File handling events
  elements.droppableElements.forEach((droppable) => {
    droppable.addEventListener("dragenter", fileManagement.handleDragEnter)
  })
  elements.dropOverlay.addEventListener("dragover", (e) => e.preventDefault())
  elements.dropOverlay.addEventListener("drop", eventHandlers.handleDrop)
  elements.dropOverlay.addEventListener("dragleave", fileManagement.handleDragEnd)
  elements.filePicker.addEventListener("click", fileManagement.openFilePicker)

  // Video control events
  elements.playBtn.onclick = elements.video.onclick = videoControls.togglePlay
  elements.video.onpause = () => (elements.playBtn.textContent = "play_arrow")
  elements.video.onplay = () => (elements.playBtn.textContent = "pause")

  elements.fullscreenBtn.onclick = videoStretching.toggleStretchedFullscreen
  document.onfullscreenchange = updateFullScreenIcon
  elements.video.addEventListener("dblclick", fullscreenHandler.toggle)

  document.addEventListener("visibilitychange", eventHandlers.handleVisibilityChange)

  elements.video.addEventListener("loadedmetadata", initializeVideo)
  elements.video.addEventListener("timeupdate", updateTimeAndProgress)
  elements.video.addEventListener("emptied", () => (elements.playBtn.textContent = "play_arrow"))
  elements.progressBar.addEventListener("input", seekVideo)
  elements.progressBar.onfocus = () => elements.progressBar.blur()
  elements.rewindBtn.onclick = videoControls.rewind
  elements.forwardBtn.onclick = videoControls.forward

  // Toggle current time/remaining time
  elements.timeIndicator.addEventListener("click", () => {
    ;[elements.timeRemaining.hidden, elements.currentTime.hidden] = [
      elements.currentTime.hidden,
      elements.timeRemaining.hidden,
    ]
  })

  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) {
      if (state.stretchingModeActive) videoStretching.toggle()
      if (elements.controls.classList.contains("hidden")) {
        elements.controls.classList.remove("hidden")
        elements.previewBar.style.display = "none"
      }
      state.stretchedFullscreenActive = false
    }
  })

  document.addEventListener("keydown", eventHandlers.handleKeyboardShortcuts)
  document.addEventListener("keydown", eventHandlers.handleCtrlStretch)

  elements.video.addEventListener("timeupdate", timeUtils.updateTimeAndProgress)
  elements.video.addEventListener("emptied", () => (elements.playBtn.textContent = "play_arrow"))

  elements.video.onratechange = () =>
    (elements.speedControls.value = elements.video.playbackRate.toFixed(2))
  elements.speedControls.onchange = elements.speedControls.oninput =
    videoControls.updatePlaybackRate

  // Save time in local storage when window closed/refreshed
  window.onbeforeunload = () => {
    if (elements.video.src && !elements.video.ended) storage.save()
  }
  storage.cleanup()

  elements.video.onended = () => {
    localStorage.removeItem(state.localStorageKey)
    console.info("Video ended. Video state deleted from local storage.")
  }

  elements.video.onloadedmetadata = () => {
    state.isVideoReady = true
    if (state.stretchedFullscreenActive) videoStretching.toggle()
  }

  // ----------------------------- PROGRESS BAR SEEKER GIANT -----------------------------
  window.addEventListener("keydown", (e) => {
    if (e.key === "A") {
      state.isGiantSeekerActive = !state.isGiantSeekerActive
      if (state.isGiantSeekerActive) {
        state.originalTime = elements.video.currentTime
        if (!elements.video.paused) elements.video.pause()
      } else elements.video.currentTime = state.originalTime
    }
  })

  window.addEventListener("mousemove", (e) => {
    if (!state.isGiantSeekerActive) return
    let rect = elements.progressBar.getBoundingClientRect()
    const percent = (e.clientX - rect.left) / rect.width
    elements.video.currentTime = percent * elements.video.duration
  })

  elements.progressBar.addEventListener("click", (e) => {
    if (!state.isGiantSeekerActive) return
    let rect = e.target.getBoundingClientRect()
    const percent = (e.clientX - rect.left) / rect.width
    state.originalTime = percent * elements.video.duration
    elements.video.currentTime = state.originalTime
    state.isGiantSeekerActive = false
  })

  elements.video.addEventListener("play", () => {
    if (state.isGiantSeekerActive) {
      state.isGiantSeekerActive = false
      state.originalTime = elements.video.currentTime
    }
  })

  // ----------------------------- PROGRESS BAR SEEKER SMALL -----------------------------
  elements.video.addEventListener("loadedmetadata", () => {
    state.isVideoLoaded = true
    state.aspectRatio = elements.video.videoWidth / elements.video.videoHeight
    state.seekerWidth = state.aspectRatio >= 1.77 ? 340 : 260
  })

  document.addEventListener(
    "keydown",
    (e) =>
      (state.isSmallSeekerActive =
        e.key === "a" ? !state.isSmallSeekerActive : state.isSmallSeekerActive)
  )
  elements.video.addEventListener("play", () => (state.isSmallSeekerActive = false))
  elements.progressBar.addEventListener("click", () => (state.isSmallSeekerActive = false))

  elements.progressBar.addEventListener("mousemove", (e) => {
    if (!state.isVideoLoaded || !state.isSmallSeekerActive) return

    const rect = elements.progressBar.getBoundingClientRect()
    const percent = (e.clientX - rect.left) / rect.width
    const previewTime = percent * elements.video.duration
    const previewLeft = e.clientX - state.seekerWidth / 2

    elements.seekerPreview.style.left = `${previewLeft}px`
    elements.seekerPreview.style.display = "block"
    elements.previewVideo.src = elements.video.src
    elements.previewVideo.currentTime = previewTime
    elements.seekerPreview.innerHTML = `<div>${utils.formatTime(previewTime)}</div>`
    elements.seekerPreview.prepend(previewVideo)
  })

  elements.progressBar.addEventListener(
    "mouseleave",
    () => (elements.seekerPreview.style.display = "none")
  )
}

// ----------------------------- INITIALIZATION -----------------------------
function initializeApp() {
  initializeEventListeners()
}

// Start the application
initializeApp()

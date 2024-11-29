"use strict"

// ----------------------------- GLOBAL VARIABLES -----------------------------
const preferences = { timeSkip: 10 }
const state = {
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
  inactivityTimeout: null,
  cursorHiddenClass: "hide-cursor",
  videoBuffer: null,
  previewCanvas: null,
  previewContext: null,
  frameCache: new Map(),
  preloadedSegments: new Set(), // Track which segments we've preloaded
  segmentSize: 5, // Seconds per segment
  isPreloading: false,
  totalFramesProcessed: 0,
  totalFramesNeeded: 0,
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
    const videoState = {
      timer: elements.video.currentTime,
      playbackRate: elements.video.playbackRate,
      last_opened: Date.now(),
    }
    localStorage.setItem(state.localStorageKey, JSON.stringify(videoState))
    console.info("Video state saved in local storage.")
  },

  restore() {
    let videoState = JSON.parse(localStorage.getItem(state.localStorageKey))
    elements.video.currentTime = videoState.timer
    elements.video.playbackRate = videoState.playbackRate
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
    elements.video.currentTime = Math.max(elements.video.currentTime - preferences.timeSkip, 0)
  },

  forward() {
    elements.video.currentTime = Math.min(
      elements.video.currentTime + preferences.timeSkip,
      elements.video.duration
    )
  },

  updateProgressBarValue() {
    elements.progressBar.valueAsNumber =
      (elements.video.currentTime * 100) / elements.video.duration
  },

  updateTimeAndProgress() {
    if (elements.video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      videoControls.updateProgressBarValue()
      videoControls.updateIndicators()
    } else console.info("Video metadata not loaded yet.")
  },

  updateIndicators() {
    // Update Progress Bar
    const progressBarValue = elements.progressBar.valueAsNumber
    elements.progressBar.style.setProperty("--progress", `${progressBarValue}%`)
    elements.previewBar.style.setProperty("--progress", `${progressBarValue}%`)

    // Update Time Display
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

    const mode = videoStretching.getStretchMode()
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
      if (state.stretchingModeActive) videoStretching.toggle()
    } else {
      await elements.player.requestFullscreen()
      if (!state.stretchingModeActive) videoStretching.toggle()
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
        } else zoomControls.toggle()
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
          } else zoomControls.toggle()
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
      m: videoControls.toggleMute, // Toggle mute
      c: zoomControls.toggleCrop, // Toggle zoom
      u: videoStretching.toggle, // Toggle video stretching
      p: videoControls.togglePictureInPicture, // Toggle PiP
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
    const action = keyActions[e.key.length === 1 ? e.key.toLowerCase() : e.key]
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
          state.scaleX = state.scaleY = 1
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

    fileManagement.updateMediaSession()
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
      fileManagement.processFile(fileHandle)
    } catch {
      console.info("The user cancelled the file picker.")
    }
  },
}

// ----------------------------- ZOOM CONTROLS -----------------------------
const zoomControls = {
  toggle() {
    zoomControls.toggleControls()
    if (state.stretchedFullscreenActive) {
      videoStretching.toggle()
      videoStretching.toggle()
    } else videoStretching.toggleStretchedFullscreen()
  },

  toggleControls() {
    if (!elements.controls.classList.contains("hidden")) {
      elements.controls.classList.add("hidden")
    } else {
      elements.controls.classList.remove("hidden")
      elements.previewBar.style.display = "none"
    }
  },

  toggleCrop() {
    const isZoomedIn = elements.zoomBtn.textContent === "zoom_out_map"
    elements.video.style.objectFit = isZoomedIn ? "cover" : "contain"
    elements.zoomBtn.textContent = isZoomedIn ? "crop_free" : "zoom_out_map"
  },
}

// ----------------------------- CURSOR HIDING -----------------------------
const cursorHandler = {
  setupCursorHiding() {
    const video = elements.video
    const player = elements.player

    // Remove any existing event listeners to prevent multiple bindings
    player.removeEventListener("mousemove", cursorHandler.handleMouseMove)
    player.removeEventListener("mouseleave", cursorHandler.clearInactivityTimeout)
    video.removeEventListener("play", cursorHandler.clearInactivityTimeout)
    video.removeEventListener("pause", cursorHandler.clearInactivityTimeout)

    // Add event listeners
    player.addEventListener("mousemove", cursorHandler.handleMouseMove.bind(cursorHandler))
    player.addEventListener("mouseleave", cursorHandler.clearInactivityTimeout.bind(cursorHandler))
    video.addEventListener("play", cursorHandler.clearInactivityTimeout.bind(cursorHandler))
    video.addEventListener("pause", cursorHandler.clearInactivityTimeout.bind(cursorHandler))
  },

  handleMouseMove() {
    cursorHandler.clearInactivityTimeout()
    elements.player.classList.remove(state.cursorHiddenClass)

    // Set a new timeout to hide cursor after 2 seconds of inactivity
    state.inactivityTimeout = setTimeout(() => {
      elements.player.classList.add(state.cursorHiddenClass)
    }, 2000)
  },

  clearInactivityTimeout() {
    if (state.inactivityTimeout) {
      clearTimeout(state.inactivityTimeout)
      state.inactivityTimeout = null
    }
  },
}

// ----------------------------- SEEK CONTROLS -----------------------------
const seekerControls = {
  seek() {
    elements.video.currentTime =
      (elements.progressBar.valueAsNumber * elements.video.duration) / 100
    videoControls.updateIndicators()
  },

  handleGiantSeeker(e) {
    if (!state.isGiantSeekerActive) return
    const rect = elements.progressBar.getBoundingClientRect()
    const percent = (e.clientX - rect.left) / rect.width
    elements.video.currentTime = percent * elements.video.duration
  },

  async handleSmallSeeker(e) {
    if (!state.isVideoLoaded || !state.isSmallSeekerActive) return

    const rect = elements.progressBar.getBoundingClientRect()
    const percent = (e.clientX - rect.left) / rect.width
    const previewTime = percent * elements.video.duration
    const previewLeft = e.clientX - state.seekerWidth / 2

    // Round to nearest half second for cache lookup
    const roundedTime = Math.floor(previewTime * 2) / 2
    const cachedFrame = state.frameCache.get(roundedTime)

    if (cachedFrame) {
      seekerControls.updateSeekerPreviewWithFrame(previewLeft, previewTime, cachedFrame)
      return
    }

    const frameData = await seekerControls.generatePreviewFrame(previewTime)
    seekerControls.updateSeekerPreviewWithFrame(previewLeft, previewTime, frameData)

    // Start preloading the surrounding segment
    const segmentStart = Math.floor(previewTime / state.segmentSize) * state.segmentSize
    seekerControls.preloadSegment(segmentStart)
  },

  predictivePreload(e) {
    if (!state.isVideoLoaded || !state.isSmallSeekerActive) return

    const rect = elements.progressBar.getBoundingClientRect()
    const percent = (e.clientX - rect.left) / rect.width
    const currentTime = percent * elements.video.duration
    const segmentStart = Math.floor(currentTime / state.segmentSize) * state.segmentSize

    // Preload current segment and next segment based on mouse direction
    seekerControls.preloadSegment(segmentStart)
    if (e.movementX > 0) {
      seekerControls.preloadSegment(segmentStart + state.segmentSize)
    } else if (e.movementX < 0) {
      seekerControls.preloadSegment(Math.max(0, segmentStart - state.segmentSize))
    }
  },

  async generatePreviewFrame(time) {
    if (!state.videoBuffer.src) {
      state.videoBuffer.src = elements.video.src
      await new Promise((resolve) => {
        state.videoBuffer.addEventListener("loadeddata", resolve, { once: true })
      })
    }

    state.videoBuffer.currentTime = time
    await new Promise((resolve) => {
      state.videoBuffer.addEventListener("seeked", resolve, { once: true })
    })

    // Use higher quality preview dimensions
    const width = 320 // doubled from previous
    const height = 180 // doubled from previous

    if (state.previewCanvas.width !== width) {
      state.previewCanvas.width = width
      state.previewCanvas.height = height
    }

    // Draw frame with better quality
    state.previewContext.drawImage(state.videoBuffer, 0, 0, width, height)

    // Use higher quality JPEG encoding
    const frameData = state.previewCanvas.toDataURL("image/jpeg", 0.9)
    state.frameCache.set(Math.floor(time * 2) / 2, frameData) // Store at half-second precision

    // Clean cache if too large (increased for better coverage)
    if (state.frameCache.size > 500) {
      const firstKey = state.frameCache.keys().next().value
      state.frameCache.delete(firstKey)
    }

    return frameData
  },

  updateSeekerPreviewWithFrame(left, time, frameData) {
    elements.seekerPreview.style.left = `${left}px`
    elements.seekerPreview.style.display = "block"

    // Create preview content
    elements.seekerPreview.innerHTML = `
      <img src="${frameData}" alt="Preview" style="width: auto; height: 100%;">
      <div>${utils.formatTime(time)}</div>
    `
  },

  throttle(func, limit) {
    let inThrottle
    return function (...args) {
      if (!inThrottle) {
        func.apply(this, args)
        inThrottle = true
        setTimeout(() => (inThrottle = false), limit)
      }
    }
  },

  calculateTotalFramesNeeded() {
    // Calculate frames needed at 0.5 second intervals
    return Math.ceil(elements.video.duration * 2)
  },

  async preloadSegment(startTime) {
    const segmentId = Math.floor(startTime / state.segmentSize)

    if (state.preloadedSegments.has(segmentId) || state.isPreloading) return

    state.isPreloading = true
    const endTime = Math.min(startTime + state.segmentSize, elements.video.duration)

    try {
      // Generate previews at half-second intervals
      for (let time = startTime; time < endTime; time += 0.5) {
        await seekerControls.generatePreviewFrame(time)

        // Update progress tracking
        state.totalFramesProcessed++
        const progress = (state.totalFramesProcessed / state.totalFramesNeeded) * 100
        if (time % 2 === 0) {
          // Log every 2 seconds
          console.log(
            `Preprocessing progress: ${Math.round(progress)}% (${state.totalFramesProcessed}/${
              state.totalFramesNeeded
            } frames)`
          )
        }
      }
      state.preloadedSegments.add(segmentId)
    } catch (error) {
      console.warn("Error preloading segment:", error)
    } finally {
      state.isPreloading = false
    }
  },

  initializePreprocessing() {
    state.frameCache.clear()
    state.preloadedSegments.clear()
    state.totalFramesProcessed = 0
    state.totalFramesNeeded = this.calculateTotalFramesNeeded()

    console.log(`Starting video preprocessing... (${state.totalFramesNeeded} frames needed)`)

    // Calculate number of segments needed
    const totalSegments = Math.ceil(elements.video.duration / state.segmentSize)

    // Create array of segment start times
    const segmentStarts = Array.from({ length: totalSegments }, (_, i) => i * state.segmentSize)

    // Process all segments in order
    const processSegments = async () => {
      for (const startTime of segmentStarts) {
        await this.preloadSegment(startTime)
      }
      console.log("Complete preprocessing finished!")
    }

    // Start processing in background
    processSegments()
  },

  toggleGiantSeeker(e) {
    if (e.key === "A") {
      state.isGiantSeekerActive = !state.isGiantSeekerActive

      if (state.isGiantSeekerActive) {
        state.originalTime = elements.video.currentTime
        if (!elements.video.paused) elements.video.pause()
      } else {
        elements.video.currentTime = state.originalTime
      }
    }
  },

  updateTimeOnGiantSeekerClick(e) {
    if (!state.isGiantSeekerActive) return

    const rect = e.target.getBoundingClientRect()
    const percent = (e.clientX - rect.left) / rect.width
    state.originalTime = percent * elements.video.duration
    elements.video.currentTime = state.originalTime
    state.isGiantSeekerActive = false
  },

  resetGiantSeekerOnPlay() {
    if (state.isGiantSeekerActive) {
      state.isGiantSeekerActive = false
      state.originalTime = elements.video.currentTime
    }
  },

  setVideoProperties() {
    state.isVideoLoaded = true
    state.aspectRatio = elements.video.videoWidth / elements.video.videoHeight
    state.seekerWidth = state.aspectRatio >= 1.77 ? 340 : 260
  },
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

function initializePreviewSystem() {
  // Create canvas once and reuse
  state.previewCanvas = document.createElement("canvas")
  state.previewCanvas.width = 160
  state.previewCanvas.height = 90
  state.previewContext = state.previewCanvas.getContext("2d")

  // Set up video buffer
  state.videoBuffer = document.createElement("video")
  state.videoBuffer.preload = "auto"

  // Enable fast seeking
  state.videoBuffer.addEventListener("loadedmetadata", () => {
    state.videoBuffer.fastSeek = true
  })
}

const seekerEvents = {
  initializeProgressControls() {
    elements.progressBar.addEventListener("input", seekerControls.seek)
    elements.progressBar.onfocus = () => elements.progressBar.blur()
  },

  initializeGiantSeeker() {
    window.addEventListener("keydown", seekerControls.toggleGiantSeeker)
    window.addEventListener("mousemove", (e) => seekerControls.handleGiantSeeker(e))
    elements.progressBar.addEventListener("click", seekerControls.updateTimeOnGiantSeekerClick)
    elements.video.addEventListener("play", seekerControls.resetGiantSeekerOnPlay)
  },

  initializeSmallSeeker() {
    // Initial setup and preprocessing
    elements.video.addEventListener("loadedmetadata", () => {
      seekerControls.setVideoProperties()
      seekerControls.initializePreprocessing()
    })

    // Keyboard controls
    document.addEventListener("keydown", (e) => {
      state.isSmallSeekerActive =
        e.key === "a" ? !state.isSmallSeekerActive : state.isSmallSeekerActive
    })

    // Reset states
    elements.video.addEventListener("play", () => (state.isSmallSeekerActive = false))
    elements.progressBar.addEventListener("click", () => (state.isSmallSeekerActive = false))

    // Preview handling
    elements.progressBar.addEventListener(
      "mousemove",
      seekerControls.throttle((e) => {
        seekerControls.handleSmallSeeker(e)
        seekerControls.predictivePreload(e)
      }, 50)
    )

    elements.progressBar.addEventListener("mouseleave", () => {
      elements.seekerPreview.style.display = "none"
    })
  },

  initializeCleanup() {
    // Clean up on video source change
    elements.video.addEventListener("emptied", () => {
      state.frameCache.clear()
      if (state.videoBuffer) {
        state.videoBuffer.src = ""
      }
      elements.seekerPreview.style.display = "none"
    })

    // Clean up before page unload
    window.addEventListener("beforeunload", () => {
      state.frameCache.clear()
      if (state.videoBuffer) {
        state.videoBuffer.src = ""
      }
    })
  },

  initialize() {
    this.initializeProgressControls()
    this.initializeGiantSeeker()
    this.initializeSmallSeeker()
    this.initializeCleanup()
    initializePreviewSystem()
  },
}

function initializeEventListeners() {
  // ============= FILE HANDLING EVENTS =============
  elements.droppableElements.forEach((droppable) => {
    droppable.addEventListener("dragenter", fileManagement.handleDragEnter)
  })
  elements.dropOverlay.addEventListener("dragover", (e) => e.preventDefault())
  elements.dropOverlay.addEventListener("drop", eventHandlers.handleDrop)
  elements.dropOverlay.addEventListener("dragleave", fileManagement.handleDragEnd)
  elements.filePicker.addEventListener("click", fileManagement.openFilePicker)

  // ============= VIDEO CONTROL EVENTS =============
  elements.playBtn.onclick = elements.video.onclick = videoControls.togglePlay
  elements.video.onpause = () => (elements.playBtn.textContent = "play_arrow")
  elements.video.onplay = () => (elements.playBtn.textContent = "pause")
  elements.fullscreenBtn.onclick = videoStretching.toggleStretchedFullscreen
  document.onfullscreenchange = fullscreenHandler.updateIcon
  elements.video.addEventListener("dblclick", fullscreenHandler.toggle)
  elements.timeIndicator.addEventListener("click", () => {
    // Toggle current time/remaining time
    ;[elements.timeRemaining.hidden, elements.currentTime.hidden] = [
      elements.currentTime.hidden,
      elements.timeRemaining.hidden,
    ]
  })

  // ============= WINDOW EVENTS =============
  document.addEventListener("visibilitychange", eventHandlers.handleVisibilityChange)
  document.addEventListener("keydown", eventHandlers.handleKeyboardShortcuts)
  document.addEventListener("keydown", eventHandlers.handleCtrlStretch)
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

  // Save video progress in local storage before unloading the page
  window.onbeforeunload = () => {
    if (elements.video.src && !elements.video.ended) storage.save()
  }
  storage.cleanup()

  // Remove video state from local storage upon video end
  elements.video.onended = () => {
    localStorage.removeItem(state.localStorageKey)
    console.info("Video ended. Video state deleted from local storage.")
  }

  // ============= SEEKER CONTROLS EVENTS =============
  elements.progressBar.addEventListener("input", seekerControls.seek)
  elements.progressBar.onfocus = () => elements.progressBar.blur()

  // --------------- Giant Seeker Events ---------------
  window.addEventListener("keydown", seekerControls.toggleGiantSeeker)
  window.addEventListener("mousemove", (e) => seekerControls.handleGiantSeeker(e))
  elements.progressBar.addEventListener("click", seekerControls.updateTimeOnGiantSeekerClick)
  elements.video.addEventListener("play", seekerControls.resetGiantSeekerOnPlay)

  // --------------- Small Seeker Events ---------------
  // Initial setup and preprocessing
  elements.video.addEventListener("loadedmetadata", () => {
    seekerControls.setVideoProperties()
    seekerControls.initializePreprocessing()
  })

  // Keyboard controls
  document.addEventListener("keydown", (e) => {
    state.isSmallSeekerActive =
      e.key === "a" ? !state.isSmallSeekerActive : state.isSmallSeekerActive
  })

  // Reset states
  elements.video.addEventListener("play", () => (state.isSmallSeekerActive = false))
  elements.progressBar.addEventListener("click", () => (state.isSmallSeekerActive = false))

  // Preview handling
  elements.progressBar.addEventListener(
    "mousemove",
    seekerControls.throttle((e) => {
      seekerControls.handleSmallSeeker(e)
      seekerControls.predictivePreload(e)
    }, 50)
  )

  elements.progressBar.addEventListener("mouseleave", () => {
    elements.seekerPreview.style.display = "none"
  })

  // Clean up on video source change
  elements.video.addEventListener("emptied", () => {
    state.frameCache.clear()
    if (state.videoBuffer) {
      state.videoBuffer.src = ""
    }
    elements.seekerPreview.style.display = "none"
  })

  // Clean up before page unload
  window.addEventListener("beforeunload", () => {
    state.frameCache.clear()
    if (state.videoBuffer) {
      state.videoBuffer.src = ""
    }
  })

  initializePreviewSystem()

  // ============= PLAYBACK RATE EVENTS =============
  elements.video.addEventListener("loadedmetadata", initializeVideo)
  elements.video.addEventListener("timeupdate", videoControls.updateTimeAndProgress)
  elements.video.addEventListener("emptied", () => (elements.playBtn.textContent = "play_arrow"))
  elements.rewindBtn.onclick = videoControls.rewind
  elements.forwardBtn.onclick = videoControls.forward
  elements.zoomBtn.onclick = zoomControls.toggle
  cursorHandler.setupCursorHiding()

  elements.video.onratechange = () =>
    (elements.speedControls.value = elements.video.playbackRate.toFixed(2))
  elements.speedControls.onchange = elements.speedControls.oninput =
    videoControls.updatePlaybackRate
  elements.video.onloadedmetadata = () => {
    state.isVideoReady = true
    if (state.stretchedFullscreenActive) videoStretching.toggle()
  }
}

initializeEventListeners()

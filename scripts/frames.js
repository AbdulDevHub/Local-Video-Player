// Thumbnail frames. Every video has a chosen point ("thumbPoint" on its record): 0 (the start),
// 5 (5% in, the default) or "custom" (a frame saved from the player). In-progress videos show the
// frame from where you stopped ("progressThumb") instead; the chosen one comes back once finished.
export const DEFAULT_POINT = 5
export const pointOf = (record) => record?.thumbPoint ?? DEFAULT_POINT
// The stored frame matches the chosen point (records from older versions don't, so they're redone)
// (a saved "custom" frame is never redone)
export const thumbIsCurrent = (record) =>
  pointOf(record) === "custom" || (record?.thumbFor != null && record.thumbFor === pointOf(record))

const WIDTH = 384

// Draws a video frame into a small JPEG (synchronous draw, so the video can be unloaded right after)
export function snapshot(video) {
  if (!video.videoWidth || video.readyState < 2) return null
  const canvas = document.createElement("canvas")
  canvas.width = WIDTH
  canvas.height = Math.round((WIDTH * video.videoHeight) / video.videoWidth)
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas
}

export const toJpeg = (canvas) => new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.75))

// Opens a file in a hidden video: its length, plus (when percent is given) the frame that far in.
// Returns null if the file can't be read.
export async function probe(file, percent = null) {
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
    const loaded = wait("loadedmetadata")
    video.src = url
    await loaded
    // Some WebM files don't store their length: seeking far past the end makes the browser work it out
    if (!Number.isFinite(video.duration)) await seek(1e9)
    const length = Number.isFinite(video.duration) ? video.duration : 0
    if (percent === null || !video.videoWidth || !length) return { duration: length }
    // A hair past 0 so the browser decodes the very first picture
    await seek(Math.max(0, Math.min(Math.max((length * percent) / 100, 0.01), length - 0.1)))
    // "seeked" can fire before the picture is decoded (a black grab): wait for the frame itself
    await Promise.race([
      new Promise((r) => video.requestVideoFrameCallback?.(r)),
      new Promise((r) => setTimeout(r, 300)),
    ])
    const canvas = snapshot(video)
    return { duration: length, thumb: canvas ? await toJpeg(canvas) : null }
  } catch {
    return null
  } finally {
    video.removeAttribute("src")
    video.load()
    URL.revokeObjectURL(url)
  }
}

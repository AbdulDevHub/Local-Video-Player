// Judges whether a video frame makes a good thumbnail. Bad frames: mostly dark, mostly bright,
// one flat colour (black/white screens, title cards, credits), or dim and washed out (fades).
const sample = document.createElement("canvas")
sample.width = 64
sample.height = 36
const context = sample.getContext("2d", { willReadFrequently: true })

// Above this a frame is treated as a bad thumbnail
export const BAD_FRAME = 0.5

// Each rule gives 0 (fine) … 1 (blank); the frame's score is the worst of them
export function frameBadness(source) {
  try {
    context.drawImage(source, 0, 0, sample.width, sample.height)
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data
    const total = pixels.length / 4
    const counts = new Map()
    let top = 0
    let dark = 0
    let bright = 0
    let sum = 0
    let sumSquares = 0
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]]
      const luma = 0.299 * r + 0.587 * g + 0.114 * b
      sum += luma
      sumSquares += luma * luma
      if (luma < 50) dark++
      else if (luma > 205) bright++
      const colour = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
      const count = (counts.get(colour) ?? 0) + 1
      counts.set(colour, count)
      if (count > top) top = count
    }
    const mean = sum / total
    const contrast = Math.sqrt(Math.max(0, sumSquares / total - mean * mean))
    // Past a limit, each rule climbs from 0.5 (just bad) towards 1
    const ramp = (amount, range) => (amount > 0 ? 0.5 + Math.min(1, amount / range) * 0.5 : 0)
    return Math.max(
      dark / total, // mostly black
      bright / total, // mostly white
      ramp(top / total - 0.65, 0.35), // one flat colour (a big plain sky alone is fine)
      ramp(70 - mean, 70), // dim overall (fade from black, dark overlay)
      ramp(mean - 195, 60), // washed out (fade to white)
      ramp(22 - contrast, 22) // very low contrast (mid-fade, haze)
    )
  } catch {
    return 0 // can't read the pixels: don't block the thumbnail
  }
}

export const isBadFrame = (source) => frameBadness(source) > BAD_FRAME

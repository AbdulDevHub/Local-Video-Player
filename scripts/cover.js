// Reads the attached picture (APIC frame) from an MP3's ID3v2 tag
export async function extractCoverImage(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer())
    if (String.fromCharCode(...head.slice(0, 3)) !== "ID3") return null

    const version = head[3]
    const tagSize =
      ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f)
    const tag = new Uint8Array(await file.slice(10, 10 + tagSize).arrayBuffer())
    const view = new DataView(tag.buffer)
    const latin1 = (start, end) => String.fromCharCode(...tag.slice(start, end))

    let pos = 0
    // Skip extended header if present
    if (head[5] & 0x40) {
      pos =
        version === 4
          ? ((tag[0] & 0x7f) << 21) | ((tag[1] & 0x7f) << 14) | ((tag[2] & 0x7f) << 7) | (tag[3] & 0x7f)
          : view.getUint32(0) + 4
    }

    const idLength = version === 2 ? 3 : 4
    const headerLength = version === 2 ? 6 : 10
    while (pos + headerLength <= tag.length) {
      const id = latin1(pos, pos + idLength)
      if (!/^[A-Z0-9]+$/.test(id)) break

      let size
      if (version === 2) size = (tag[pos + 3] << 16) | (tag[pos + 4] << 8) | tag[pos + 5]
      else if (version === 4)
        size =
          ((tag[pos + 4] & 0x7f) << 21) |
          ((tag[pos + 5] & 0x7f) << 14) |
          ((tag[pos + 6] & 0x7f) << 7) |
          (tag[pos + 7] & 0x7f)
      else size = view.getUint32(pos + 4)

      if (id === "APIC" || id === "PIC") {
        const start = pos + headerLength
        const end = start + size
        const encoding = tag[start]
        let i = start + 1
        let mime = "image/jpeg"
        if (id === "PIC") {
          const format = latin1(i, i + 3).toLowerCase()
          mime = format === "png" ? "image/png" : "image/jpeg"
          i += 3
        } else {
          let mimeEnd = i
          while (mimeEnd < end && tag[mimeEnd] !== 0) mimeEnd++
          const parsed = latin1(i, mimeEnd)
          if (parsed.startsWith("image/")) mime = parsed
          i = mimeEnd + 1
        }
        i += 1 // picture type
        // Skip description (null-terminated; double null for UTF-16)
        const wide = encoding === 1 || encoding === 2
        while (i < end) {
          if (wide) {
            if (tag[i] === 0 && tag[i + 1] === 0) {
              i += 2
              break
            }
            i += 2
          } else if (tag[i++] === 0) break
        }
        return new Blob([tag.slice(i, end)], { type: mime })
      }
      pos += headerLength + size
    }
  } catch (error) {
    console.info("Could not read cover image:", error)
  }
  return null
}

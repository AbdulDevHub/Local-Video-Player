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

// Reads the cover art ("covr" atom: moov › udta › meta › ilst › covr › data) from MP4/M4V/MOV/M4A.
// Windows File Explorer uses this picture as the thumbnail when a file has one.
export async function extractMp4Cover(file) {
  try {
    const read = async (start, length) => new DataView(await file.slice(start, start + length).arrayBuffer())
    const type = (view, at) => String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + at, 4))

    // Walk the top-level boxes to find moov (it can sit at the start or the end of the file)
    let offset = 0
    let moov = null
    for (let i = 0; i < 64 && offset + 8 <= file.size; i++) {
      const head = await read(offset, 16)
      let size = head.getUint32(0)
      const name = type(head, 4)
      if (i === 0 && name !== "ftyp") return null // not an MP4 family file
      let headerSize = 8
      if (size === 1) {
        size = Number(head.getBigUint64(8))
        headerSize = 16
      } else if (size === 0) size = file.size - offset
      if (size < headerSize) return null
      if (name === "moov") {
        if (size > 64 * 1024 * 1024) return null
        moov = new DataView(await file.slice(offset + headerSize, offset + size).arrayBuffer())
        break
      }
      offset += size
    }
    if (!moov) return null

    // Finds a child box by name inside [start, end) of a view
    const child = (view, start, end, wanted) => {
      for (let at = start; at + 8 <= end; ) {
        const size = view.getUint32(at)
        if (size < 8 || at + size > end) return null
        if (type(view, at + 4) === wanted) return { start: at + 8, end: at + size }
        at += size
      }
      return null
    }
    const udta = child(moov, 0, moov.byteLength, "udta")
    const meta = udta && child(moov, udta.start, udta.end, "meta")
    if (!meta) return null
    // MP4 "meta" is a full box (4 bytes of version/flags); QuickTime's isn't
    const metaStart = type(moov, meta.start + 4) === "hdlr" ? meta.start : meta.start + 4
    const ilst = child(moov, metaStart, meta.end, "ilst")
    const covr = ilst && child(moov, ilst.start, ilst.end, "covr")
    const data = covr && child(moov, covr.start, covr.end, "data")
    if (!data || data.end - data.start <= 8) return null
    const kind = moov.getUint32(data.start) & 0xffffff
    const mime = kind === 14 ? "image/png" : kind === 27 ? "image/bmp" : "image/jpeg"
    return new Blob([new Uint8Array(moov.buffer, moov.byteOffset + data.start + 8, data.end - data.start - 8)], { type: mime })
  } catch (error) {
    console.info("Could not read MP4 cover:", error)
    return null
  }
}

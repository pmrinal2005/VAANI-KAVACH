/** Small audio helpers shared by route handlers and tests. */

/** Duration in seconds from a canonical PCM WAV header; null when the bytes are not a plain WAV. */
export function wavSeconds(b: Uint8Array): number | null {
  if (b.length < 44 || String.fromCharCode(...b.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...b.slice(8, 12)) !== 'WAVE') return null
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let off = 12
  let byteRate = 0
  while (off + 8 <= b.length) {
    const id = String.fromCharCode(...b.slice(off, off + 4))
    const size = dv.getUint32(off + 4, true)
    if (id === 'fmt ' && off + 20 <= b.length) byteRate = dv.getUint32(off + 16, true)
    if (id === 'data') return byteRate > 0 ? Math.min(size, b.length - off - 8) / byteRate : null
    off += 8 + size + (size % 2)
  }
  return null
}


/**
 * Push-to-talk recorder that produces 16 kHz mono 16-bit PCM WAV (the speech service does not accept WebM/Opus from MediaRecorder).
 * Browser-only. Reports input level and clipping so users see honest signal quality (no invented "confidence").
 */
export interface RecordingResult { blob: Blob; durationMs: number; clipped: boolean; peak: number }
export interface RecorderHandle { stop(): Promise<RecordingResult>; cancel(): void }

export function encodeWav(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const dv = new DataView(buf)
  const wr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)) }
  wr(0, 'RIFF'); dv.setUint32(4, 36 + samples.length * 2, true); wr(8, 'WAVE'); wr(12, 'fmt ')
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
  wr(36, 'data'); dv.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

/** Box-filter downsample (averages source samples per target sample, which acts as a crude anti-alias filter). */
export function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return input
  const ratio = from / to
  const n = Math.floor(input.length / ratio)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio)
    const b = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let k = a; k < b; k++) sum += input[k]
    out[i] = b > a ? sum / (b - a) : 0
  }
  return out
}

export async function startRecording(o: {
  /** true = browser echo cancellation / noise suppression / auto gain; false = raw microphone */
  browserProcessing: boolean
  maxMs: number
  onLevel: (peak: number, clipped: boolean) => void
  onAutoStop: () => void
}): Promise<RecorderHandle> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot record audio. Please type instead.')
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: o.browserProcessing, noiseSuppression: o.browserProcessing, autoGainControl: o.browserProcessing },
  })
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AC()
  const src = ctx.createMediaStreamSource(stream)
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  const mute = ctx.createGain()
  mute.gain.value = 0
  const chunks: Float32Array[] = []
  let peak = 0
  let clipped = false
  let done = false
  const t0 = performance.now()
  const timer = window.setTimeout(() => { if (!done) o.onAutoStop() }, o.maxMs)
  proc.onaudioprocess = (e) => {
    if (done) return
    const d = e.inputBuffer.getChannelData(0)
    chunks.push(new Float32Array(d))
    let p = 0
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p) p = a }
    if (p >= 0.99) clipped = true
    if (p > peak) peak = p
    o.onLevel(p, p >= 0.99)
  }
  src.connect(proc); proc.connect(mute); mute.connect(ctx.destination)
  const release = () => {
    done = true
    window.clearTimeout(timer)
    try { proc.disconnect(); src.disconnect(); mute.disconnect() } catch { /* already disconnected */ }
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close().catch(() => undefined)
  }
  return {
    cancel: release,
    stop: async () => {
      const rate = ctx.sampleRate
      const dur = performance.now() - t0
      release()
      const total = chunks.reduce((n, c) => n + c.length, 0)
      const all = new Float32Array(total)
      let off = 0
      for (const c of chunks) { all.set(c, off); off += c.length }
      const mono16 = downsample(all, rate, 16000)
      return { blob: encodeWav(mono16, Math.min(rate, 16000)), durationMs: Math.min(dur, (mono16.length / Math.min(rate, 16000)) * 1000 || dur), clipped, peak }
    },
  }
}

/**
 * Gnani (Vachana) provider adapters. Server-side only: the API key never reaches the browser.
 * Contracts below were read from docs.gnani.ai (STT REST, Timbre TTS REST, Voice Clone embeddings + cloned TTS):
 *   STT   POST {base}/stt/v3                              multipart: audio_file, language_code, model, format, keyterms ...
 *   TTS   POST {base}/api/v1/tts/inference                JSON: text, model, voice, language, speed, audio_config   -> binary audio
 *   EMBED POST {base}/api/v1/tts/voice-clone/embeddings   multipart: audio_file -> {data:{voice_clone_embedding:{embedding,shape,dtype}}}
 *   CLONE POST {base}/api/v1/tts/inference                JSON: text, speaker_embedding{embedding,shape,dtype}, audio_config (model vachana-vc-v1 is implied)
 * Auth header: X-API-Key-ID. Errors come in three shapes (STT envelope, auth/rate `detail.error_code`, flat TTS/VC body).
 */
import { cfg } from './config'
import type { Lang, WorkflowId } from './types'

export interface SpeakerEmbedding { embedding: string; shape: number[]; dtype: string }

export type ProviderResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; /** true when an HTTP response proved the request was rejected before any work/charge */ definite: boolean; code: string; message: string }

let fetchImpl: typeof fetch | null = null
export function setFetchForTests(f: typeof fetch | null): void {
  fetchImpl = f
}
const F = (): typeof fetch => fetchImpl ?? fetch

const REJECTED = new Set([400, 401, 402, 403, 404, 405, 413, 415, 422, 429])

function clip(s: string, n = 160): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, n)
}

async function parseError(res: Response): Promise<{ code: string; message: string }> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* non-JSON body */
  }
  const b = body as Record<string, unknown> | null
  const env = b && typeof b === 'object' ? (b.error as Record<string, unknown> | undefined) : undefined
  if (env && typeof env === 'object') return { code: String(env.type ?? env.code ?? `HTTP_${res.status}`), message: clip(String(env.message ?? 'Provider error')) }
  const det = b?.detail as unknown
  if (det && typeof det === 'object' && !Array.isArray(det)) {
    const d = det as Record<string, unknown>
    return { code: String(d.error_code ?? `HTTP_${res.status}`), message: clip(String(d.message ?? 'Provider error')) }
  }
  if (Array.isArray(det)) return { code: 'VALIDATION', message: clip(det.map((x) => (x as { msg?: string }).msg ?? '').filter(Boolean).join('; ') || 'Invalid request') }
  if (b && typeof b.message === 'string') return { code: `HTTP_${res.status}`, message: clip(b.message) }
  return { code: `HTTP_${res.status}`, message: `Provider returned HTTP ${res.status}` }
}

async function send(url: string, init: RequestInit, timeoutMs: number): Promise<{ res: Response } | { fail: ProviderResult<never> }> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await F()(url, { ...init, signal: ctl.signal, cache: 'no-store' })
    return { res }
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError'
    // After submission, a timeout / network failure is NOT proof of "no charge".
    return { fail: { ok: false, status: aborted ? 504 : 502, definite: false, code: aborted ? 'TIMEOUT' : 'NETWORK', message: aborted ? 'The speech service did not answer in time.' : 'Could not reach the speech service.' } }
  } finally {
    clearTimeout(t)
  }
}

async function failFrom(res: Response): Promise<ProviderResult<never>> {
  const { code, message } = await parseError(res)
  return { ok: false, status: res.status, definite: REJECTED.has(res.status), code, message }
}

function key(): string {
  return cfg().gnaniKey
}
const baseUrl = () => cfg().gnaniBase

/* ---------------------------- STT ---------------------------- */

const LANG_HINT: Record<Lang, string> = { hinglish: 'hi-IN,en-IN', en: 'en-IN,hi-IN', ta: 'ta-IN,en-IN', bn: 'bn-IN,en-IN' }

const VOCAB: Record<WorkflowId, string[]> = {
  money_order: ['advance', 'baaki', 'pending', 'delivery', 'kilo', 'bag', 'quintal', 'rupees', 'cement', 'khata', 'per bag', 'per kilo'],
  service_request: ['plumber', 'electrician', 'estimate', 'request', 'leak', 'bathroom', 'Saturday', 'repair'],
  instruction: ['reminder', 'instruction', 'supervisor', 'next shift', 'before', 'tomorrow', 'morning', 'check', 'team'],
  handover: ['handover', 'pending', 'supervisor', 'next shift', 'inspection', 'filter', 'store room', 'restart'],
  risk_review: ['OTP', 'KYC', 'UPI', 'link', 'account', 'blocked'],
}
export const keytermsFor = (w: WorkflowId): string[] => VOCAB[w]

export interface SttOutput { transcript: string; model: string; detectedLanguage: string | null; truncated: boolean; processingTime: number | null; requestId: string }

export async function transcribe(input: { audio: Uint8Array; filename: string; mime: string; lang: Lang; workflow: WorkflowId; requestId?: string }): Promise<ProviderResult<SttOutput>> {
  const c = cfg()
  const v3 = c.sttModel === 'prisma-v3.0'
  const form = new FormData()
  form.append('audio_file', new Blob([input.audio as BlobPart], { type: input.mime }), input.filename)
  form.append('language_code', v3 ? LANG_HINT[input.lang] : LANG_HINT[input.lang].split(',')[0])
  if (v3) {
    form.append('model', 'prisma-v3.0')
    form.append('format', c.sttFormat)
    if (c.useKeyterms) form.append('keyterms', JSON.stringify(keytermsFor(input.workflow)))
  } else {
    form.append('format', c.sttFormat === 'verbatim' ? 'verbatim' : 'transcribe')
  }
  const requestId = input.requestId ?? crypto.randomUUID()
  const sent = await send(`${baseUrl()}/stt/v3`, { method: 'POST', headers: { 'X-API-Key-ID': key(), 'X-API-Request-ID': requestId }, body: form }, c.providerTimeoutMs)
  if ('fail' in sent) return sent.fail
  const res = sent.res
  if (!res.ok) return failFrom(res)
  let j: Record<string, unknown>
  try {
    j = (await res.json()) as Record<string, unknown>
  } catch {
    return { ok: false, status: 502, definite: false, code: 'BAD_RESPONSE', message: 'The speech service returned an unreadable answer.' }
  }
  if (j.success === false) {
    const e = (j.error ?? {}) as Record<string, unknown>
    return { ok: false, status: res.status, definite: false, code: String(e.type ?? 'STT_FAILED'), message: clip(String(e.message ?? 'Transcription failed')) }
  }
  if (typeof j.transcript !== 'string') return { ok: false, status: 502, definite: false, code: 'BAD_RESPONSE', message: 'The speech service returned no transcript field.' }
  return {
    ok: true,
    value: {
      transcript: j.transcript,
      model: typeof j.model === 'string' ? j.model : c.sttModel,
      detectedLanguage: typeof j.detected_language_code === 'string' ? j.detected_language_code : null,
      truncated: j.truncated === true,
      processingTime: typeof j.processing_time === 'number' ? j.processing_time : null,
      requestId: typeof j.request_id === 'string' ? j.request_id : requestId,
    },
  }
}

/* ---------------------------- TTS ---------------------------- */

export interface AudioOut { bytes: Uint8Array; contentType: string }
const MAX_AUDIO_BYTES_OUT = 3_500_000

async function readAudio(res: Response, defaultType: string): Promise<ProviderResult<AudioOut>> {
  const ct = (res.headers.get('content-type') || '').toLowerCase()
  if (ct.includes('json') || ct.includes('text/')) return { ok: false, status: 502, definite: false, code: 'BAD_RESPONSE', message: 'The voice service returned text instead of audio.' }
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.length < 64) return { ok: false, status: 502, definite: false, code: 'EMPTY_AUDIO', message: 'The voice service returned no audio.' }
  if (buf.length > MAX_AUDIO_BYTES_OUT) return { ok: false, status: 502, definite: false, code: 'AUDIO_TOO_LARGE', message: 'The audio response was too large.' }
  return { ok: true, value: { bytes: buf, contentType: ct && !ct.includes('octet-stream') ? ct.split(';')[0] : defaultType } }
}

/** Standard (non-cloned) synthesis for readbacks and clarification questions. */
export async function synthesize(text: string, language: string): Promise<ProviderResult<AudioOut>> {
  const c = cfg()
  const body = {
    text,
    model: c.ttsModel,
    voice: c.ttsVoice,
    language,
    speed: Math.min(1.15, Math.max(0.85, c.ttsSpeed)),
    audio_config: { sample_rate: 24000, num_channels: 1, sample_width: 2, container: 'mp3', bitrate: '64k' },
  }
  const sent = await send(`${baseUrl()}/api/v1/tts/inference`, { method: 'POST', headers: { 'X-API-Key-ID': key(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, c.providerTimeoutMs)
  if ('fail' in sent) return sent.fail
  if (!sent.res.ok) return failFrom(sent.res)
  return readAudio(sent.res, 'audio/mpeg')
}

/* ---------------------------- Voice cloning ---------------------------- */

/** Create a speaker embedding from consented reference audio. Admin-only caller. Result must stay server-side. */
export async function createEmbedding(input: { audio: Uint8Array; filename: string; mime: string }): Promise<ProviderResult<SpeakerEmbedding>> {
  const c = cfg()
  const form = new FormData()
  form.append('audio_file', new Blob([input.audio as BlobPart], { type: input.mime }), input.filename)
  const sent = await send(`${baseUrl()}/api/v1/tts/voice-clone/embeddings`, { method: 'POST', headers: { 'X-API-Key-ID': key() }, body: form }, c.providerTimeoutMs * 2)
  if ('fail' in sent) return sent.fail
  if (!sent.res.ok) return failFrom(sent.res)
  let j: { success?: boolean; data?: { voice_clone_embedding?: Partial<SpeakerEmbedding> } } & Partial<SpeakerEmbedding>
  try {
    j = await sent.res.json()
  } catch {
    return { ok: false, status: 502, definite: false, code: 'BAD_RESPONSE', message: 'Unreadable embedding response.' }
  }
  // The OpenAPI schema nests the artifact under data.voice_clone_embedding; the quick-start example shows it flat.
  // Accept both documented shapes, and nothing else.
  const e: Partial<SpeakerEmbedding> | undefined = j?.data?.voice_clone_embedding ?? (typeof j?.embedding === 'string' ? j : undefined)
  if (!e || typeof e.embedding !== 'string' || !Array.isArray(e.shape) || typeof e.dtype !== 'string') return { ok: false, status: 502, definite: false, code: 'BAD_RESPONSE', message: 'Embedding response is missing fields.' }
  // The object is preserved exactly as returned (not decoded or reshaped).
  return { ok: true, value: { embedding: e.embedding, shape: e.shape as number[], dtype: e.dtype } }
}

/** Cloned-voice synthesis of an already-approved narration. */
export async function synthesizeClone(text: string, speaker: SpeakerEmbedding): Promise<ProviderResult<AudioOut>> {
  const c = cfg()
  const body = {
    text,
    speaker_embedding: { embedding: speaker.embedding, shape: speaker.shape, dtype: speaker.dtype },
    audio_config: { sample_rate: c.vcSampleRate, num_channels: 1, sample_width: 2, encoding: 'linear_pcm', container: 'mp3', bitrate: '96k' },
  }
  const sent = await send(`${baseUrl()}/api/v1/tts/inference`, { method: 'POST', headers: { 'X-API-Key-ID': key(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, c.providerTimeoutMs)
  if ('fail' in sent) return sent.fail
  if (!sent.res.ok) return failFrom(sent.res)
  return readAudio(sent.res, 'audio/mpeg')
}

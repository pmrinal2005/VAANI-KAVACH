import { authSession, engineFail, fail, isResp, json, readJson, safe } from '@/lib/http'
import { isErr } from '@/lib/engine'
import { cfg } from '@/lib/config'
import { draftView, getDraft, sessionView, submitUtterance } from '@/lib/engine'
import { transcribe } from '@/lib/gnani'
import { runProvider } from '@/lib/provider'
import { wavSeconds } from '@/lib/audio'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const ALLOWED = new Map<string, string>([
  ['audio/wav', 'wav'], ['audio/x-wav', 'wav'], ['audio/wave', 'wav'], ['audio/mpeg', 'mp3'], ['audio/mp3', 'mp3'],
  ['audio/ogg', 'ogg'], ['audio/mp4', 'm4a'], ['audio/x-m4a', 'm4a'], ['audio/aac', 'aac'], ['audio/flac', 'flac'],
])

/** Recorded-turn path: browser clip -> Gnani STT REST -> same engine. Requires a live session (budget + slot already admitted). */
export const POST = safe(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const a = await authSession(req, id)
  if (isResp(a)) return a
  const c = cfg()
  if (a.session.mode !== 'live') return fail(409, 'text_mode', a.session.modeReason ?? 'This session is in text mode. Type your message instead.')
  if (c.killSwitch || !c.liveEnabled) return fail(503, 'live_unavailable', 'Live voice is switched off right now. Text mode still works.')
  if (a.session.turns >= c.maxTurns) return fail(429, 'turn_limit', `Spoken-turn limit (${c.maxTurns}) reached for this session. You can still type.`)

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return fail(400, 'bad_request', 'Send multipart form data with an "audio" file.')
  }
  const file = form.get('audio')
  if (!(file instanceof File)) return fail(400, 'bad_request', 'Missing "audio" file.')
  if (file.size === 0) return fail(400, 'empty_audio', 'The recording was empty.')
  if (file.size > c.maxAudioBytes) return fail(413, 'audio_too_large', `Recording is too large (limit ${Math.round(c.maxAudioBytes / 1000)} KB).`)
  const mime = (file.type || '').split(';')[0].toLowerCase()
  const ext = ALLOWED.get(mime)
  if (!ext) return fail(415, 'unsupported_audio', 'Unsupported audio type. Use WAV, MP3, OGG, M4A, AAC or FLAC (the speech service does not accept WebM).')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const wav = wavSeconds(bytes)
  const claimed = Number(form.get('durationMs') || 0) / 1000
  const secs = wav ?? (Number.isFinite(claimed) ? claimed : 0)
  if (secs > c.maxAudioSeconds) return fail(413, 'audio_too_long', `Recording is longer than ${c.maxAudioSeconds} seconds. Please record a shorter message.`)
  if (wav !== null && wav < 0.3) return fail(400, 'audio_too_short', 'That recording was too short to understand.')

  const r = await runProvider(a.store, 'stt', () => transcribe({ audio: bytes, filename: `turn.${ext}`, mime, lang: a.session.lang, workflow: a.session.workflow }))
  if (!r.ok) return fail(r.status, r.code, r.message)
  const stt = r.value
  if (!stt.transcript.trim()) return fail(422, 'no_speech', 'No speech was detected. Nothing was recorded; try again or type.')
  if (stt.truncated) return fail(422, 'transcript_truncated', 'The transcript was cut short. Please record a shorter message.')

  const u = await submitUtterance(a.store, id, { text: stt.transcript, source: 'stt', sttModel: stt.model, detectedLanguage: stt.detectedLanguage ?? undefined, audioMs: secs * 1000 || undefined })
  if (isErr(u)) return engineFail(u)
  const d = await getDraft(a.store, u.session)
  return json({ ok: true, transcript: stt.transcript, detectedLanguage: stt.detectedLanguage, notice: u.notice, session: sessionView(u.session), draft: draftView(u.session, d) })
})

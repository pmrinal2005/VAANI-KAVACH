import { adminOk } from '@/lib/auth'
import { createEmbedding } from '@/lib/gnani'
import { fail, json, safe } from '@/lib/http'
import { runProvider } from '@/lib/provider'
import { getStore } from '@/lib/store'
import { cfg } from '@/lib/config'
import { consentState, recordConsent, revokeConsent, sealEmbedding } from '@/lib/voice'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export const GET = safe(async (req: Request) => {
  if (!adminOk(req)) return fail(401, 'unauthorized', 'Admin token required.')
  return json({ ok: true, ...(await consentState(getStore())) })
})

/**
 * Closed enrollment (no public endpoint). multipart: action=enroll, audio=<5-30 s clip>, consent=yes, purpose=<text>
 *   or JSON-less form: action=revoke.
 * Enroll returns ONLY an AES-GCM sealed blob to place in VOICE_EMBEDDING_ENC; the raw embedding is never returned or stored.
 */
export const POST = safe(async (req: Request) => {
  if (!adminOk(req)) return fail(401, 'unauthorized', 'Admin token required.')
  const store = getStore()
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return fail(400, 'bad_request', 'Send multipart form data.')
  }
  const action = String(form.get('action') || '')
  if (action === 'revoke') {
    await revokeConsent(store)
    return json({ ok: true, revoked: true, note: 'New synthesis is blocked immediately. Audio already downloaded cannot be recalled; delete VOICE_EMBEDDING_ENC to remove the stored artifact.' })
  }
  if (action !== 'enroll') return fail(400, 'bad_request', 'action must be "enroll" or "revoke".')
  if (String(form.get('consent') || '') !== 'yes') return fail(400, 'consent_required', 'Explicit consent of the voice owner is required (consent=yes).')
  if (!cfg().voiceEncKeyHex) return fail(409, 'no_enc_key', 'Set VOICE_ENC_KEY (64 hex chars) first.')
  const file = form.get('audio')
  if (!(file instanceof File) || file.size < 2000 || file.size > 3_000_000) return fail(400, 'bad_audio', 'Provide a 5-30 second reference clip (2 KB - 3 MB).')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const r = await runProvider(store, 'embed', () => createEmbedding({ audio: bytes, filename: file.name || 'ref.wav', mime: file.type || 'audio/wav' }), { pool: 'voice' })
  if (!r.ok) return fail(r.status, r.code, r.message)
  const sealed = await sealEmbedding(r.value)
  await recordConsent(store, String(form.get('purpose') || 'approved-record narration'))
  return json({ ok: true, VOICE_EMBEDDING_ENC: sealed, next: 'Set VOICE_EMBEDDING_ENC to this value and VOICE_CONSENT_ENV=active, then redeploy.' })
})

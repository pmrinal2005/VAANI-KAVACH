import { NextResponse } from 'next/server'
import { authSession, engineFail, fail, isResp, json, readJson, safe } from '@/lib/http'
import { isErr } from '@/lib/engine'
import { getRecordForSession, noteProviderUse, refundProviderUse } from '@/lib/engine'
import { synthesizeClone } from '@/lib/gnani'
import { runProvider } from '@/lib/provider'
import { buildNarration, speechText } from '@/lib/readback'
import { consentState, loadEmbedding } from '@/lib/voice'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Disclosed approved-voice narration of an ALREADY COMMITTED record.
 * Text is built here from the stored record; the caller cannot supply words. A cloned voice never authorizes anything.
 * The record content digest is unchanged by narration (the audio carries its own metadata).
 */
export const POST = safe(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const a = await authSession(req, id)
  if (isResp(a)) return a
  if (a.session.mode !== 'live') return fail(409, 'text_mode', 'Approved-voice playback needs a live session.')
  if (a.session.state !== 'committed') return fail(409, 'not_committed', 'Only an approved (confirmed) record can be narrated.')
  const st = await consentState(a.store)
  if (!st.active) return fail(409, 'voice_unavailable', `${st.reason ?? 'Approved voice unavailable.'} The standard voice and the text remain available.`)
  const rec = await getRecordForSession(a.store, a.session)
  if (!rec) return fail(404, 'record_missing', 'The confirmed record could not be loaded.')
  const emb = await loadEmbedding(a.store)
  if (!emb.ok) return fail(409, 'voice_unavailable', `${emb.reason} The standard voice remains available.`)

  const used = await noteProviderUse(a.store, id, 'clone')
  if (isErr(used)) return engineFail(used)
  const text = speechText(buildNarration(rec.payload)).slice(0, 1200)
  const r = await runProvider(a.store, 'vc', () => synthesizeClone(text, emb.embedding))
  if (!r.ok) {
    if (r.status === 429 || r.status === 400 || r.status === 503) await refundProviderUse(a.store, id, 'clone').catch(() => undefined)
    return fail(r.status, r.code, `${r.message} The confirmed record is unaffected; use the standard voice or read the text.`)
  }
  return new NextResponse(r.value.bytes as unknown as BodyInit, {
    status: 200,
    headers: { 'Content-Type': r.value.contentType, 'Cache-Control': 'private, max-age=600', 'X-VK-Voice': 'approved-voice-synthetic', 'X-VK-Record': rec.payload.id, 'X-VK-Content-Digest': rec.payload.content_digest },
  })
})

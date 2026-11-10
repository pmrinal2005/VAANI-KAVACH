import { NextResponse } from 'next/server'
import { authSession, engineFail, fail, isResp, json, readJson, safe } from '@/lib/http'
import { isErr } from '@/lib/engine'
import { cfg } from '@/lib/config'
import { getDraft, noteProviderUse, refundProviderUse } from '@/lib/engine'
import { synthesize } from '@/lib/gnani'
import { runProvider } from '@/lib/provider'
import { buildQuestion, buildReadback, checkLines, speechText } from '@/lib/readback'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Standard-voice playback. The spoken text is ALWAYS rebuilt on the server from the stored draft with reviewed templates;
 * the client chooses only which template ("readback" or "question"), never the words.
 */
export const POST = safe(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const a = await authSession(req, id)
  if (isResp(a)) return a
  const c = cfg()
  if (a.session.mode !== 'live') return fail(409, 'text_mode', 'Voice playback is only available in live mode. The text readback above is the authoritative version.')
  if (c.killSwitch || !c.liveEnabled) return fail(503, 'live_unavailable', 'Live voice is switched off right now. Read the text instead.')
  const body = await readJson<{ target?: unknown }>(req)
  const target = body?.target === 'question' ? 'question' : 'readback'
  const d = await getDraft(a.store, a.session)
  if (!d) return fail(409, 'no_draft', 'Nothing to speak yet.')

  let text: string
  if (target === 'question') {
    const q = buildQuestion(d)
    if (!q) return fail(409, 'no_question', 'There is no open question.')
    text = q
  } else {
    const rbDone = !!a.session.readback && a.session.readback.version === d.version && a.session.readback.digest === d.digest
    if (!rbDone) return fail(409, 'readback_required', 'Start the readback first.')
    const rb = buildReadback(d)
    const checks = checkLines(d)
    text = `${rb.text}${checks.length ? ' Please check: ' + checks.join(' ') : ''}`
  }
  const spoken = speechText(text).slice(0, 1200)
  const used = await noteProviderUse(a.store, id, 'tts')
  if (isErr(used)) return engineFail(used)
  const lang = buildReadback(d).ttsLanguage
  const r = await runProvider(a.store, 'tts', () => synthesize(spoken, lang))
  if (!r.ok) {
    if (r.status === 429 || r.status === 400 || r.status === 503) await refundProviderUse(a.store, id, 'tts').catch(() => undefined)
    return fail(r.status, r.code, `${r.message} The text readback above is still authoritative.`)
  }
  return new NextResponse(r.value.bytes as unknown as BodyInit, {
    status: 200,
    headers: { 'Content-Type': r.value.contentType, 'Cache-Control': 'private, max-age=600', 'X-VK-Voice': 'standard-synthetic', 'X-VK-Version': String(d.version), 'X-VK-Digest': d.digest },
  })
})

import { authSession, engineFail, fail, isResp, json, readJson, safe } from '@/lib/http'
import { isErr } from '@/lib/engine'
import { draftView, getDraft, sessionView, submitUtterance } from '@/lib/engine'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Typed (or already-transcribed) text enters the SAME engine as speech. */
export const POST = safe(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const a = await authSession(req, id)
  if (isResp(a)) return a
  const body = await readJson<{ text?: unknown }>(req)
  if (!body || typeof body.text !== 'string') return fail(400, 'bad_request', 'Send { "text": "..." }.')
  const r = await submitUtterance(a.store, id, { text: body.text, source: 'typed' })
  if (isErr(r)) return engineFail(r)
  const d = await getDraft(a.store, r.session)
  return json({ ok: true, notice: r.notice, session: sessionView(r.session), draft: draftView(r.session, d) })
})

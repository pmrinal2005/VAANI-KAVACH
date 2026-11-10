import { authSession, engineFail, fail, isResp, json, readJson, safe } from '@/lib/http'
import { isErr } from '@/lib/engine'
import { draftView, sessionView, startReadback } from '@/lib/engine'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Binds a readback to the current version + digest. Confirmation must quote the same pair. */
export const POST = safe(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const a = await authSession(req, id)
  if (isResp(a)) return a
  const r = await startReadback(a.store, id)
  if (isErr(r)) return engineFail(r)
  return json({ ok: true, session: sessionView(r.session), draft: draftView(r.session, r.draft), checks: r.checks })
})

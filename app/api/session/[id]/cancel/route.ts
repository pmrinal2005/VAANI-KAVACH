import { authSession, engineFail, fail, isResp, json, readJson, safe } from '@/lib/http'
import { isErr } from '@/lib/engine'
import { cancelSession, sessionView } from '@/lib/engine'
import { releaseSlot } from '@/lib/budget'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = safe(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const a = await authSession(req, id)
  if (isResp(a)) return a
  const r = await cancelSession(a.store, id)
  if (isErr(r)) return engineFail(r)
  if (a.session.liveSlot) await releaseSlot(a.store, id).catch(() => undefined)
  return json({ ok: true, session: sessionView(r.session) })
})

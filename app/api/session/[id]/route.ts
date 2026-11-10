import { authSession, isResp, json, safe } from '@/lib/http'
import { draftView, getDraft, getRecordForSession, sessionView } from '@/lib/engine'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Current session + draft view (and the signed record once committed). Used to refresh counters without side effects. */
export const GET = safe(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const a = await authSession(req, id)
  if (isResp(a)) return a
  const d = await getDraft(a.store, a.session)
  const record = await getRecordForSession(a.store, a.session)
  return json({ ok: true, session: sessionView(a.session), draft: draftView(a.session, d), record })
})

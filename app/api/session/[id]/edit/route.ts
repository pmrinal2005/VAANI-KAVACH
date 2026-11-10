import { authSession, engineFail, fail, isResp, json, readJson, safe } from '@/lib/http'
import { isErr } from '@/lib/engine'
import { draftView, editField, sessionView } from '@/lib/engine'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Typed correction of one field. Creates a new draft version and invalidates any earlier readback. */
export const POST = safe(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const a = await authSession(req, id)
  if (isResp(a)) return a
  const body = await readJson<{ field?: unknown; value?: unknown }>(req)
  if (!body || typeof body.field !== 'string' || typeof body.value !== 'string') return fail(400, 'bad_request', 'Send { "field": "...", "value": "..." }.')
  const r = await editField(a.store, id, body.field, body.value)
  if (isErr(r)) return engineFail(r)
  return json({ ok: true, session: sessionView(r.session), draft: draftView(r.session, r.draft) })
})

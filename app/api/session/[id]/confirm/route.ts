import { authSession, engineFail, fail, isResp, json, readJson, safe } from '@/lib/http'
import { isErr } from '@/lib/engine'
import { confirm, sessionView } from '@/lib/engine'
import { releaseSlot } from '@/lib/budget'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** The ONLY write path for a durable record. Idempotent; stale versions are rejected. */
export const POST = safe(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const a = await authSession(req, id)
  if (isResp(a)) return a
  const body = await readJson<{ version?: unknown; digest?: unknown; criticalAck?: unknown; idempotencyKey?: unknown }>(req)
  if (!body) return fail(400, 'bad_request', 'Invalid JSON body.')
  const r = await confirm(a.store, id, {
    version: body.version as number,
    digest: body.digest as string,
    criticalAck: body.criticalAck === true,
    idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
  })
  if (isErr(r)) return engineFail(r)
  if (a.session.liveSlot) await releaseSlot(a.store, id).catch(() => undefined)
  return json({ ok: true, duplicate: r.duplicate, session: sessionView(r.session), record: r.record })
})

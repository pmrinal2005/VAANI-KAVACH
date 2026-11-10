import { adminOk } from '@/lib/auth'
import { adminView, resolveUncertain, summary } from '@/lib/budget'
import { fail, json, readJson, safe } from '@/lib/http'
import { getStore } from '@/lib/store'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = safe(async (req: Request) => {
  if (!adminOk(req)) return fail(401, 'unauthorized', 'Admin token required.')
  const store = getStore()
  return json({ ok: true, summary: await summary(store), pools: (await adminView(store)).pools, uncertain: (await adminView(store)).uncertain })
})

/** Resolve an uncertain charge manually: { opId, action: "release" | "spend" }. */
export const POST = safe(async (req: Request) => {
  if (!adminOk(req)) return fail(401, 'unauthorized', 'Admin token required.')
  const b = await readJson<{ opId?: unknown; action?: unknown }>(req)
  if (!b || typeof b.opId !== 'string' || (b.action !== 'release' && b.action !== 'spend')) return fail(400, 'bad_request', 'Send { "opId": "...", "action": "release"|"spend" }.')
  const ok = await resolveUncertain(getStore(), b.opId, b.action)
  return ok ? json({ ok: true }) : fail(404, 'not_found', 'No such uncertain operation.')
})

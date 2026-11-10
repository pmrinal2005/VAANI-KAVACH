import { cfg } from '@/lib/config'
import { getStore } from '@/lib/store'
import { summary } from '@/lib/budget'
import { consentState } from '@/lib/voice'
import { sessionSecret } from '@/lib/auth'
import { json, safe } from '@/lib/http'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Readiness. Non-billable: reports configuration and budget state only; never calls Gnani. */
export const GET = safe(async () => {
  const c = cfg()
  const store = getStore()
  let storeOk = true
  let budget = null as Awaited<ReturnType<typeof summary>> | null
  try {
    budget = await summary(store)
  } catch {
    storeOk = false
  }
  const durable = store.durable
  const keyOk = !!c.gnaniKey
  const liveAllowed = c.liveEnabled && !c.killSwitch && keyOk && storeOk && (durable || c.allowMemoryBudget)
  let liveReason: string | null = null
  if (!c.liveEnabled || c.killSwitch) liveReason = 'Live voice is switched off.'
  else if (!keyOk) liveReason = 'Speech provider is not configured on this deployment.'
  else if (!storeOk) liveReason = 'State storage is unavailable.'
  else if (!durable && !c.allowMemoryBudget) liveReason = 'Live voice needs durable storage so the budget cannot be bypassed across instances.'
  else if (budget && budget.remaining <= 0) liveReason = 'The live allocation is used up.'
  const clone = await consentState(store).catch(() => ({ active: false, reason: 'unavailable' as string | null }))
  return json({
    ok: true,
    storage: { kind: store.kind, durable, ok: storeOk },
    sessionSecretConfigured: sessionSecret().configured,
    live: { available: liveAllowed && !(budget && budget.remaining <= 0), reason: liveReason, sttModel: c.sttModel, ttsModel: c.ttsModel },
    clone: { available: clone.active, reason: clone.reason },
    budget: budget && { pool: budget.activePool, remaining: budget.remaining, cap: budget.cap, tariffCalibrated: budget.tariffCalibrated, slotBusy: budget.slotBusy },
    limits: { sessionSeconds: c.sessionMaxSeconds, maxTurns: c.maxTurns, maxAudioSeconds: c.maxAudioSeconds },
    note: 'Budget numbers are application credit units, not Gnani tariffs.',
  })
})

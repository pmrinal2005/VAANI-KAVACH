/** Wraps every paid provider call in a budget reservation. Never retries automatically. */
import { reserve, settle, type OpKind } from './budget'
import type { PoolName } from './config'
import type { ProviderResult } from './gnani'
import type { Store } from './store'

export interface ApiFail { ok: false; status: number; code: string; message: string }

const RESERVE_FAIL: Record<string, ApiFail> = {
  killed: { ok: false, status: 503, code: 'live_unavailable', message: 'Live voice is switched off right now. Text mode still works.' },
  reserve_protected: { ok: false, status: 503, code: 'reserve_protected', message: 'This budget pool is protected and cannot be used automatically.' },
  pool_exhausted: { ok: false, status: 503, code: 'budget_exhausted', message: 'The live allocation for this demo is used up. Text mode and the prerecorded example still work.' },
  too_many_inflight: { ok: false, status: 429, code: 'busy', message: 'Too many requests are in flight. Please wait a moment.' },
}

export async function runProvider<T>(store: Store, kind: OpKind, run: () => Promise<ProviderResult<T>>, o: { pool?: PoolName; manualRelease?: boolean } = {}): Promise<{ ok: true; value: T } | ApiFail> {
  const r = await reserve(store, kind, Date.now(), o)
  if (!r.ok) return RESERVE_FAIL[r.reason]
  let res: ProviderResult<T>
  try {
    res = await run()
  } catch {
    await settle(store, r.opId, 'uncertain')
    return { ok: false, status: 502, code: 'provider_error', message: 'The speech service failed unexpectedly. Nothing was recorded.' }
  }
  if (res.ok) {
    await settle(store, r.opId, 'completed')
    return { ok: true, value: res.value }
  }
  await settle(store, r.opId, res.definite ? 'released' : 'uncertain')
  const status = res.status === 429 ? 429 : res.status === 401 || res.status === 403 || res.status === 402 ? 503 : res.status >= 400 && res.status < 500 ? 400 : 502
  const message = res.status === 429
    ? 'The speech service is busy. Please wait a few seconds and try again (not retried automatically).'
    : res.status === 401 || res.status === 403 || res.status === 402
      ? 'The speech service rejected this server\'s credentials or credit. Text mode still works.'
      : res.code === 'TIMEOUT'
        ? 'The speech service timed out. It may still be processing, so this attempt stays reserved and is not retried automatically.'
        : res.message
  return { ok: false, status, code: `provider_${res.code.toLowerCase()}`.slice(0, 48), message }
}

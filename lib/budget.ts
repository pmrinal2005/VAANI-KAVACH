/**
 * Budget governor: seven fixed pools, conservative reservations, a single live-session slot and a kill switch.
 * All numbers are APPLICATION credit units, NOT Gnani tariffs (see cfg().tariffCalibrated).
 * Rules enforced here:
 *  - the protected reserve pool is never spent automatically and nothing borrows between pools;
 *  - a reservation is atomic (compare-and-set on one document);
 *  - uncertain outcomes (timeout / 5xx / network error after submission) stay reserved until an admin resolves them.
 */
import { cfg, POOL_CAPS, type PoolName } from './config'
import { getStore, type Store } from './store'

export type OpKind = 'stt' | 'tts' | 'vc' | 'embed'
export type Outcome = 'completed' | 'released' | 'uncertain'

interface Pool { cap: number; spent: number; reserved: number }
interface Op { pool: PoolName; amount: number; kind: OpKind; at: number }
interface Uncertain extends Op { opId: string }
export interface BudgetDoc {
  pools: Record<PoolName, Pool>
  ops: Record<string, Op>
  uncertain: Uncertain[]
  slot: { sid: string; until: number } | null
}

const KEY = 'budget:v1'
const MAX_OPS = 200
const MAX_UNCERTAIN = 200

export function freshBudget(): BudgetDoc {
  const pools = {} as Record<PoolName, Pool>
  for (const k of Object.keys(POOL_CAPS) as PoolName[]) pools[k] = { cap: POOL_CAPS[k], spent: 0, reserved: 0 }
  return { pools, ops: {}, uncertain: [], slot: null }
}

export const costFor = (kind: OpKind): number => {
  const c = cfg()
  return kind === 'stt' ? c.costStt : kind === 'tts' ? c.costTts : kind === 'vc' ? c.costVc : c.costEmbed
}

function capOf(pool: PoolName): number {
  return pool === 'public' ? Math.min(cfg().publicPoolCap, POOL_CAPS.public) : POOL_CAPS[pool]
}

/** Read-modify-write helper that (unlike store.update) always starts from the budget document. */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function mutate<R>(store: Store, fn: (b: BudgetDoc) => { next: BudgetDoc; result: R } | { abort: R }): Promise<R> {
  // Many callers racing for one document each need a turn; jittered backoff spreads them out. Exhausting the
  // attempts throws (fails CLOSED: no reservation is made), which the route layer reports as a retryable 503.
  for (let i = 0; i < 80; i++) {
    if (i >= 3) await sleep(Math.random() * Math.min(20, i))
    let cur = await store.get<BudgetDoc>(KEY)
    if (!cur) {
      await store.putIfAbsent(KEY, freshBudget())
      cur = await store.get<BudgetDoc>(KEY)
      if (!cur) continue
    }
    const out = fn(structuredClone(cur.value))
    if ('abort' in out) return out.abort
    if (await store.cas(KEY, cur.rev, out.next)) return out.result
  }
  throw new Error('budget_contention')
}

function sweep(b: BudgetDoc, nowMs: number): void {
  const stale = cfg().providerTimeoutMs * 2 + 10_000
  for (const [id, op] of Object.entries(b.ops)) {
    if (nowMs - op.at > stale) {
      delete b.ops[id]
      b.uncertain.push({ ...op, opId: id }) // abandoned mid-flight: keep the money reserved, never assume it was free
    }
  }
  if (b.uncertain.length > MAX_UNCERTAIN) b.uncertain = b.uncertain.slice(-MAX_UNCERTAIN)
}

export type ReserveResult = { ok: true; opId: string; amount: number } | { ok: false; reason: 'killed' | 'reserve_protected' | 'pool_exhausted' | 'too_many_inflight' }

export async function reserve(store: Store, kind: OpKind, nowMs = Date.now(), opts: { pool?: PoolName; manualRelease?: boolean } = {}): Promise<ReserveResult> {
  const c = cfg()
  if (c.killSwitch) return { ok: false, reason: 'killed' }
  const pool = opts.pool ?? c.activePool
  if (pool === 'reserve' && !opts.manualRelease) return { ok: false, reason: 'reserve_protected' }
  const amount = costFor(kind)
  const opId = `op_${crypto.randomUUID()}`
  return mutate<ReserveResult>(store, (b) => {
    sweep(b, nowMs)
    const p = b.pools[pool]
    p.cap = capOf(pool)
    if (Object.keys(b.ops).length >= MAX_OPS) return { abort: { ok: false, reason: 'too_many_inflight' } }
    if (p.spent + p.reserved + amount > p.cap) return { abort: { ok: false, reason: 'pool_exhausted' } }
    p.reserved += amount
    b.ops[opId] = { pool, amount, kind, at: nowMs }
    return { next: b, result: { ok: true, opId, amount } }
  })
}

export async function settle(store: Store, opId: string, outcome: Outcome, nowMs = Date.now()): Promise<void> {
  await mutate<void>(store, (b) => {
    const op = b.ops[opId]
    if (!op) return { abort: undefined } // already settled or swept (swept ops are in `uncertain`)
    delete b.ops[opId]
    const p = b.pools[op.pool]
    if (outcome === 'completed') {
      p.reserved = Math.max(0, p.reserved - op.amount)
      p.spent += op.amount
    } else if (outcome === 'released') {
      p.reserved = Math.max(0, p.reserved - op.amount)
    } else {
      b.uncertain.push({ ...op, opId, at: nowMs }) // stays inside pool.reserved
    }
    return { next: b, result: undefined }
  })
}

export async function resolveUncertain(store: Store, opId: string, action: 'release' | 'spend'): Promise<boolean> {
  return mutate<boolean>(store, (b) => {
    const i = b.uncertain.findIndex((u) => u.opId === opId)
    if (i < 0) return { abort: false }
    const [u] = b.uncertain.splice(i, 1)
    const p = b.pools[u.pool]
    p.reserved = Math.max(0, p.reserved - u.amount)
    if (action === 'spend') p.spent += u.amount
    return { next: b, result: true }
  })
}

/* ---------------- one live-session slot ---------------- */

export async function acquireSlot(store: Store, sid: string, nowMs = Date.now()): Promise<{ ok: boolean; busyUntil?: number }> {
  const until = nowMs + cfg().sessionMaxSeconds * 1000 + 15_000
  return mutate<{ ok: boolean; busyUntil?: number }>(store, (b) => {
    if (b.slot && b.slot.until > nowMs && b.slot.sid !== sid) return { abort: { ok: false, busyUntil: b.slot.until } }
    b.slot = { sid, until }
    return { next: b, result: { ok: true } }
  })
}

export async function releaseSlot(store: Store, sid: string): Promise<void> {
  await mutate<void>(store, (b) => {
    if (!b.slot || b.slot.sid !== sid) return { abort: undefined }
    b.slot = null
    return { next: b, result: undefined }
  })
}

/* ---------------- views ---------------- */

export interface BudgetSummary {
  activePool: PoolName
  cap: number
  remaining: number
  uncertainCount: number
  slotBusy: boolean
  tariffCalibrated: boolean
  killSwitch: boolean
}

export async function summary(store: Store = getStore(), nowMs = Date.now()): Promise<BudgetSummary> {
  const c = cfg()
  const cur = await store.get<BudgetDoc>(KEY)
  const b = cur?.value ?? freshBudget()
  const p = b.pools[c.activePool]
  const cap = capOf(c.activePool)
  return {
    activePool: c.activePool,
    cap,
    remaining: Math.max(0, cap - p.spent - p.reserved),
    uncertainCount: b.uncertain.length,
    slotBusy: !!b.slot && b.slot.until > nowMs,
    tariffCalibrated: c.tariffCalibrated,
    killSwitch: c.killSwitch,
  }
}

/** Full admin view (pool totals + uncertain entries). */
export async function adminView(store: Store = getStore()): Promise<BudgetDoc> {
  return (await store.get<BudgetDoc>(KEY))?.value ?? freshBudget()
}

export function poolCapsTotal(): number {
  return (Object.values(POOL_CAPS) as number[]).reduce((a, b) => a + b, 0)
}

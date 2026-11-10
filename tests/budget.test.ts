import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryStore } from '@/lib/store'
import { reserve, settle, resolveUncertain, acquireSlot, releaseSlot, summary, adminView, poolCapsTotal } from '@/lib/budget'
import { POOL_CAPS } from '@/lib/config'

let store: MemoryStore
const env = { ...process.env }
beforeEach(() => { store = new MemoryStore(); process.env = { ...env } })
afterEach(() => { process.env = { ...env } })

describe('budget governor', () => {
  it('the seven pools sum to exactly 3000 and the reserve is protected', async () => {
    expect(poolCapsTotal()).toBe(3000)
    expect(Object.keys(POOL_CAPS)).toHaveLength(7)
    const r = await reserve(store, 'stt', Date.now(), { pool: 'reserve' })
    expect(r).toEqual({ ok: false, reason: 'reserve_protected' })
  })

  it('reserves, completes and reconciles; failed-before-charge releases', async () => {
    const a = await reserve(store, 'stt')
    if (!a.ok) throw new Error('reserve')
    let s = await summary(store)
    expect(s.remaining).toBe(600 - 3)
    await settle(store, a.opId, 'completed')
    s = await summary(store)
    expect(s.remaining).toBe(597)
    const b = await reserve(store, 'tts')
    if (!b.ok) throw new Error('reserve')
    await settle(store, b.opId, 'released')
    expect((await summary(store)).remaining).toBe(597)
  })

  it('exhausts a pool and never borrows from reserve or another pool', async () => {
    process.env.POOL_PUBLIC_CAP = '10'
    process.env.COST_STT = '4'
    expect((await reserve(store, 'stt')).ok).toBe(true)
    expect((await reserve(store, 'stt')).ok).toBe(true)
    const third = await reserve(store, 'stt')
    expect(third).toEqual({ ok: false, reason: 'pool_exhausted' })
    const d = await adminView(store)
    expect(d.pools.reserve.spent + d.pools.reserve.reserved).toBe(0)
    expect(d.pools.eval.spent + d.pools.eval.reserved).toBe(0)
  })

  it('uncertain outcomes stay reserved until an admin resolves them', async () => {
    const a = await reserve(store, 'vc')
    if (!a.ok) throw new Error('reserve')
    await settle(store, a.opId, 'uncertain')
    expect((await summary(store)).remaining).toBe(600 - 4)
    expect((await summary(store)).uncertainCount).toBe(1)
    expect(await resolveUncertain(store, a.opId, 'release')).toBe(true)
    expect((await summary(store)).remaining).toBe(600)
    expect(await resolveUncertain(store, a.opId, 'release')).toBe(false)
  })

  it('abandoned in-flight operations are swept into uncertain, never forgotten as free', async () => {
    const t0 = 1_000_000
    const a = await reserve(store, 'stt', t0)
    if (!a.ok) throw new Error('reserve')
    await reserve(store, 'tts', t0 + 5 * 60_000) // triggers sweep
    const d = await adminView(store)
    expect(d.uncertain.some((u) => u.opId === a.opId)).toBe(true)
    expect(d.pools.public.reserved).toBeGreaterThanOrEqual(3)
  })

  it('concurrent reservations never exceed the cap (atomic compare-and-set)', async () => {
    process.env.POOL_PUBLIC_CAP = '30'
    process.env.COST_STT = '3'
    const rs = await Promise.all(Array.from({ length: 40 }, () => reserve(store, 'stt')))
    expect(rs.filter((r) => r.ok).length).toBe(10)
    const s = await summary(store)
    expect(s.remaining).toBe(0)
  })

  it('kill switch blocks everything', async () => {
    process.env.KILL_SWITCH = 'true'
    expect(await reserve(store, 'stt')).toEqual({ ok: false, reason: 'killed' })
  })

  it('only one live slot at a time; it frees on release and after expiry', async () => {
    const t = 5_000_000
    expect((await acquireSlot(store, 'a', t)).ok).toBe(true)
    expect((await acquireSlot(store, 'b', t + 1000)).ok).toBe(false)
    expect((await acquireSlot(store, 'a', t + 2000)).ok).toBe(true) // same owner re-entrant
    await releaseSlot(store, 'b') // wrong owner: no effect
    expect((await acquireSlot(store, 'b', t + 3000)).ok).toBe(false)
    await releaseSlot(store, 'a')
    expect((await acquireSlot(store, 'b', t + 4000)).ok).toBe(true)
    expect((await acquireSlot(store, 'c', t + 4000 + 10 * 60_000)).ok).toBe(true) // expired
  })
})

/**
 * Durable-state abstraction. Two backends:
 *  - memory   : per-process Map (dev / tests / single-instance). NOT durable and NOT shared across serverless instances.
 *  - supabase : PostgREST over fetch (no SDK). One table `vk_kv` (see migrations/0001_vk_kv.sql). Server-side service key only.
 * The interface is compare-and-set based so budget reservations, the live slot and commit idempotency are atomic.
 */
import { cfg } from './config'

export interface Versioned<T> {
  value: T
  rev: number
}

export interface Store {
  kind: 'memory' | 'supabase'
  /** true only when state survives restarts AND is shared by every instance. */
  durable: boolean
  get<T>(key: string): Promise<Versioned<T> | null>
  /** Insert only if the key does not exist. Returns true if inserted. */
  putIfAbsent<T>(key: string, value: T): Promise<boolean>
  /** Update only if the stored rev equals expectedRev. Returns true if updated. */
  cas<T>(key: string, expectedRev: number, value: T): Promise<boolean>
  delete(key: string): Promise<void>
}

/* ---------------- memory ---------------- */

export class MemoryStore implements Store {
  kind = 'memory' as const
  durable = false
  private m = new Map<string, { value: unknown; rev: number }>()
  async get<T>(key: string): Promise<Versioned<T> | null> {
    const e = this.m.get(key)
    return e ? { value: structuredClone(e.value) as T, rev: e.rev } : null
  }
  async putIfAbsent<T>(key: string, value: T): Promise<boolean> {
    if (this.m.has(key)) return false
    if (this.m.size > 20000) this.m.delete(this.m.keys().next().value as string) // crude bound; memory store is a dev aid
    this.m.set(key, { value: structuredClone(value), rev: 1 })
    return true
  }
  async cas<T>(key: string, expectedRev: number, value: T): Promise<boolean> {
    const e = this.m.get(key)
    if (!e || e.rev !== expectedRev) return false
    this.m.set(key, { value: structuredClone(value), rev: expectedRev + 1 })
    return true
  }
  async delete(key: string): Promise<void> {
    this.m.delete(key)
  }
}

/* ---------------- supabase (PostgREST) ---------------- */

export class SupabaseStore implements Store {
  kind = 'supabase' as const
  durable = true
  constructor(private url: string, private key: string, private f: typeof fetch = fetch) {}
  private h(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', ...extra }
  }
  private t = () => `${this.url}/rest/v1/vk_kv`
  async get<T>(key: string): Promise<Versioned<T> | null> {
    const r = await this.f(`${this.t()}?key=eq.${encodeURIComponent(key)}&select=value,rev`, { headers: this.h(), cache: 'no-store' })
    if (!r.ok) throw new Error(`store_get_failed:${r.status}`)
    const rows = (await r.json()) as Array<{ value: T; rev: number }>
    return rows[0] ? { value: rows[0].value, rev: rows[0].rev } : null
  }
  async putIfAbsent<T>(key: string, value: T): Promise<boolean> {
    const r = await this.f(`${this.t()}?on_conflict=key`, {
      method: 'POST',
      headers: this.h({ Prefer: 'resolution=ignore-duplicates,return=representation' }),
      body: JSON.stringify({ key, value, rev: 1 }),
      cache: 'no-store',
    })
    if (!r.ok) throw new Error(`store_put_failed:${r.status}`)
    return ((await r.json()) as unknown[]).length === 1
  }
  async cas<T>(key: string, expectedRev: number, value: T): Promise<boolean> {
    const r = await this.f(`${this.t()}?key=eq.${encodeURIComponent(key)}&rev=eq.${expectedRev}`, {
      method: 'PATCH',
      headers: this.h({ Prefer: 'return=representation' }),
      body: JSON.stringify({ value, rev: expectedRev + 1, updated_at: new Date().toISOString() }),
      cache: 'no-store',
    })
    if (!r.ok) throw new Error(`store_cas_failed:${r.status}`)
    return ((await r.json()) as unknown[]).length === 1
  }
  async delete(key: string): Promise<void> {
    await this.f(`${this.t()}?key=eq.${encodeURIComponent(key)}`, { method: 'DELETE', headers: this.h(), cache: 'no-store' })
  }
}

/* ---------------- factory ---------------- */

const g = globalThis as unknown as { __vkStore?: Store; __vkStoreSig?: string }

export function getStore(): Store {
  const c = cfg()
  const sig = `${c.storeBackend}|${c.supabaseUrl}|${c.supabaseServiceKey ? 'k' : ''}`
  if (g.__vkStore && g.__vkStoreSig === sig) return g.__vkStore
  const s: Store = c.storeBackend === 'supabase' && c.supabaseUrl && c.supabaseServiceKey ? new SupabaseStore(c.supabaseUrl, c.supabaseServiceKey) : new MemoryStore()
  g.__vkStore = s
  g.__vkStoreSig = sig
  return s
}

/** Test helper. */
export function setStoreForTests(s: Store | null): void {
  g.__vkStore = s ?? undefined
  g.__vkStoreSig = s ? `${cfg().storeBackend}|${cfg().supabaseUrl}|${cfg().supabaseServiceKey ? 'k' : ''}` : undefined
}

/** Retry a read-modify-write on a single key until the CAS wins (bounded). */
export async function update<T>(store: Store, key: string, init: T, fn: (cur: T) => { next: T; result?: unknown } | null, tries = 8): Promise<{ ok: boolean; value: T; result?: unknown }> {
  for (let i = 0; i < tries; i++) {
    let cur = await store.get<T>(key)
    if (!cur) {
      await store.putIfAbsent(key, init)
      cur = await store.get<T>(key)
      if (!cur) continue
    }
    const out = fn(structuredClone(cur.value))
    if (out === null) return { ok: false, value: cur.value }
    if (await store.cas(key, cur.rev, out.next)) return { ok: true, value: out.next, result: out.result }
  }
  throw new Error('store_contention')
}

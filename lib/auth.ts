/** Session admission tokens (HMAC-sealed) and admin-token checks. Server-side only. */
import { cfg } from './config'
import { seal, unseal } from './crypto'

interface TokenBody { sid: string; exp: number }

const g = globalThis as unknown as { __vkEphemeralSecret?: string }

/** Without SESSION_SECRET we fall back to a random per-process secret: sessions then only survive on one warm instance. */
export function sessionSecret(): { secret: string; configured: boolean } {
  const s = cfg().sessionSecret
  if (s && s.length >= 16) return { secret: s, configured: true }
  if (!g.__vkEphemeralSecret) {
    const b = crypto.getRandomValues(new Uint8Array(32))
    g.__vkEphemeralSecret = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  }
  return { secret: g.__vkEphemeralSecret, configured: false }
}

export async function issueToken(sid: string, expEpochSec: number): Promise<string> {
  return seal({ sid, exp: expEpochSec } satisfies TokenBody, sessionSecret().secret)
}

export async function verifyToken(token: string | null | undefined, nowMs = Date.now()): Promise<string | null> {
  if (!token) return null
  const b = await unseal<TokenBody>(token, sessionSecret().secret)
  if (!b || typeof b.sid !== 'string' || typeof b.exp !== 'number') return null
  if (b.exp * 1000 < nowMs) return null
  return b.sid
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  let d = ea.length ^ eb.length
  const n = Math.max(ea.length, eb.length)
  for (let i = 0; i < n; i++) d |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return d === 0
}

export function adminOk(req: Request): boolean {
  const want = cfg().adminToken
  if (!want || want.length < 16) return false
  const got = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  return safeEqual(got, want)
}

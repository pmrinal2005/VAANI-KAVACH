import canonicalize from 'canonicalize'
import * as ed from '@noble/ed25519'

const enc = new TextEncoder()
const dec = new TextDecoder()

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}
export function fromHex(h: string): Uint8Array {
  const clean = h.trim()
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2) throw new Error('bad hex')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}
export function b64uEncode(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function b64uDecode(s: string): Uint8Array {
  const p = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(p)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data
  const buf = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return toHex(new Uint8Array(buf))
}

/** RFC 8785 canonical JSON. */
export function canon(value: unknown): string {
  const c = canonicalize(value as object)
  if (c === undefined) throw new Error('not canonicalizable')
  return c
}

export async function digestOf(value: unknown): Promise<string> {
  return sha256Hex(canon(value))
}

/* ---------- HMAC sealing of session state ---------- */

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function seal(obj: unknown, secret: string): Promise<string> {
  const body = b64uEncode(enc.encode(JSON.stringify(obj)))
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)))
  return `${body}.${b64uEncode(sig)}`
}

export async function unseal<T>(token: string, secret: string): Promise<T | null> {
  const i = token.lastIndexOf('.')
  if (i < 1) return null
  const body = token.slice(0, i)
  let sig: Uint8Array
  try {
    sig = b64uDecode(token.slice(i + 1))
  } catch {
    return null
  }
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sig as BufferSource, enc.encode(body))
  if (!ok) return null
  try {
    return JSON.parse(dec.decode(b64uDecode(body))) as T
  } catch {
    return null
  }
}

/* ---------- AES-GCM for voice artifacts (server only) ---------- */

async function aesKey(hex: string): Promise<CryptoKey> {
  const raw = fromHex(hex)
  if (raw.length !== 32) throw new Error('VOICE_ENC_KEY must be 32 bytes (64 hex chars)')
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function encryptJson(obj: unknown, keyHex: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyHex), enc.encode(JSON.stringify(obj))))
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return b64uEncode(out)
}
export async function decryptJson<T>(blob: string, keyHex: string): Promise<T> {
  const raw = b64uDecode(blob)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) as BufferSource }, await aesKey(keyHex), raw.slice(12) as BufferSource)
  return JSON.parse(dec.decode(pt)) as T
}

/* ---------- Ed25519 record signing ---------- */

export interface SigningKey {
  secret: Uint8Array
  publicHex: string
  keyId: string
  dev: boolean
}

export async function loadSigningKey(seedHex: string, fallbackSecret: string): Promise<SigningKey> {
  let dev = false
  let seed: Uint8Array
  if (seedHex) {
    seed = fromHex(seedHex)
    if (seed.length !== 32) throw new Error('SIGNING_KEY_HEX must be 32 bytes (64 hex chars)')
  } else {
    dev = true
    seed = fromHex(await sha256Hex(`vaani-kavach-dev-signing:${fallbackSecret || 'dev'}`))
  }
  const pub = await ed.getPublicKeyAsync(seed)
  const publicHex = toHex(pub)
  return { secret: seed, publicHex, keyId: (await sha256Hex(publicHex)).slice(0, 12), dev }
}

export async function signCanonical(canonicalText: string, key: SigningKey): Promise<string> {
  return toHex(await ed.signAsync(enc.encode(canonicalText), key.secret))
}

export async function verifyCanonical(canonicalText: string, sigHex: string, publicHex: string): Promise<boolean> {
  try {
    return await ed.verifyAsync(fromHex(sigHex), enc.encode(canonicalText), fromHex(publicHex))
  } catch {
    return false
  }
}

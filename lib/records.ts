/** Confirmed-record content digest, signing and verification. Pure functions + key loading. */
import type { Draft, RecordPayload, SignedRecord } from './types'
import { cfg } from './config'
import { canon, digestOf, loadSigningKey, sha256Hex, signCanonical, type SigningKey } from './crypto'
import { contentOf } from './verify'

export { contentOf, verifySigned, VERIFY_LIMITATIONS, type VerifyResult, type VerifyReason } from './verify'

export const contentDigest = (workflow: string, schemaVersion: string, fields: Draft['fields']) => digestOf(contentOf(workflow, schemaVersion, fields))

export async function recordIdFor(sid: string, version: number, digest: string): Promise<string> {
  return `rec_${(await sha256Hex(`${sid}:${version}:${digest}`)).slice(0, 24)}`
}

const g = globalThis as unknown as { __vkKey?: { sig: string; key: SigningKey } }

export async function signingKey(): Promise<SigningKey> {
  const c = cfg()
  const sig = `${c.signingKeyHex}|${c.sessionSecret}`
  if (g.__vkKey?.sig === sig) return g.__vkKey.key
  const key = await loadSigningKey(c.signingKeyHex, c.sessionSecret)
  g.__vkKey = { sig, key }
  return key
}

export async function publicKeyInfo() {
  const k = await signingKey()
  return { key_id: k.keyId, public_key_hex: k.publicHex, alg: 'Ed25519' as const, dev: k.dev }
}

export async function signPayload(payload: RecordPayload): Promise<SignedRecord> {
  const key = await signingKey()
  const text = canon(payload)
  return {
    payload,
    digest: await sha256Hex(text),
    signature: await signCanonical(text, key),
    key_id: key.keyId,
    alg: 'Ed25519',
    ...(key.dev ? { signing_note: 'Signed with a development key derived from a local secret. Not a production trust anchor.' } : {}),
  }
}


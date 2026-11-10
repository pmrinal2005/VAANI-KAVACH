/**
 * Pure, browser-safe record verification (no config, no env, no Node APIs).
 * The same code runs on the server (/api/verify) and in the browser (offline verification of an exported payload).
 */
import type { FieldValue, RecordPayload, SignedRecord } from './types'
import { canon, digestOf, sha256Hex, verifyCanonical } from './crypto'

/** The approved content that the digest covers: workflow + schema + field VALUES only (no evidence, no audio, no timestamps). */
export function contentOf(workflow: string, schemaVersion: string, fields: Record<string, { value: FieldValue }> | Record<string, FieldValue>) {
  const vals: Record<string, FieldValue> = {}
  for (const [k, v] of Object.entries(fields)) {
    const val = v !== null && typeof v === 'object' && !Array.isArray(v) && 'value' in (v as object) ? (v as { value: FieldValue }).value : (v as FieldValue)
    vals[k] = val ?? null
  }
  return { workflow, schema_version: schemaVersion, fields: vals }
}

export type VerifyReason = 'ok' | 'malformed' | 'digest_mismatch' | 'content_digest_mismatch' | 'bad_signature' | 'unknown_key'
export interface VerifyResult {
  valid: boolean
  reason: VerifyReason
  key_id: string | null
  /** Always shown with the result. Verification never claims truth, bilateral agreement or legal authority. */
  limitations: string[]
}

export const VERIFY_LIMITATIONS = [
  'A valid signature means this content is unchanged since the application signed it.',
  'It does not prove the statements are true, that a named person spoke, that another party agreed, or that anything is legally enforceable.',
  'Offline verification cannot learn about later key revocation.',
]

/** Verify against a set of known public keys (key_id -> public hex). Works in browser and server. */
export async function verifySigned(signed: unknown, knownKeys: Record<string, string>): Promise<VerifyResult> {
  const fail = (reason: VerifyReason, key_id: string | null = null): VerifyResult => ({ valid: false, reason, key_id, limitations: VERIFY_LIMITATIONS })
  const s = signed as Partial<SignedRecord> | null
  if (!s || typeof s !== 'object' || !s.payload || typeof s.signature !== 'string' || typeof s.digest !== 'string' || typeof s.key_id !== 'string') return fail('malformed')
  const pub = knownKeys[s.key_id]
  if (!pub) return fail('unknown_key', s.key_id)
  let text: string
  try {
    text = canon(s.payload)
  } catch {
    return fail('malformed', s.key_id)
  }
  if ((await sha256Hex(text)) !== s.digest) return fail('digest_mismatch', s.key_id)
  if (!(await verifyCanonical(text, s.signature, pub))) return fail('bad_signature', s.key_id)
  const p = s.payload as RecordPayload
  const recomputed = await digestOf(contentOf(p.workflow, p.schema_version, p.fields))
  if (recomputed !== p.content_digest) return fail('content_digest_mismatch', s.key_id)
  return { valid: true, reason: 'ok', key_id: s.key_id, limitations: VERIFY_LIMITATIONS }
}

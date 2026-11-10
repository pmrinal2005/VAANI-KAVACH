/**
 * Consent-gated approved voice. The speaker embedding exists only encrypted at rest (AES-GCM, VOICE_ENC_KEY) in an env var,
 * is decrypted server-side per request and is never sent to the browser or logged.
 * Synthesis is allowed only for the narration of an already-committed record, built here from the stored record
 * (the caller cannot supply text), and always carries a synthetic-voice disclosure.
 */
import { cfg } from './config'
import { decryptJson, encryptJson } from './crypto'
import type { SpeakerEmbedding } from './gnani'
import type { Store } from './store'
import { getStore } from './store'

const CONSENT_KEY = 'voice:consent'
export interface ConsentDoc { revoked: boolean; at: string; purpose: string }

export async function consentState(store: Store = getStore()): Promise<{ active: boolean; reason: string | null }> {
  const c = cfg()
  if (!c.cloneEnabled) return { active: false, reason: 'Approved-voice playback is switched off.' }
  if (c.voiceConsentEnv !== 'active') return { active: false, reason: 'No consenting voice is enrolled for this deployment.' }
  if (!c.voiceEmbeddingEnc || !c.voiceEncKeyHex) return { active: false, reason: 'Voice artifact is not configured.' }
  const d = (await store.get<ConsentDoc>(CONSENT_KEY))?.value
  if (d?.revoked) return { active: false, reason: 'Consent for this voice was revoked.' }
  return { active: true, reason: null }
}

export async function loadEmbedding(store: Store = getStore()): Promise<{ ok: true; embedding: SpeakerEmbedding } | { ok: false; reason: string }> {
  const st = await consentState(store)
  if (!st.active) return { ok: false, reason: st.reason ?? 'unavailable' }
  const c = cfg()
  try {
    const e = await decryptJson<SpeakerEmbedding>(c.voiceEmbeddingEnc, c.voiceEncKeyHex)
    if (!e || typeof e.embedding !== 'string' || !Array.isArray(e.shape) || typeof e.dtype !== 'string') return { ok: false, reason: 'Voice artifact is invalid.' }
    return { ok: true, embedding: e }
  } catch {
    return { ok: false, reason: 'Voice artifact could not be decrypted.' }
  }
}

export async function sealEmbedding(e: SpeakerEmbedding): Promise<string> {
  return encryptJson(e, cfg().voiceEncKeyHex)
}

export async function recordConsent(store: Store, purpose: string): Promise<void> {
  const doc: ConsentDoc = { revoked: false, at: new Date().toISOString(), purpose: purpose.slice(0, 200) }
  for (let i = 0; i < 5; i++) {
    const cur = await store.get<ConsentDoc>(CONSENT_KEY)
    if (!cur) {
      if (await store.putIfAbsent(CONSENT_KEY, doc)) return
      continue
    }
    if (await store.cas(CONSENT_KEY, cur.rev, doc)) return
  }
  throw new Error('consent_contention')
}

/** Revocation blocks every NEW synthesis immediately at admission. Audio already downloaded cannot be recalled. */
export async function revokeConsent(store: Store): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const cur = await store.get<ConsentDoc>(CONSENT_KEY)
    const doc: ConsentDoc = { revoked: true, at: new Date().toISOString(), purpose: cur?.value.purpose ?? 'revoked' }
    if (!cur) {
      if (await store.putIfAbsent(CONSENT_KEY, doc)) return
      continue
    }
    if (await store.cas(CONSENT_KEY, cur.rev, doc)) return
  }
  throw new Error('consent_contention')
}

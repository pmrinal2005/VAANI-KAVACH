export type WorkflowId = 'money_order' | 'service_request' | 'handover' | 'risk_review'
export type Lang = 'hinglish' | 'en' | 'ta' | 'bn'
export type Basis = 'stated' | 'derived' | 'not_stated' | 'user_edited' | 'assumed'
export type FieldValue = string | number | string[] | null
export type Severity = 'block' | 'warn' | 'info'

export interface Field {
  key: string
  label: string
  value: FieldValue
  display: string
  basis: Basis
  /** Exact substring of the source transcript that supports the value (null for derived/not stated). */
  evidence: string | null
  critical: boolean
}

export interface Issue {
  code: string
  severity: Severity
  field?: string
  message: string
  question?: string
}

export type ExtractorKind = 'rules' | 'llm+rules'

export interface Draft {
  sessionId: string
  version: number
  workflow: WorkflowId
  schemaVersion: string
  lang: Lang
  fields: Record<string, Field>
  /** Stated/edited inputs the fields were derived from. Corrections modify this, then fields are recomputed. */
  base: Base
  /** Extraction-time issues (ambiguity warnings) carried across corrections until the related field is edited. */
  carried: Issue[]
  issues: Issue[]
  status: 'needs_clarification' | 'ready'
  /** false for read-only workflows (risk review). */
  committable: boolean
  /** needs a deliberate second confirmation (money fields). */
  requiresCriticalAck: boolean
  /** sha256 over the canonical approved content (fields only). Identical across audio renditions. */
  digest: string
  transcripts: string[]
  extractor: ExtractorKind
  createdAt: string
}

export type SessionState =
  | 'idle'
  | 'clarifying'
  | 'ready_for_readback'
  | 'awaiting_confirmation'
  | 'committed'
  | 'cancelled'
  | 'expired'

export interface Utterance {
  id: string
  text: string
  source: 'stt' | 'typed'
  at: string
  sttModel?: string
  detectedLanguage?: string
  audioMs?: number
}

export interface Session {
  id: string
  workflow: WorkflowId
  lang: Lang
  tz: string
  /** live = provider calls admitted; text = engine only, no paid providers. */
  mode: 'live' | 'text'
  modeReason?: string
  state: SessionState
  turns: number
  createdAt: string
  expiresAt: string
  currentVersion: number
  readback: { version: number; digest: string; at: string } | null
  committedRecordId: string | null
  committedKey: string | null
  utterances: Utterance[]
  cloneUsed: boolean
  liveSlot: boolean
  extractor: ExtractorKind
}

export interface RecordPayload {
  id: string
  schema: 'vaani-kavach/record/v1'
  workflow: WorkflowId
  schema_version: string
  fields: Record<string, FieldValue>
  field_display: Record<string, string>
  source_utterance_ids: string[]
  draft_version: number
  content_digest: string
  confirmation: { method: 'on_screen'; at: string; critical_ack: boolean }
  author_confirmed: true
  recipient_acknowledgement: null
  timezone: string
  created_at: string
}

export interface SignedRecord {
  payload: RecordPayload
  digest: string
  signature: string
  key_id: string
  alg: 'Ed25519'
  signing_note?: string
}

export interface TraceEntry {
  stage: string
  ms: number
  note?: string
}

export interface BaseEntry {
  value: FieldValue
  evidence: string | null
  basis: Basis
}
export type Base = Record<string, BaseEntry>

export interface Ctx {
  tz: string
  now: Date
  lang: Lang
}

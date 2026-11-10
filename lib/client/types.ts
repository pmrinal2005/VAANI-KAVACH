import type { draftView, sessionView } from '@/lib/engine'
import type { SignedRecord } from '@/lib/types'
export type SessionView = ReturnType<typeof sessionView>
export type DraftView = NonNullable<ReturnType<typeof draftView>>
export type { SignedRecord }
export interface ReadyInfo {
  ok: boolean
  storage: { kind: string; durable: boolean; ok: boolean }
  live: { available: boolean; reason: string | null; sttModel: string; ttsModel: string }
  clone: { available: boolean; reason: string | null }
  budget: { pool: string; remaining: number; cap: number; tariffCalibrated: boolean; slotBusy: boolean } | null
  limits: { sessionSeconds: number; maxTurns: number; maxAudioSeconds: number }
}

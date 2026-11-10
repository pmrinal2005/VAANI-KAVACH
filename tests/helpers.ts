import { MemoryStore, setStoreForTests } from '@/lib/store'
import { createSession, submitUtterance, startReadback, confirm, getDraft, getSession, isErr } from '@/lib/engine'
import type { Lang, WorkflowId } from '@/lib/types'

export const NOW = new Date('2026-11-10T08:00:00Z') // Tue 10 Nov 2026, 13:30 IST
export function freshStore() {
  const s = new MemoryStore()
  setStoreForTests(s)
  return s
}
export async function start(store: MemoryStore, workflow: WorkflowId = 'money_order', lang: Lang = 'hinglish') {
  const r = await createSession(store, { workflow, lang, mode: 'text', now: NOW })
  if (isErr(r)) throw new Error(r.message)
  return r.session.id
}
export async function say(store: MemoryStore, sid: string, text: string, source: 'typed' | 'stt' = 'typed') {
  const r = await submitUtterance(store, sid, { text, source }, NOW)
  if (isErr(r)) throw new Error(`${r.code}: ${r.message}`)
  return r
}
export async function draftOf(store: MemoryStore, sid: string) {
  const s = (await getSession(store, sid, NOW))!
  return { s, d: (await getDraft(store, s))! }
}
export async function readbackAndConfirm(store: MemoryStore, sid: string, ack = true) {
  const rb = await startReadback(store, sid, NOW)
  if (isErr(rb)) throw new Error(`${rb.code}: ${rb.message}`)
  return confirm(store, sid, { version: rb.draft.version, digest: rb.draft.digest, criticalAck: ack }, NOW)
}
export const ORDER = 'Ravi ke liye do cement bags, four-twenty per bag. Advance two hundred mila hai, baaki pending. Delivery kal afternoon.'

/**
 * Generates public/replay.json: a PRERECORDED run of the real engine on synthetic data with a fixed clock.
 * It is labelled "Prerecorded example" in the UI and signed with a development key (its public key ships in the file).
 * Run: npm run gen:replay
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { MemoryStore } from '../lib/store'
import { confirm, createSession, draftView, getDraft, isErr, startReadback, submitUtterance } from '../lib/engine'
import { publicKeyInfo } from '../lib/records'

const NOW = new Date('2026-11-10T08:00:00Z')
const SAY = [
  'Ravi ke liye do cement bags, four-twenty per bag. Advance two hundred mila hai, baaki pending. Delivery kal afternoon.',
  'four-twenty nahi four-fifty',
]

async function main() {
  const store = new MemoryStore()
  const made = await createSession(store, { workflow: 'money_order', lang: 'hinglish', mode: 'text', now: NOW })
  if (isErr(made)) throw new Error(made.message)
  const sid = made.session.id
  const steps: Array<{ say: string; notice: string | null; draft: unknown }> = []
  for (const text of SAY) {
    const r = await submitUtterance(store, sid, { text, source: 'typed' }, NOW)
    if (isErr(r)) throw new Error(`${r.code}: ${r.message}`)
    steps.push({ say: text, notice: r.notice, draft: draftView(r.session, await getDraft(store, r.session)) })
  }
  const rb = await startReadback(store, sid, NOW)
  if (isErr(rb)) throw new Error(rb.message)
  const done = await confirm(store, sid, { version: rb.draft.version, digest: rb.draft.digest, criticalAck: true }, NOW)
  if (isErr(done)) throw new Error(done.message)
  const k = await publicKeyInfo()
  const out = {
    note: 'This is a recording of the real checking engine run on synthetic data (fictitious person, no real call). It is not a live session and no speech service was used.',
    generatedAt: NOW.toISOString(),
    workflow: 'money_order',
    steps,
    readback: { lines: rb.readback.lines, checks: rb.checks },
    record: done.record,
    keys: { [k.key_id]: k.public_key_hex },
  }
  mkdirSync('public', { recursive: true })
  writeFileSync('public/replay.json', JSON.stringify(out, null, 2) + '\n')
  console.log(`replay.json written: ${steps.length} steps, record ${done.record.payload.id}, unit price now ${(done.record.payload.fields.unit_price as number) / 100}, total ${(done.record.payload.fields.total as number) / 100}`)
}
main().catch((e) => { console.error(e); process.exit(1) })

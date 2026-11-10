/**
 * The shared workflow engine. Live voice, recorded-turn and typed input ALL go through these functions.
 *
 * Invariants (enforced here, covered by tests/engine.test.ts):
 *  1. Only the server commits a durable record (no model / voice / client can write one).
 *  2. Every correction creates a NEW immutable draft version.
 *  3. A readback references one specific version + content digest.
 *  4. Confirmation must quote that same version and digest; stale confirmations are rejected.
 *  5. Cancelled / expired sessions cannot commit.
 *  6. Repeated confirmation returns the existing record (idempotent, race-safe via compare-and-set).
 *  7. A bare "haan"/"yes" never commits anything; only the explicit confirm call does.
 */
import type { Base, Ctx, Draft, Field, Issue, Lang, RecordPayload, Session, SignedRecord, Utterance, WorkflowId } from './types'
import { cfg } from './config'
import { type Store } from './store'
import { extractBase, computeFields } from './extract'
import { applyCorrection, OVERRIDE_RE } from './correct'
import { buildReadback, buildQuestion, checkLines, type Readback } from './readback'
import { WORKFLOW_META } from './labels'
import { contentDigest, recordIdFor, signPayload } from './records'
import { CANCEL_PHRASES, CONFIRM_LIKE, ADVANCE_WORDS, FULL_WORDS, NEGATION_WORDS } from './nlp/lexicon'
import { parseItems } from './nlp/tokens'

export const WORKFLOWS = Object.keys(WORKFLOW_META) as WorkflowId[]
export const LANGS: Lang[] = ['hinglish', 'en', 'ta', 'bn']

export interface EngineError { ok: false; code: string; message: string; status: number }
const err = (code: string, message: string, status = 400): EngineError => ({ ok: false, code, message, status })
export const isErr = (x: unknown): x is EngineError => !!x && typeof x === 'object' && (x as { ok?: boolean }).ok === false && 'code' in (x as object)

const sessKey = (sid: string) => `sess:${sid}`
const recKey = (id: string) => `rec:${id}`

export function newSessionId(): string {
  return `s_${crypto.randomUUID().replace(/-/g, '')}`
}

export function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* session storage helpers                                              */
/* ------------------------------------------------------------------ */

export async function createSession(
  store: Store,
  o: { workflow: WorkflowId; lang: Lang; tz?: string; mode: 'live' | 'text'; modeReason?: string; liveSlot?: boolean; now?: Date },
): Promise<Result<{ session: Session }>> {
  if (!WORKFLOWS.includes(o.workflow)) return err('bad_workflow', 'Unknown workflow.')
  if (!LANGS.includes(o.lang)) return err('bad_lang', 'Unsupported language.')
  const now = o.now ?? new Date()
  const tz = o.tz && isValidTz(o.tz) ? o.tz : 'Asia/Kolkata'
  const c = cfg()
  const session: Session = {
    id: newSessionId(),
    workflow: o.workflow,
    lang: o.lang,
    tz,
    mode: o.mode,
    ...(o.modeReason ? { modeReason: o.modeReason } : {}),
    state: 'idle',
    turns: 0,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + c.sessionMaxSeconds * 1000).toISOString(),
    versions: [],
    committedAt: null,
    currentVersion: 0,
    readback: null,
    committedRecordId: null,
    committedKey: null,
    utterances: [],
    cloneUsed: false,
    ttsCalls: 0,
    liveSlot: !!o.liveSlot,
    extractor: 'rules',
  }
  if (!(await store.putIfAbsent(sessKey(session.id), session))) return err('session_conflict', 'Could not create session.', 500)
  return { ok: true, session }
}

export type Result<T> = ({ ok: true } & T) | EngineError

const CLOSED = new Set(['committed', 'cancelled', 'expired'])

export async function getSession(store: Store, sid: string, now = new Date()): Promise<Session | null> {
  const cur = await store.get<Session>(sessKey(sid))
  if (!cur) return null
  const s = cur.value
  if (!CLOSED.has(s.state) && now.getTime() > Date.parse(s.expiresAt)) {
    s.state = 'expired'
    await store.cas(sessKey(sid), cur.rev, s) // best effort; a lost race means someone else just wrote
  }
  return s
}

export async function getDraft(store: Store, s: Session): Promise<Draft | null> {
  const last = s.versions[s.versions.length - 1]
  if (!last) return null
  return (await store.get<Draft>(last.key))?.value ?? null
}

/** Bounded compare-and-set loop on the session document. `fn` may write immutable draft documents but nothing else. */
async function mutate<T>(
  store: Store,
  sid: string,
  now: Date,
  fn: (s: Session) => Promise<{ next: Session; out: T } | EngineError>,
): Promise<Result<{ session: Session; out: T }>> {
  for (let i = 0; i < 6; i++) {
    const cur = await store.get<Session>(sessKey(sid))
    if (!cur) return err('not_found', 'Session not found.', 404)
    const s = cur.value
    if (!CLOSED.has(s.state) && now.getTime() > Date.parse(s.expiresAt)) {
      s.state = 'expired'
      await store.cas(sessKey(sid), cur.rev, s)
      return err('session_expired', 'This session has expired. Start a new one.', 410)
    }
    const r = await fn(structuredClone(s))
    if (isErr(r)) return r
    if (await store.cas(sessKey(sid), cur.rev, r.next)) return { ok: true, session: r.next, out: r.out }
  }
  return err('contention', 'Please retry.', 409)
}

/* ------------------------------------------------------------------ */
/* extraction merge                                                     */
/* ------------------------------------------------------------------ */

const DISPLAY_OF: Record<string, string> = {
  unit_price_paise: 'unit_price', advance_paise: 'advance_received', received_unclassified_paise: 'advance_received',
  total_stated_paise: 'total', outstanding_stated_paise: 'outstanding', paid_in_full: 'payment_status', pending_mentioned: 'payment_status',
}
const WHEN_KEYS = new Set(['delivery', 'requested_window', 'due'])
const LIST_KEYS = new Set(['completed', 'pending', 'resources', 'constraints'])
const dispOf = (k: string) => DISPLAY_OF[k] ?? k

function splitWhen(v: string): { date?: string; time?: string } {
  const out: { date?: string; time?: string } = {}
  for (const t of v.split(' ')) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) out.date = t
    else if (/^\d{2}:00(-\d{2}:00)?$/.test(t) || /^(morning|afternoon|evening|night)$/.test(t)) out.time = t
  }
  return out
}

function mergeBase(old: Base, fresh: Base, override: boolean): { base: Base; notes: Issue[] } {
  const base: Base = { ...old }
  const notes: Issue[] = []
  for (const [k, e] of Object.entries(fresh)) {
    if (e.value === null || e.value === undefined) continue
    const cur = base[k]
    if (!cur || cur.value === null || cur.value === undefined) {
      base[k] = e
      continue
    }
    if (JSON.stringify(cur.value) === JSON.stringify(e.value)) continue
    if (LIST_KEYS.has(k) && Array.isArray(cur.value) && Array.isArray(e.value)) {
      const u = [...(cur.value as string[])]
      for (const x of e.value as string[]) if (!u.includes(x)) u.push(x)
      base[k] = { value: u, evidence: u.join('; '), basis: cur.basis }
      continue
    }
    if (WHEN_KEYS.has(k) && typeof cur.value === 'string' && typeof e.value === 'string') {
      const a = splitWhen(cur.value)
      const b = splitWhen(e.value)
      const useNew = override
      const date = (useNew ? b.date ?? a.date : a.date ?? b.date)
      const time = (useNew ? b.time ?? a.time : a.time ?? b.time)
      const merged = [date, time].filter(Boolean).join(' ')
      if (merged && merged !== cur.value) {
        base[k] = { value: merged, evidence: [cur.evidence, e.evidence].filter(Boolean).join(' + '), basis: useNew ? 'user_edited' : cur.basis }
      }
      continue
    }
    if (override) {
      base[k] = { value: e.value, evidence: e.evidence, basis: 'user_edited' }
    } else {
      notes.push({
        code: 'conflicting_value',
        severity: 'info',
        field: dispOf(k),
        message: `A different ${dispOf(k).replace(/_/g, ' ')} was heard later; the earlier value was kept. Say "actually ..." or edit the field to replace it.`,
      })
    }
  }
  return { base, notes }
}

/** If the user answers "advance" / "full payment" to the payment-kind question, resolve it. */
function resolvePaymentKind(base: Base, text: string): Base {
  const un = base.received_unclassified_paise
  if (!un || base.advance_paise) return base
  const words = parseItems(text).filter((i) => i.kind === 'word') as Array<{ norm: string }>
  const adv = words.some((w) => ADVANCE_WORDS.has(w.norm))
  const full = words.some((w) => FULL_WORDS.has(w.norm))
  const neg = words.some((w) => NEGATION_WORDS.has(w.norm))
  if (neg || adv === full) return base // ambiguous answer: ask again rather than guess
  const next: Base = { ...base }
  delete next.received_unclassified_paise
  if (adv) next.advance_paise = { value: un.value, evidence: `${un.evidence ?? ''} + "${text.trim().slice(0, 40)}"`, basis: 'user_edited' }
  else next.paid_in_full = { value: 'yes', evidence: `"${text.trim().slice(0, 40)}"`, basis: 'user_edited' }
  return next
}

function dedupe(list: Issue[]): Issue[] {
  const seen = new Set<string>()
  return list.filter((i) => {
    const k = `${i.code}|${i.field ?? ''}|${i.message}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function pruneCarried(carried: Issue[], changed: string[], base: Base): Issue[] {
  const ch = new Set(changed)
  const del = typeof base.delivery?.value === 'string' ? splitWhen(base.delivery.value as string) : {}
  const win = typeof base.requested_window?.value === 'string' ? splitWhen(base.requested_window.value as string) : {}
  const due = typeof base.due?.value === 'string' ? splitWhen(base.due.value as string) : {}
  return carried.filter((i) => {
    if (i.field && ch.has(i.field) && i.code !== 'conflicting_value') return false
    if (i.field && ch.has(i.field) && i.code === 'conflicting_value') return false
    if (i.code === 'price_unit_mismatch' && ch.has('unit')) return false
    if (i.code === 'advance_amount_missing' && (base.advance_paise || base.received_unclassified_paise)) return false
    if (i.code === 'when_date_missing' && ((i.field === 'delivery' && del.date) || (i.field === 'requested_window' && win.date) || (i.field === 'due' && due.date))) return false
    return true
  })
}

/* ------------------------------------------------------------------ */
/* utterances                                                           */
/* ------------------------------------------------------------------ */

export function cleanText(raw: string): string {
  return raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
}

export interface UtteranceInput { text: string; source: 'stt' | 'typed'; sttModel?: string; detectedLanguage?: string; audioMs?: number }
export interface UtteranceOut { notice: string | null; created: boolean }

export async function submitUtterance(store: Store, sid: string, input: UtteranceInput, now = new Date()): Promise<Result<{ session: Session; draft: Draft | null; notice: string | null; created: boolean }>> {
  const c = cfg()
  const text = cleanText(input.text ?? '')
  if (!text) return err('empty_text', 'Nothing was heard or typed.')
  if (text.length > c.maxTextChars) return err('text_too_long', `Please keep each message under ${c.maxTextChars} characters.`)

  const r = await mutate<UtteranceOut & { draft: Draft | null }>(store, sid, now, async (s) => {
    if (CLOSED.has(s.state)) return err('session_closed', `This session is ${s.state}.`, 409)
    if (s.utterances.length >= c.maxUtterances) return err('utterance_limit', 'Message limit reached for this session.', 429)
    if (input.source === 'stt' && s.turns >= c.maxTurns) return err('turn_limit', `Spoken-turn limit (${c.maxTurns}) reached for this session. You can still type.`, 429)

    const last = await getDraft(store, s)
    const wc = text.split(/\s+/).length

    // explicit cancellation (short utterances only, so "stop the leak" inside a sentence is not a cancel)
    if (wc <= 6 && CANCEL_PHRASES.some((p) => p.test(text))) {
      s.state = 'cancelled'
      s.readback = null
      return { next: s, out: { notice: 'Cancelled. Nothing was recorded.', created: false, draft: last } }
    }
    // a bare "haan / yes / theek hai" is never an authorization
    if (last && CONFIRM_LIKE.test(text)) {
      return { next: s, out: { notice: 'Spoken "yes" cannot confirm a record. Use the Confirm button after the readback.', created: false, draft: last } }
    }

    const ctx: Ctx = { tz: s.tz, now, lang: s.lang }
    let base: Base
    let carried: Issue[]
    let notice: string | null = null

    if (!last || s.workflow === 'risk_review') {
      const ex = extractBase(s.workflow, text, ctx)
      base = ex.base
      carried = ex.issues
    } else {
      const corr = applyCorrection(last.base, text, ctx)
      if (corr.handled) {
        if (!corr.base || corr.changed.length === 0) {
          return { next: s, out: { notice: corr.notice ?? 'No change was made.', created: false, draft: last } }
        }
        base = corr.base
        carried = pruneCarried(last.carried, corr.changed, base)
        notice = `Changed: ${corr.changed.map((x) => x.replace(/_/g, ' ')).join(', ')}.`
      } else {
        const ex = extractBase(s.workflow, text, ctx)
        const resolved = resolvePaymentKind(last.base, text)
        const m = mergeBase(resolved, ex.base, OVERRIDE_RE.test(text))
        base = m.base
        carried = pruneCarried(dedupe([...last.carried, ...ex.issues, ...m.notes]), [], base)
      }
    }

    const meta = WORKFLOW_META[s.workflow]
    const { fields, issues } = computeFields(s.workflow, base, ctx, carried)
    const version = (last?.version ?? 0) + 1
    const digest = await contentDigest(s.workflow, meta.schema, fields)
    const status: Draft['status'] = issues.some((i) => i.severity === 'block') ? 'needs_clarification' : 'ready'
    const utt: Utterance = {
      id: `u_${s.utterances.length + 1}`,
      text,
      source: input.source,
      at: now.toISOString(),
      ...(input.sttModel ? { sttModel: input.sttModel } : {}),
      ...(input.detectedLanguage ? { detectedLanguage: input.detectedLanguage } : {}),
      ...(input.audioMs ? { audioMs: Math.round(input.audioMs) } : {}),
    }
    const draft: Draft = {
      sessionId: s.id,
      version,
      workflow: s.workflow,
      schemaVersion: meta.schema,
      lang: s.lang,
      fields,
      base,
      carried,
      issues,
      status,
      committable: meta.committable,
      requiresCriticalAck: s.workflow === 'money_order',
      digest,
      transcripts: [...(last?.transcripts ?? []), text],
      extractor: 'rules',
      createdAt: now.toISOString(),
    }
    const key = `draft:${s.id}:${version}:${crypto.randomUUID().slice(0, 8)}`
    if (!(await store.putIfAbsent(key, draft))) return err('draft_conflict', 'Please retry.', 409)
    s.versions.push({ version, digest, at: now.toISOString(), key })
    s.currentVersion = version
    s.utterances.push(utt)
    if (input.source === 'stt') s.turns += 1
    s.readback = null // any new version invalidates the previous readback
    s.state = status === 'ready' ? 'ready_for_readback' : 'clarifying'
    return { next: s, out: { notice, created: true, draft } }
  })
  if (isErr(r)) return r
  return { ok: true, session: r.session, draft: r.out.draft, notice: r.out.notice, created: r.out.created }
}

/* ------------------------------------------------------------------ */
/* direct field edit (typed correction)                                 */
/* ------------------------------------------------------------------ */

const EDIT_MAP: Record<string, { baseKey: string; kind: 'text' | 'qty' | 'rupees' | 'unit' | 'when' | 'list'; workflows: WorkflowId[] }> = {
  party: { baseKey: 'party', kind: 'text', workflows: ['money_order'] },
  item: { baseKey: 'item', kind: 'text', workflows: ['money_order'] },
  quantity: { baseKey: 'quantity', kind: 'qty', workflows: ['money_order'] },
  unit: { baseKey: 'unit', kind: 'unit', workflows: ['money_order'] },
  unit_price: { baseKey: 'unit_price_paise', kind: 'rupees', workflows: ['money_order'] },
  advance_received: { baseKey: 'advance_paise', kind: 'rupees', workflows: ['money_order'] },
  delivery: { baseKey: 'delivery', kind: 'when', workflows: ['money_order'] },
  problem: { baseKey: 'problem', kind: 'text', workflows: ['service_request'] },
  location: { baseKey: 'location', kind: 'text', workflows: ['service_request'] },
  recipient_role: { baseKey: 'recipient_role', kind: 'text', workflows: ['service_request', 'instruction'] },
  task: { baseKey: 'task', kind: 'text', workflows: ['instruction'] },
  due: { baseKey: 'due', kind: 'when', workflows: ['instruction'] },
  condition: { baseKey: 'condition', kind: 'text', workflows: ['service_request'] },
  requested_window: { baseKey: 'requested_window', kind: 'when', workflows: ['service_request'] },
  completed: { baseKey: 'completed', kind: 'list', workflows: ['handover'] },
  pending: { baseKey: 'pending', kind: 'list', workflows: ['handover'] },
  resources: { baseKey: 'resources', kind: 'list', workflows: ['handover'] },
  constraints: { baseKey: 'constraints', kind: 'list', workflows: ['handover', 'instruction'] },
  next_owner: { baseKey: 'next_owner', kind: 'text', workflows: ['handover'] },
}
export const EDITABLE_FIELDS = Object.keys(EDIT_MAP)

export async function editField(store: Store, sid: string, field: string, rawValue: string, now = new Date()): Promise<Result<{ session: Session; draft: Draft }>> {
  const spec = EDIT_MAP[field]
  if (!spec) return err('bad_field', 'That field cannot be edited.')
  const value = cleanText(String(rawValue ?? ''))
  if (value.length > 200) return err('value_too_long', 'Value is too long.')
  const { UNIT_LOOKUP } = await import('./nlp/lexicon')
  const { resolveWhen } = await import('./nlp/dates')
  const { rupeesToPaise } = await import('./money')

  const r = await mutate<{ draft: Draft }>(store, sid, now, async (s) => {
    if (CLOSED.has(s.state)) return err('session_closed', `This session is ${s.state}.`, 409)
    if (!spec.workflows.includes(s.workflow)) return err('bad_field', 'That field does not belong to this workflow.')
    const last = await getDraft(store, s)
    if (!last) return err('no_draft', 'Nothing to edit yet.', 409)
    const base: Base = { ...last.base }
    const ev = { evidence: value || null, basis: 'user_edited' as const }
    if (value === '') delete base[spec.baseKey]
    else if (spec.kind === 'text') base[spec.baseKey] = { value, ...ev }
    else if (spec.kind === 'list') base[spec.baseKey] = { value: value.split(/\s*;\s*/).filter(Boolean), ...ev }
    else if (spec.kind === 'qty' || spec.kind === 'rupees') {
      const n = Number(value.replace(/,/g, ''))
      if (!Number.isFinite(n) || n < 0 || n > 1e9) return err('bad_number', 'Enter a valid number.')
      base[spec.baseKey] = { value: spec.kind === 'rupees' ? rupeesToPaise(n) : n, ...ev }
    } else if (spec.kind === 'unit') {
      const { normKey } = await import('./nlp/tokens')
      const u = UNIT_LOOKUP.get(normKey(value))
      if (!u) return err('bad_unit', 'Unit not recognised (bag, kg, piece, litre, ...).')
      base[spec.baseKey] = { value: u, ...ev }
    } else {
      const items = parseItems(value)
      const w = resolveWhen(value, items, { tz: s.tz, now, lang: s.lang }, field)
      if (!w.found || !w.value) return err('bad_when', 'Could not understand that day/time. Try "kal 10 baje" or "Saturday 10 to 12".')
      base[spec.baseKey] = { value: w.value, ...ev }
    }
    const carried = pruneCarried(last.carried, [field], base)
    const ctx: Ctx = { tz: s.tz, now, lang: s.lang }
    const { fields, issues } = computeFields(s.workflow, base, ctx, carried)
    const meta = WORKFLOW_META[s.workflow]
    const version = last.version + 1
    const digest = await contentDigest(s.workflow, meta.schema, fields)
    const draft: Draft = { ...last, version, fields, base, carried, issues, digest, status: issues.some((i) => i.severity === 'block') ? 'needs_clarification' : 'ready', createdAt: now.toISOString() }
    const key = `draft:${s.id}:${version}:${crypto.randomUUID().slice(0, 8)}`
    if (!(await store.putIfAbsent(key, draft))) return err('draft_conflict', 'Please retry.', 409)
    s.versions.push({ version, digest, at: now.toISOString(), key })
    s.currentVersion = version
    s.readback = null
    s.state = draft.status === 'ready' ? 'ready_for_readback' : 'clarifying'
    return { next: s, out: { draft } }
  })
  if (isErr(r)) return r
  return { ok: true, session: r.session, draft: r.out.draft }
}

/* ------------------------------------------------------------------ */
/* readback / confirm / cancel                                          */
/* ------------------------------------------------------------------ */

export async function startReadback(store: Store, sid: string, now = new Date()): Promise<Result<{ session: Session; draft: Draft; readback: Readback; checks: string[] }>> {
  const r = await mutate<{ draft: Draft }>(store, sid, now, async (s) => {
    if (CLOSED.has(s.state)) return err('session_closed', `This session is ${s.state}.`, 409)
    const d = await getDraft(store, s)
    if (!d) return err('no_draft', 'Nothing to read back yet.', 409)
    if (d.status !== 'ready') return err('not_ready', buildQuestion(d) ?? 'The draft still needs clarification.', 409)
    s.readback = { version: d.version, digest: d.digest, at: now.toISOString() }
    if (d.committable) s.state = 'awaiting_confirmation'
    return { next: s, out: { draft: d } }
  })
  if (isErr(r)) return r
  return { ok: true, session: r.session, draft: r.out.draft, readback: buildReadback(r.out.draft), checks: checkLines(r.out.draft) }
}

export interface ConfirmInput { version: number; digest: string; criticalAck?: boolean; idempotencyKey?: string }

async function buildSigned(session: Session, draft: Draft, committedAt: string, criticalAck: boolean): Promise<SignedRecord> {
  const id = await recordIdFor(session.id, draft.version, draft.digest)
  const values: Record<string, RecordPayload['fields'][string]> = {}
  const display: Record<string, string> = {}
  for (const [k, f] of Object.entries(draft.fields) as Array<[string, Field]>) {
    values[k] = f.value
    display[k] = f.display
  }
  const payload: RecordPayload = {
    id,
    schema: 'vaani-kavach/record/v1',
    workflow: draft.workflow,
    schema_version: draft.schemaVersion,
    fields: values,
    field_display: display,
    source_utterance_ids: session.utterances.map((u) => u.id),
    draft_version: draft.version,
    content_digest: draft.digest,
    confirmation: { method: 'on_screen', at: committedAt, critical_ack: criticalAck },
    author_confirmed: true,
    recipient_acknowledgement: null,
    timezone: session.tz,
    created_at: committedAt,
  }
  return signPayload(payload)
}

export async function confirm(store: Store, sid: string, input: ConfirmInput, now = new Date()): Promise<Result<{ session: Session; record: SignedRecord; duplicate: boolean }>> {
  if (!Number.isInteger(input?.version) || typeof input?.digest !== 'string' || !/^[0-9a-f]{64}$/.test(input.digest)) return err('bad_request', 'version and digest are required.')
  const idem = (input.idempotencyKey && String(input.idempotencyKey).slice(0, 80)) || `${sid}:${input.version}:${input.digest}`

  const r = await mutate<{ draft: Draft; duplicate: boolean; criticalAck: boolean }>(store, sid, now, async (s) => {
    const d = await getDraft(store, s)
    if (s.state === 'committed') {
      if (!d || input.version !== d.version || input.digest !== d.digest) return err('already_committed', 'This session already holds a confirmed record for a different version.', 409)
      return { next: s, out: { draft: d, duplicate: true, criticalAck: true } }
    }
    if (s.state === 'cancelled') return err('session_cancelled', 'This session was cancelled.', 409)
    if (!d) return err('no_draft', 'Nothing to confirm.', 409)
    if (!d.committable) return err('not_committable', 'This workflow is review-only and cannot create a record.', 409)
    if (input.version !== s.currentVersion || input.digest !== d.digest) return err('stale_confirmation', 'The draft changed after you reviewed it. Please read it back again.', 409)
    if (!s.readback) return err('readback_required', 'The draft must be read back before it can be confirmed.', 409)
    if (s.readback.version !== input.version || s.readback.digest !== input.digest) return err('readback_required', 'The readback does not match this version. Read it back again.', 409)
    if (d.status !== 'ready') return err('not_ready', buildQuestion(d) ?? 'The draft still needs clarification.', 409)
    if (d.requiresCriticalAck && input.criticalAck !== true) return err('critical_ack_required', 'Money fields need a second, deliberate confirmation.', 409)
    s.state = 'committed'
    s.committedAt = now.toISOString()
    s.committedKey = idem
    s.committedRecordId = await recordIdFor(s.id, d.version, d.digest)
    return { next: s, out: { draft: d, duplicate: false, criticalAck: input.criticalAck === true } }
  })
  if (isErr(r)) return r
  const s = r.session
  const d = r.out.draft
  const committedAt = s.committedAt ?? now.toISOString()
  // Persist (or recover) the signed record. Deterministic content + Ed25519 => a retried commit produces byte-identical output.
  const signed = await buildSigned(s, d, committedAt, r.out.criticalAck || d.requiresCriticalAck)
  const key = recKey(signed.payload.id)
  let record = signed
  if (!(await store.putIfAbsent(key, signed))) {
    const existing = (await store.get<SignedRecord>(key))?.value
    if (existing) record = existing
  }
  return { ok: true, session: s, record, duplicate: r.out.duplicate }
}

export async function getRecordForSession(store: Store, s: Session): Promise<SignedRecord | null> {
  if (!s.committedRecordId) return null
  return (await store.get<SignedRecord>(recKey(s.committedRecordId)))?.value ?? null
}

export async function cancelSession(store: Store, sid: string, now = new Date()): Promise<Result<{ session: Session }>> {
  const r = await mutate<null>(store, sid, now, async (s) => {
    if (s.state === 'committed') return err('already_committed', 'A confirmed record already exists; it cannot be cancelled.', 409)
    s.state = 'cancelled'
    s.readback = null
    return { next: s, out: null }
  })
  if (isErr(r)) return r
  return { ok: true, session: r.session }
}

/** Mark counters for provider-backed playback (application caps, not provider limits). */
export async function noteProviderUse(store: Store, sid: string, kind: 'tts' | 'clone', now = new Date()): Promise<Result<{ session: Session }>> {
  const c = cfg()
  const r = await mutate<null>(store, sid, now, async (s) => {
    if (kind === 'tts') {
      if (s.ttsCalls >= c.maxTtsPerSession) return err('tts_limit', 'Voice playback limit reached for this session. The text readback above is still available.', 429)
      s.ttsCalls += 1
    } else {
      if (s.cloneUsed) return err('clone_limit', 'Approved-voice playback was already used for this record.', 429)
      s.cloneUsed = true
    }
    return { next: s, out: null }
  })
  if (isErr(r)) return r
  return { ok: true, session: r.session }
}

/** Give back a counter when the provider call was definitely rejected (so a failed call does not use up the allowance). */
export async function refundProviderUse(store: Store, sid: string, kind: 'tts' | 'clone', now = new Date()): Promise<void> {
  await mutate<null>(store, sid, now, async (s) => {
    if (kind === 'tts') s.ttsCalls = Math.max(0, s.ttsCalls - 1)
    else s.cloneUsed = false
    return { next: s, out: null }
  })
}

/* ------------------------------------------------------------------ */
/* views (what the browser may see)                                     */
/* ------------------------------------------------------------------ */

export function sessionView(s: Session) {
  const c = cfg()
  return {
    id: s.id,
    workflow: s.workflow,
    lang: s.lang,
    tz: s.tz,
    mode: s.mode,
    modeReason: s.modeReason ?? null,
    state: s.state,
    turns: s.turns,
    maxTurns: c.maxTurns,
    maxUtterances: c.maxUtterances,
    expiresAt: s.expiresAt,
    currentVersion: s.currentVersion,
    utterances: s.utterances.map((u) => ({ id: u.id, text: u.text, source: u.source, at: u.at, detectedLanguage: u.detectedLanguage ?? null })),
    committedRecordId: s.committedRecordId,
    cloneUsed: s.cloneUsed,
    ttsCalls: s.ttsCalls,
    maxTtsCalls: c.maxTtsPerSession,
  }
}

export function draftView(s: Session, d: Draft | null) {
  if (!d) return null
  const rbDone = !!s.readback && s.readback.version === d.version && s.readback.digest === d.digest
  const rb = rbDone ? buildReadback(d) : null
  return {
    version: d.version,
    status: d.status,
    fields: Object.values(d.fields).map((f) => ({ key: f.key, label: f.label, display: f.display, basis: f.basis, evidence: f.evidence, critical: f.critical, empty: f.basis === 'not_stated' })),
    issues: d.issues,
    digest: d.digest,
    committable: d.committable,
    requiresCriticalAck: d.requiresCriticalAck,
    question: buildQuestion(d),
    checks: checkLines(d),
    readbackDone: rbDone,
    readback: rb ? { text: rb.text, lines: rb.lines, note: rb.note, ttsLanguage: rb.ttsLanguage } : null,
  }
}

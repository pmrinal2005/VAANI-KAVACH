/**
 * Instruction / reminder extractor (workflow pack 4 of 6).
 * Same rules as every other pack: deterministic, evidence-bearing, never invents a value or a procedure.
 * An instruction is only ever "prepared": the recipient acknowledging it is a SEPARATE event that this app does not fake.
 */
import type { Base, Ctx, Field, Issue } from '../types'
import { normKey, parseItems } from '../nlp/tokens'
import { resolveWhen } from '../nlp/dates'
import { DAY_AFTER, PARTS_OF_DAY, ROLE_WORDS, TODAY, TOMORROW, WEEKDAYS } from '../nlp/lexicon'
import { baseGet, detectInjection, entry, mkField, notStated, sentences } from './common'

const REMINDER_RE = /\b(remind(?:er)?|yaad|yad dila\w*|yaad dila\w*|alarm)\b|याद|रिमाइंडर/i
const CONSTRAINT_RE = /\b(se pehle|se pahle|before|only after|do not|don't|never|zaroor|mat\s+\w+)\b|से पहले|मत\s|ज़रूर|जरूर/i
const SHIFT_RE = /\b((?:next|night|day|morning|evening|afternoon|incoming|outgoing)\s+shift|[a-z]+\s+team)\s+(ko|को)\b/i
const NAME_RE = /([A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F'’-]*(?:\s+ji)?)\s+(ko|को)\b/g

const NOT_A_RECIPIENT = new Set<string>([...TOMORROW, ...TODAY, ...DAY_AFTER, ...Object.keys(WEEKDAYS), ...Object.keys(PARTS_OF_DAY), 'mujhe', 'usko', 'isko', 'sabko', 'kisi', 'unko', 'hume', 'humko', 'mere', 'tum', 'aap'].map(normKey))

function clauses(s: string): string[] {
  return s.split(/\s*(?:,|\bbut\b|\blekin\b|\bpar\b|\baur phir\b)\s*/i).map((x) => x.trim()).filter(Boolean)
}

/** Find who the instruction is for. Roles are canonicalised; a bare name is accepted only when it is capitalised in the source. */
function findRecipient(text: string): { value: string; evidence: string } | null {
  const shift = text.match(SHIFT_RE)
  if (shift) return { value: shift[1], evidence: shift[0] }
  for (const m of text.matchAll(NAME_RE)) {
    const word = m[1].trim()
    const key = normKey(word.replace(/\s+ji$/i, ''))
    if (NOT_A_RECIPIENT.has(key)) continue
    const role = ROLE_WORDS[key]
    if (role) return { value: role, evidence: m[0] }
    if (/^[A-Z\u0900-\u097F]/.test(word)) return { value: word, evidence: m[0] }
  }
  return null
}

export function extractInstruction(text: string, ctx: Ctx): { base: Base; issues: Issue[] } {
  const issues: Issue[] = [...detectInjection(text)]
  const base: Base = {}
  const items = parseItems(text)

  const kindHit = text.match(REMINDER_RE)
  base.instruction_kind = entry(kindHit ? 'reminder' : 'instruction', kindHit ? kindHit[0] : null, kindHit ? 'stated' : 'derived')

  const who = findRecipient(text)
  if (who) base.recipient_role = entry(who.value, who.evidence)

  const when = resolveWhen(text, items, ctx, 'due')
  issues.push(...when.issues)
  if (when.found && when.value) base.due = entry(when.value, when.evidence)

  const task: string[] = []
  const constraints: string[] = []
  for (const s of sentences(text)) {
    let rest = s.text
    if (who) rest = rest.replace(who.evidence, ' ').replace(/\s+/g, ' ').trim()
    for (const c of clauses(rest)) {
      if (CONSTRAINT_RE.test(c)) constraints.push(c)
      else if (c) task.push(c)
    }
  }
  if (task.length) base.task = entry(task.join('; '), task.join('; '))
  if (constraints.length) base.constraints = entry(constraints, constraints.join('; '))
  return { base, issues }
}

function whenDisplay(w: string): string {
  const m = w.match(/^(\d{4}-\d{2}-\d{2})?\s*(?:(\d{2}):00(?:-(\d{2}):00)?|(morning|afternoon|evening|night))?$/)
  if (!m) return w
  const lab = (h: number) => `${((h + 11) % 12) + 1} ${h % 24 >= 12 ? 'PM' : 'AM'}`
  const d = m[1] ? new Date(`${m[1]}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : ''
  const t = m[2] ? (m[3] ? `${lab(Number(m[2]))} to ${lab(Number(m[3]))}` : lab(Number(m[2]))) : m[4] || ''
  return [d, t].filter(Boolean).join(', ')
}

export function computeInstruction(base: Base, _ctx: Ctx, carried: Issue[]): { fields: Record<string, Field>; issues: Issue[] } {
  const issues = [...carried]
  const f: Record<string, Field> = {}
  const ed = (k: string) => (base[k]?.basis === 'user_edited' ? ('user_edited' as const) : ('stated' as const))

  const kind = baseGet<string>(base, 'instruction_kind') ?? 'instruction'
  f.instruction_kind = mkField('instruction_kind', kind, kind, base.instruction_kind?.basis === 'stated' ? 'stated' : 'derived', base.instruction_kind?.evidence ?? null)

  const task = baseGet<string>(base, 'task')
  if (task) f.task = mkField('task', task, task, ed('task'), base.task.evidence, true)
  else {
    f.task = notStated('task', true)
    issues.push({ code: 'task_missing', severity: 'block', field: 'task', message: 'What needs to be done was not heard.', question: 'What should be done?' })
  }

  const who = baseGet<string>(base, 'recipient_role')
  if (who) f.recipient_role = mkField('recipient_role', who, who, ed('recipient_role'), base.recipient_role.evidence, true)
  else {
    f.recipient_role = notStated('recipient_role', true)
    issues.push({ code: 'recipient_missing', severity: 'warn', field: 'recipient_role', message: 'Who this is for was not heard.', question: 'Who is this for?' })
  }

  const due = baseGet<string>(base, 'due')
  if (due) f.due = mkField('due', due, whenDisplay(due), ed('due'), base.due.evidence, true)
  else {
    f.due = notStated('due', true)
    if (kind === 'reminder') issues.push({ code: 'due_missing', severity: 'warn', field: 'due', message: 'A reminder needs a day/time and none was heard.', question: 'When should the reminder happen?' })
  }

  const cons = baseGet<string[]>(base, 'constraints')
  f.constraints = cons && cons.length ? mkField('constraints', cons, cons.join('; '), ed('constraints'), base.constraints.evidence, true) : notStated('constraints', true)

  f.acknowledgement = mkField('acknowledgement', 'not acknowledged - the recipient has not confirmed', 'not acknowledged - the recipient has not confirmed', 'derived', null)
  return { fields: f, issues }
}

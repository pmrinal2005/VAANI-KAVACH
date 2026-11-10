import type { Base, Ctx, Field, Issue } from '../types'
import { parseItems } from '../nlp/tokens'
import { resolveWhen } from '../nlp/dates'
import { normKey } from '../nlp/tokens'
import { ROLE_WORDS } from '../nlp/lexicon'
import { baseGet, detectInjection, entry, mkField, notStated, sentences } from './common'

const SEND_RE = /\b(bhej\w*|send|request|book|bula\w*|call|भेज\w*|बुला\w*)\b/i
const CONDITION_RE = /(estimate|quotation|quote|approval|permission|pehle|पहले|before|bina puche|without asking|only after|sirf|एस्टीमेट)/i
const URGENT_RE = /\b(urgent|urgently|jaldi|jldi|turant|abhi|emergency|asap|immediately|फौरन|जल्दी|तुरंत|अभी)\b/i
const LOCATION_WORDS = ['bathroom', 'kitchen', 'bedroom', 'hall', 'balcony', 'terrace', 'roof', 'gate', 'lift', 'parking', 'staircase', 'flat', 'room', 'floor', 'block', 'wing', 'tower', 'shop', 'office', 'garden', 'basement', 'lobby', 'washroom', 'toilet', 'बाथरूम', 'किचन', 'छत', 'गेट', 'लिफ्ट', 'दुकान']
const LOC_SET = new Set(LOCATION_WORDS.map(normKey))
const ISSUE_RE = /(leak|tap|pipe|kharab|band|toot|tuta|nahi chal|not working|broken|short|spark|jam|blocked|seepage|damp|crack|noise|smell|fault|repair|fix|ho raha|ho rahi|रिस|खराब|टूट|बंद|लीक)/i

export function extractServiceRequest(text: string, ctx: Ctx): { base: Base; issues: Issue[] } {
  const items = parseItems(text)
  const issues: Issue[] = [...detectInjection(text)]
  const base: Base = {}
  const sents = sentences(text)

  // recipient role
  for (const it of items) {
    if (it.kind === 'word' && ROLE_WORDS[it.norm]) {
      base.recipient_role = entry(ROLE_WORDS[it.norm], it.text)
      break
    }
  }
  // time window
  const when = resolveWhen(text, items, ctx, 'requested_window')
  issues.push(...when.issues)
  if (when.found) base.requested_window = entry(when.value, when.evidence)

  // classify sentences
  let problemSent: string | null = null
  let conditionSent: string | null = null
  for (const s of sents) {
    const isSend = SEND_RE.test(s.text) && (!!base.recipient_role && s.text.toLowerCase().includes(String(base.recipient_role.evidence).toLowerCase()))
    if (CONDITION_RE.test(s.text) && !isSend && !conditionSent) {
      conditionSent = s.text
      continue
    }
    if (isSend) continue
    if (!problemSent && (ISSUE_RE.test(s.text) || sents.length === 1)) problemSent = s.text
  }
  if (!problemSent && sents.length) {
    const rest = sents.find((s) => s.text !== conditionSent && !(SEND_RE.test(s.text) && base.recipient_role))
    if (rest) problemSent = rest.text
  }
  if (problemSent) base.problem = entry(problemSent, problemSent)
  if (conditionSent) base.condition = entry(conditionSent, conditionSent)

  // location (labels only; never invented)
  const locs: string[] = []
  for (const it of items) if (it.kind === 'word' && LOC_SET.has(it.norm) && !locs.includes(it.text.toLowerCase())) locs.push(it.text.toLowerCase())
  if (locs.length) base.location = entry(locs.slice(0, 2).join(' / '), locs.slice(0, 2).join(' / '))

  const urg = text.match(URGENT_RE)
  if (urg) base.urgency = entry('urgent (as stated)', urg[0])
  return { base, issues }
}

export function computeServiceRequest(base: Base, _ctx: Ctx, carried: Issue[]): { fields: Record<string, Field>; issues: Issue[] } {
  const issues = [...carried]
  const f: Record<string, Field> = {}
  const ed = (k: string) => (base[k]?.basis === 'user_edited' ? ('user_edited' as const) : ('stated' as const))
  const text = (k: string, critical = false) => {
    const v = baseGet<string>(base, k)
    f[k] = v ? mkField(k, v, v, ed(k), base[k].evidence, critical) : notStated(k, critical)
    return v
  }
  if (!text('problem', true)) issues.push({ code: 'problem_missing', severity: 'block', field: 'problem', message: 'The problem was not heard.', question: 'What is the problem?' })
  text('location')
  if (!text('recipient_role', true)) issues.push({ code: 'recipient_missing', severity: 'warn', field: 'recipient_role', message: 'Who the request is for (plumber, electrician ...) was not heard.', question: 'Who should receive this request?' })

  const w = baseGet<string>(base, 'requested_window')
  if (w) {
    const m = w.match(/^(\d{4}-\d{2}-\d{2})?\s*(?:(\d{2}):00(?:-(\d{2}):00)?|(morning|afternoon|evening|night))?$/)
    let disp = w
    if (m) {
      const lab = (h: number) => `${((h + 11) % 12) + 1} ${h % 24 >= 12 ? 'PM' : 'AM'}`
      const d = m[1] ? new Date(`${m[1]}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : ''
      const t = m[2] ? (m[3] ? `${lab(Number(m[2]))} to ${lab(Number(m[3]))}` : lab(Number(m[2]))) : m[4] || ''
      disp = [d, t].filter(Boolean).join(', ')
    }
    f.requested_window = mkField('requested_window', w, disp, ed('requested_window'), base.requested_window.evidence, true)
  } else {
    f.requested_window = notStated('requested_window', true)
    issues.push({ code: 'window_missing', severity: 'warn', field: 'requested_window', message: 'No preferred day/time was heard.', question: 'When should it happen?' })
  }
  text('condition')
  text('urgency')
  f.request_status = mkField('request_status', 'request prepared - not a confirmed booking', 'request prepared - not a confirmed booking', 'derived', null)
  return { fields: f, issues }
}

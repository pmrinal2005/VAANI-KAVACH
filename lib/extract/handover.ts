import type { Base, Ctx, Field, Issue } from '../types'
import { normKey } from '../nlp/tokens'
import { ROLE_WORDS } from '../nlp/lexicon'
import { baseGet, detectInjection, entry, mkField, notStated, sentences } from './common'

const DONE_RE = /\b(complete|completed|done|finished|khatam|ho gaya|ho gayi|ho gaye|pura hua|poora hua|checked|inspected)\b|पूरा हो|हो गया|हो गई/i
const PENDING_RE = /\b(pending|baaki|baki|remaining|not yet|abhi nahi|incomplete|to do|todo|bacha|bachi|due)\b|बाकी|पेंडिंग/i
const NEG_DONE_RE = /\b(not|nahi|nahin|na)\s+(complete|completed|done|finished)\b|\b(complete|done|finished)\s+(nahi|nahin|not)\b/i
const RESOURCE_RE = /\b(mein hai|me hai|mai hai|rakha hai|rakhi hai|kept|located|available|stored|hai store|store room|storeroom|godown|locker|shelf|cabinet|drawer)\b|में है|रखा है|रखी है/i
const CONSTRAINT_RE = /\b(se pehle|se pahle|before|only after|after|tak mat|do not|don't|never|must|zaroor|mat kar)\b|से पहले|मत|जरूर|ज़रूर/i
const OWNER_RE = /^((?:next|night|day|morning|evening|afternoon|incoming|outgoing)\s+shift|[a-z]+\s+team|supervisor|manager|[a-z]+\s+incharge|incharge|[a-z]+ ji|अगली शिफ्ट|नेक्स्ट शिफ्ट)\s+(ko|ke liye|to|को)\b\s*(.*)$/i

function splitClauses(s: string): string[] {
  return s
    .split(/\s*(?:,|\bbut\b|\blekin\b|\bpar\b|\bwhile\b)\s*/i)
    .map((x) => x.trim())
    .filter(Boolean)
}

export function extractHandover(text: string, _ctx: Ctx): { base: Base; issues: Issue[] } {
  const issues: Issue[] = [...detectInjection(text)]
  const base: Base = {}
  const completed: string[] = []
  const pending: string[] = []
  const resources: string[] = []
  const constraints: string[] = []
  let owner: string | null = null

  for (const s of sentences(text)) {
    const own = s.text.match(OWNER_RE)
    let rest = s.text
    if (own) {
      owner = own[1]
      rest = own[3] || ''
      if (rest && (CONSTRAINT_RE.test(rest) || /karna|check|dekh|follow|ensure|verify|करना/i.test(rest))) constraints.push(rest)
      else if (rest) pending.push(rest)
      continue
    }
    for (const c of splitClauses(rest)) {
      const negDone = NEG_DONE_RE.test(c)
      if (PENDING_RE.test(c) || negDone) pending.push(c)
      else if (DONE_RE.test(c)) completed.push(c)
      else if (RESOURCE_RE.test(c)) resources.push(c)
      else if (CONSTRAINT_RE.test(c)) constraints.push(c)
      else {
        const roleHit = c.split(/\s+/).find((w) => ROLE_WORDS[normKey(w)])
        if (roleHit && !owner && /ko\b|को\b/.test(c)) owner = roleHit
        else issues.push({ code: 'unclassified_text', severity: 'info', message: `Not placed in any section (kept out of the record): "${c}"` })
      }
    }
  }
  if (completed.length) base.completed = entry(completed, completed.join('; '))
  if (pending.length) base.pending = entry(pending, pending.join('; '))
  if (resources.length) base.resources = entry(resources, resources.join('; '))
  if (constraints.length) base.constraints = entry(constraints, constraints.join('; '))
  if (owner) base.next_owner = entry(owner, owner)
  return { base, issues }
}

export function computeHandover(base: Base, _ctx: Ctx, carried: Issue[]): { fields: Record<string, Field>; issues: Issue[] } {
  const issues = [...carried]
  const f: Record<string, Field> = {}
  const ed = (k: string) => (base[k]?.basis === 'user_edited' ? ('user_edited' as const) : ('stated' as const))
  const list = (k: string, critical = false) => {
    const v = baseGet<string[]>(base, k)
    f[k] = v && v.length ? mkField(k, v, v.join('; '), ed(k), base[k].evidence, critical) : notStated(k, critical)
    return v && v.length ? v : null
  }
  const c = list('completed', true)
  const p = list('pending', true)
  list('resources')
  list('constraints', true)
  const o = baseGet<string>(base, 'next_owner')
  f.next_owner = o ? mkField('next_owner', o, o, ed('next_owner'), base.next_owner.evidence, true) : notStated('next_owner', true)
  if (!c && !p) issues.push({ code: 'nothing_to_hand_over', severity: 'block', message: 'No completed or pending work was heard.', question: 'What work is completed and what is pending?' })
  if (!o) issues.push({ code: 'owner_missing', severity: 'warn', field: 'next_owner', message: 'The next responsible person or role was not heard.', question: 'Who takes over next?' })
  return { fields: f, issues }
}

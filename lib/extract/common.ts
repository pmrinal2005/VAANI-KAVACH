import type { Base, BaseEntry, Basis, Field, FieldValue, Issue } from '../types'
import { FIELD_LABELS } from '../labels'
import type { Item } from '../nlp/tokens'
import { INJECTION_PATTERNS } from '../nlp/lexicon'

export function entry(value: FieldValue, evidence: string | null, basis: Basis = 'stated'): BaseEntry {
  return { value, evidence, basis }
}

export function mkField(key: string, value: FieldValue, display: string, basis: Basis, evidence: string | null, critical = false): Field {
  return { key, label: FIELD_LABELS[key]?.en ?? key, value, display, basis, evidence, critical }
}

export function notStated(key: string, critical = false): Field {
  return mkField(key, null, 'not stated', 'not_stated', null, critical)
}

export function sliceItems(text: string, items: Item[], from: number, to: number): string {
  if (!items[from] || !items[to]) return ''
  return text.slice(items[from].start, items[to].end)
}

export function sentences(text: string): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = []
  const re = /[^.!?।\n;]+[.!?।;]*/g
  for (const m of text.matchAll(re)) {
    const raw = m[0]
    const lead = raw.length - raw.trimStart().length
    const t = raw.trim().replace(/[.!?।;]+$/, '').trim()
    if (t) out.push({ text: t, start: (m.index ?? 0) + lead })
  }
  return out
}

export function detectInjection(text: string): Issue[] {
  const hit = INJECTION_PATTERNS.find((p) => p.test(text))
  if (!hit) return []
  return [
    {
      code: 'instruction_like_text',
      severity: 'warn',
      message: 'The transcript contains instruction-like wording. It was treated only as data; it cannot confirm, commit or change any rule.',
    },
  ]
}

export function baseGet<T extends FieldValue>(base: Base, k: string): T | null {
  const e = base[k]
  return e && e.value !== null && e.value !== undefined ? (e.value as T) : null
}

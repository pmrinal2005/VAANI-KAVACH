/**
 * Spoken-correction handling ("fifty nahi, fifteen"). Deterministic and conservative:
 *  - changes ONLY the field the correction demonstrably refers to;
 *  - if more than one field could be meant, nothing changes and the user is asked;
 *  - never appends a new line item because another number was spoken.
 */
import type { Base, Ctx, FieldValue } from './types'
import { parseItems, normKey, type Item } from './nlp/tokens'
import { NEGATION_WORDS, UNIT_LOOKUP, TOMORROW, TODAY, DAY_AFTER, WEEKDAYS, PARTS_OF_DAY } from './nlp/lexicon'
import { confusableWith, rupeesToPaise } from './money'
import { resolveWhen } from './nlp/dates'
import { entry } from './extract/common'

export interface CorrectionResult {
  handled: boolean
  base?: Base
  /** display-field keys that were changed */
  changed: string[]
  notice?: string
}

const POSTFIX = new Set(['nahi', 'nahin', 'na', 'नहीं', 'नही'].map(normKey)) // Hindi: "<old> nahi <new>"
const EXTRA_NEG = new Set(['galat', 'wrong', 'गलत'].map(normKey))
const isNeg = (it: Item) => it.kind === 'word' && (NEGATION_WORDS.has(it.norm) || EXTRA_NEG.has(it.norm))
const isNum = (it?: Item): it is Extract<Item, { kind: 'num' }> => !!it && it.kind === 'num'
const isTime = (it?: Item) => !!it && it.kind === 'word' && (TOMORROW.has(it.norm) || TODAY.has(it.norm) || DAY_AFTER.has(it.norm) || WEEKDAYS[it.norm] !== undefined || !!PARTS_OF_DAY[it.norm])
const isUnit = (it?: Item) => !!it && it.kind === 'word' && UNIT_LOOKUP.has(it.norm)

const BRIDGE = new Set(['balki', 'matlab', 'sorry', 'ye', 'yeh', 'wo', 'woh', 'but', 'it', 'is', 'was', 'hai', 'tha', 'rupees', 'rupaye', 'rs', '₹', 'instead', ',', '-'].map(normKey))

/** Find the "old" (negated) and "new" candidate around the negation at index n. */
function pickOldNew(items: Item[], n: number, pred: (it?: Item) => boolean): { oldI: number; newI: number } | { newOnly: number } | null {
  const near = (from: number, step: 1 | -1, max: number): number => {
    for (let k = from, c = 0; k >= 0 && k < items.length && c < max; k += step, c++) {
      if (pred(items[k])) return k
      const it = items[k]
      const bridge = it.kind === 'sym' || (it.kind === 'word' && BRIDGE.has(it.norm))
      if (!bridge && !isNeg(it)) return -1
    }
    return -1
  }
  const neg = items[n]
  const postfix = POSTFIX.has(neg.norm)
  if (postfix) {
    const prev = near(n - 1, -1, 3)
    const next = near(n + 1, 1, 4)
    if (prev >= 0 && next >= 0) return { oldI: prev, newI: next }
    if (prev < 0 && next >= 0) return { newOnly: next }
    return null
  }
  // prefix style: "not fifty, fifteen" / "fifteen, not fifty"
  const after = near(n + 1, 1, 3)
  if (after < 0) return null
  const before = near(n - 1, -1, 4)
  if (before >= 0) return { oldI: after, newI: before }
  const after2 = near(after + 1, 1, 4)
  if (after2 >= 0) return { oldI: after, newI: after2 }
  return null
}

interface NumField { disp: string; baseKey: string; value: number; scale: 'unit' | 'paise' }

function numericFields(base: Base): NumField[] {
  const out: NumField[] = []
  const add = (disp: string, baseKey: string, scale: 'unit' | 'paise') => {
    const e = base[baseKey]
    if (e && typeof e.value === 'number') out.push({ disp, baseKey, value: scale === 'paise' ? e.value / 100 : e.value, scale })
  }
  add('quantity', 'quantity', 'unit')
  add('unit_price', 'unit_price_paise', 'paise')
  add('advance_received', 'advance_paise', 'paise')
  add('total', 'total_stated_paise', 'paise')
  add('outstanding', 'outstanding_stated_paise', 'paise')
  add('advance_received', 'received_unclassified_paise', 'paise')
  return out
}

function setNum(base: Base, f: NumField, v: number, evidence: string): Base {
  const nb: Base = { ...base }
  const stored = f.scale === 'paise' ? rupeesToPaise(v) : v
  nb[f.baseKey] = { value: stored, evidence, basis: 'user_edited' }
  return nb
}

export function applyCorrection(base: Base, text: string, ctx: Ctx): CorrectionResult {
  const items = parseItems(text)
  const n = items.findIndex(isNeg)
  if (n < 0) return { handled: false, changed: [] }

  /* ---- numbers ---- */
  const hasNum = items.some(isNum)
  if (hasNum) {
    const pick = pickOldNew(items, n, isNum)
    if (pick) {
      const fields = numericFields(base)
      if ('oldI' in pick) {
        const o = items[pick.oldI] as Extract<Item, { kind: 'num' }>
        const nw = items[pick.newI] as Extract<Item, { kind: 'num' }>
        const hits = fields.filter((f) => f.value === o.value)
        const ev = text.slice(Math.min(o.start, nw.start), Math.max(o.end, nw.end))
        if (hits.length === 1) {
          // a received amount that is still unclassified keeps its kind-question; the value is what changes
          return { handled: true, base: setNum(base, hits[0], nw.value, ev), changed: [hits[0].disp] }
        }
        if (hits.length === 0) return { handled: true, changed: [], notice: `I heard a correction from ${o.value} to ${nw.value}, but ${o.value} is not in the current draft. Nothing was changed.` }
        return { handled: true, changed: [], notice: `More than one field equals ${o.value} (${hits.map((h) => h.disp).join(', ')}). Nothing was changed; please edit the right field directly.` }
      }
      // new value only: "nahi, fifteen" -> the field whose value is the commonly confused twin of the new number
      const nw = items[pick.newOnly] as Extract<Item, { kind: 'num' }>
      const twin = confusableWith(nw.value)
      const hits = twin === null ? [] : fields.filter((f) => f.value === twin)
      if (hits.length === 1) return { handled: true, base: setNum(base, hits[0], nw.value, text.slice(items[n].start, nw.end)), changed: [hits[0].disp] }
      return { handled: true, changed: [], notice: `I heard "${text.trim()}" but cannot tell which value to change. Nothing was changed; please say it as "<old> nahi <new>" or edit the field directly.` }
    }
  }

  /* ---- units ("kilo nahi, bag") ---- */
  if (items.filter(isUnit).length >= 2 && base.unit) {
    const pick = pickOldNew(items, n, isUnit)
    if (pick && 'oldI' in pick) {
      const oldU = UNIT_LOOKUP.get((items[pick.oldI] as Extract<Item, { kind: 'word' }>).norm)
      const newIt = items[pick.newI] as Extract<Item, { kind: 'word' }>
      const newU = UNIT_LOOKUP.get(newIt.norm)
      if (oldU && newU && oldU === base.unit.value && oldU !== newU) {
        const ev = text.slice(Math.min(items[pick.oldI].start, newIt.start), Math.max(items[pick.oldI].end, newIt.end))
        return { handled: true, base: { ...base, unit: { value: newU, evidence: ev, basis: 'user_edited' } }, changed: ['unit'] }
      }
    }
  }

  /* ---- delivery / requested time ("kal nahi, parso") ---- */
  const whenKey = base.delivery ? 'delivery' : base.requested_window ? 'requested_window' : base.due ? 'due' : null
  if (whenKey && items.some(isTime)) {
    const pick = pickOldNew(items, n, isTime)
    if (pick && 'oldI' in pick) {
      const nw = items[pick.newI]
      const frag = text.slice(nw.start, nw.end)
      const w = resolveWhen(frag, parseItems(frag), ctx, whenKey)
      const oldVal = String(base[whenKey].value ?? '')
      if (w.found && w.value) {
        const [oldDate, ...oldRest] = oldVal.split(' ')
        const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(oldDate)
        const tail = (hasDate ? oldRest : oldVal.split(' ')).join(' ')
        let next = w.value
        if (/^\d{4}-\d{2}-\d{2}$/.test(w.value) && tail) next = `${w.value} ${tail}`
        else if (!/^\d{4}-/.test(w.value) && hasDate) next = `${oldDate} ${w.value}`
        if (next !== oldVal) {
          const ev = text.slice(Math.min(items[pick.oldI].start, nw.start), Math.max(items[pick.oldI].end, nw.end))
          return { handled: true, base: { ...base, [whenKey]: { value: next, evidence: ev, basis: 'user_edited' } }, changed: [whenKey] }
        }
      }
    }
  }
  return { handled: false, changed: [] }
}

/** Explicit override cue: "actually price 450", "correction: advance 300". Only then may a later utterance overwrite stated values. */
export const OVERRIDE_RE = /\b(actually|correction|change(?:\s+it)?\s+to|update|make it|badal(?:o|na)?|sudhar|replace)\b|\bsahi\s+karo\b|बदल|सुधार/i

export type { FieldValue }
export { entry }

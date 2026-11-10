import type { Base, Ctx, Field, Issue } from '../types'
import { formatQty, formatRupees, lineTotalPaise, rupeesToPaise, confusableWith } from '../money'
import { parseItems, type Item } from '../nlp/tokens'
import { resolveWhen } from '../nlp/dates'
import {
  ADVANCE_WORDS, FULL_WORDS, PAID_WORDS, PENDING_WORDS, PER_WORDS, RECEIVED_WORDS, RS_WORDS, STOP_WORDS,
  TOTAL_WORDS, UNIT_LABEL_EN, UNIT_LOOKUP, PARTS_OF_DAY, TOMORROW, TODAY, WEEKDAYS, DAY_AFTER, NEGATION_WORDS,
} from '../nlp/lexicon'
import { baseGet, detectInjection, entry, mkField, notStated } from './common'

const isNum = (it?: Item): it is Extract<Item, { kind: 'num' }> => !!it && it.kind === 'num'
const isWord = (it?: Item) => !!it && it.kind === 'word'

const RATE_WORDS = new Set(['rate', 'bhav', 'bhaav', 'price', 'daam', 'dam', 'रेट', 'भाव', 'दाम', 'कीमत'])
const DELIVERY_WORDS = new Set(['delivery', 'deliver', 'delivered', 'dena', 'pahunchana', 'डिलीवरी', 'पहुंचाना', 'पहुँचाना'])

function isTimeWord(n: string): boolean {
  return !!(PARTS_OF_DAY[n] || TOMORROW.has(n) || TODAY.has(n) || DAY_AFTER.has(n) || WEEKDAYS[n] !== undefined)
}

export function extractMoneyOrder(text: string, ctx: Ctx): { base: Base; issues: Issue[] } {
  const items = parseItems(text)
  const issues: Issue[] = [...detectInjection(text)]
  const base: Base = {}
  const when = resolveWhen(text, items, ctx, 'delivery')
  issues.push(...when.issues.filter((i) => i.code !== 'weekday_resolved'))
  const used = new Set<number>(when.consumed)
  const nums = items.map((it, i) => (isNum(it) ? i : -1)).filter((i) => i >= 0)

  /* ---- unit + quantity ---- */
  let unitIdx = -1
  let qtyIdx = -1
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (!isWord(it)) continue
    const u = UNIT_LOOKUP.get(it.norm)
    if (!u) continue
    const prev = items[i - 1]
    if (prev && isWord(prev) && PER_WORDS.has(prev.norm)) continue // price unit ("per bag")
    // nearest number before within 4 items (no sentence-ish break)
    let q = -1
    for (let k = i - 1; k >= Math.max(0, i - 4); k--) {
      if (isNum(items[k]) && !used.has(k)) { q = k; break }
      if (items[k].kind === 'sym' && items[k].norm !== '-') break
    }
    if (q >= 0 && !(items[q + 1] && isWord(items[q + 1]) && (ADVANCE_WORDS.has((items[q + 1] as Item).norm) || RS_WORDS.has((items[q + 1] as Item).norm)))) {
      unitIdx = i
      qtyIdx = q
      break
    }
    if (unitIdx < 0) unitIdx = i // unit without a quantity yet
  }
  if (unitIdx >= 0) base.unit = entry(UNIT_LOOKUP.get((items[unitIdx] as Item).norm)!, text.slice(items[unitIdx].start, items[unitIdx].end))
  if (qtyIdx >= 0) {
    const q = items[qtyIdx] as Extract<Item, { kind: 'num' }>
    base.quantity = entry(q.value, q.text)
    used.add(qtyIdx)
  }

  /* ---- item name ---- */
  if (unitIdx >= 0) {
    const collect = (from: number, to: number, step: 1 | -1): string[] => {
      const out: number[] = []
      for (let k = from; step === 1 ? k <= to : k >= to; k += step) {
        const it = items[k]
        if (!it || !isWord(it)) break
        if (STOP_WORDS.has(it.norm) || UNIT_LOOKUP.has(it.norm) || ADVANCE_WORDS.has(it.norm) || RS_WORDS.has(it.norm) || PER_WORDS.has(it.norm) || isTimeWord(it.norm) || RECEIVED_WORDS.has(it.norm) || PENDING_WORDS.has(it.norm) || DELIVERY_WORDS.has(it.norm) || TOTAL_WORDS.has(it.norm) || FULL_WORDS.has(it.norm) || PAID_WORDS.has(it.norm) || NEGATION_WORDS.has(it.norm)) break
        out.push(k)
      }
      return step === 1 ? out.map((k) => items[k].text) : out.reverse().map((k) => items[k].text)
    }
    let nameWords: string[] = []
    if (qtyIdx >= 0 && unitIdx - qtyIdx > 1) nameWords = collect(qtyIdx + 1, unitIdx - 1, 1) // "two cement bags"
    if (!nameWords.length) {
      const after = collect(unitIdx + 1, Math.min(items.length - 1, unitIdx + 3), 1) // "2 kilo aloo"
      nameWords = after
    }
    const afterOf = items[unitIdx + 1]
    if (!nameWords.length && afterOf && isWord(afterOf) && ['of', 'ka', 'ki', 'ke', 'का', 'की', 'के'].includes(afterOf.norm)) {
      nameWords = collect(unitIdx + 2, Math.min(items.length - 1, unitIdx + 4), 1) // "two bags of cement"
    }
    if (nameWords.length) {
      const joined = nameWords.join(' ')
      base.item = entry(joined, joined)
    }
  }

  /* ---- unit price ---- */
  let priceIdx = -1
  for (const i of nums) {
    if (used.has(i)) continue
    const a1 = items[i + 1]
    const a2 = items[i + 2]
    const a3 = items[i + 3]
    const afterRs = a1 && isWord(a1) && RS_WORDS.has(a1.norm)
    const j = afterRs ? i + 2 : i + 1
    const nxt = items[j]
    const per = nxt && isWord(nxt) && PER_WORDS.has(nxt.norm)
    const perHisab = per && (nxt as Item).norm.length <= 3 && items[j + 1] && isWord(items[j + 1]) && ['hisab', 'hisaab', 'हिसाब'].includes((items[j + 1] as Item).norm)
    const tail = nxt && isWord(nxt) && ['each', 'ka', 'का'].includes(nxt.norm) && UNIT_LOOKUP.has((items[j + 1] as Item | undefined)?.norm || '')
    const before = items[i - 1]
    const rateBefore = before && isWord(before) && RATE_WORDS.has(before.norm)
    const rsBefore = (before && (before.norm === '₹' || (isWord(before) && RS_WORDS.has(before.norm)))) && !(items[i - 2] && isWord(items[i - 2]) && ADVANCE_WORDS.has((items[i - 2] as Item).norm))
    if ((per && !perHisab) || perHisab || tail || rateBefore) {
      priceIdx = i
      break
    }
    void a2; void a3; void rsBefore
  }
  if (priceIdx < 0 && unitIdx >= 0) {
    // "₹420" / "420 rupees" immediately after the unit phrase, not an advance
    for (const i of nums) {
      if (used.has(i) || i < unitIdx) continue
      const near = [items[i - 1], items[i + 1]].filter(Boolean) as Item[]
      const rs = near.some((n) => n.norm === '₹' || (isWord(n) && RS_WORDS.has(n.norm)))
      const adv = [items[i - 2], items[i - 1], items[i + 1], items[i + 2]].some((n) => n && isWord(n) && (ADVANCE_WORDS.has(n.norm) || RECEIVED_WORDS.has(n.norm) || PENDING_WORDS.has(n.norm) || TOTAL_WORDS.has(n.norm)))
      if (rs && !adv) { priceIdx = i; break }
    }
  }
  let colloquialPrice = false
  if (priceIdx >= 0) {
    const p = items[priceIdx] as Extract<Item, { kind: 'num' }>
    base.unit_price_paise = entry(rupeesToPaise(p.value), p.text)
    colloquialPrice = !!p.colloquial
    used.add(priceIdx)
    // price unit mismatch ("per kilo" when ordered in bags)
    const pu = items.slice(priceIdx + 1, priceIdx + 5).find((x) => isWord(x) && UNIT_LOOKUP.has(x.norm))
    if (pu && base.unit && UNIT_LOOKUP.get((pu as Item).norm) !== base.unit.value) {
      issues.push({ code: 'price_unit_mismatch', severity: 'block', field: 'unit_price', message: `Price is per ${UNIT_LABEL_EN[UNIT_LOOKUP.get((pu as Item).norm)!]}, but quantity is in ${UNIT_LABEL_EN[base.unit.value as string]}.`, question: 'Is the price per the same unit as the quantity?' })
    }
  }
  if (colloquialPrice) {
    issues.push({ code: 'colloquial_price', severity: 'warn', field: 'unit_price', message: `"${(items[priceIdx] as Item).text}" was read as ${formatRupees(base.unit_price_paise!.value as number)}. Spoken shorthand like "four-twenty" is easy to mishear.`, question: `Is the unit price ${formatRupees(base.unit_price_paise!.value as number)}?` })
  }

  /* ---- advance / received / paid in full / totals / outstanding ---- */
  const wordAt = (i: number) => (items[i] && isWord(items[i]) ? (items[i] as Item).norm : '')
  const nearestNum = (center: number, before: number, after: number): number => {
    let best = -1
    let bestD = 99
    for (const i of nums) {
      if (used.has(i)) continue
      const d = i - center
      if (d < -before || d > after) continue
      const score = Math.abs(d) + (d < 0 ? 0.5 : 0)
      if (score < bestD) { best = i; bestD = score }
    }
    return best
  }
  let sawAdvanceWord = false
  items.forEach((it, i) => {
    if (!isWord(it) || !ADVANCE_WORDS.has(it.norm)) return
    sawAdvanceWord = true
    const n = nearestNum(i, 3, 4)
    if (n >= 0 && !base.advance_paise) {
      const v = items[n] as Extract<Item, { kind: 'num' }>
      base.advance_paise = entry(rupeesToPaise(v.value), text.slice(Math.min(it.start, v.start), Math.max(it.end, v.end)))
      used.add(n)
    }
  })
  if (sawAdvanceWord && !base.advance_paise) {
    issues.push({ code: 'advance_amount_missing', severity: 'block', field: 'advance_received', message: 'Advance was mentioned but no amount was heard.', question: 'How much advance was received?' })
  }
  // "received" amount with no advance/total word -> ambiguous kind
  if (!base.advance_paise) {
    items.forEach((it, i) => {
      if (!isWord(it) || !RECEIVED_WORDS.has(it.norm) || base.advance_paise) return
      const n = nearestNum(i, 4, 2)
      if (n >= 0) {
        const v = items[n] as Extract<Item, { kind: 'num' }>
        const rsNear = [items[n - 1], items[n + 1], items[n + 2]].some((x) => x && (x.norm === '₹' || (isWord(x) && RS_WORDS.has(x.norm))))
        if (rsNear || v.value >= 10) {
          used.add(n)
          base.received_unclassified_paise = entry(rupeesToPaise(v.value), text.slice(Math.min(it.start, v.start), Math.max(it.end, v.end)))
        }
      }
    })
  }
  // paid in full
  const fullIdx = items.findIndex((it, i) => isWord(it) && FULL_WORDS.has(it.norm) && (PAID_WORDS.has(wordAt(i + 1)) || PAID_WORDS.has(wordAt(i - 1)) || RECEIVED_WORDS.has(wordAt(i + 1)) || RECEIVED_WORDS.has(wordAt(i + 2))))
  const negNearFull = fullIdx >= 0 && (NEGATION_WORDS.has(wordAt(fullIdx + 1)) || NEGATION_WORDS.has(wordAt(fullIdx + 2)) || NEGATION_WORDS.has(wordAt(fullIdx - 1)))
  if (fullIdx >= 0 && !negNearFull) {
    base.paid_in_full = entry('yes', text.slice(items[fullIdx].start, items[Math.min(items.length - 1, fullIdx + 2)].end))
  }
  // stated total
  items.forEach((it, i) => {
    if (!isWord(it) || !TOTAL_WORDS.has(it.norm) || base.total_stated_paise) return
    const n = nearestNum(i, 1, 3)
    if (n >= 0) {
      const v = items[n] as Extract<Item, { kind: 'num' }>
      base.total_stated_paise = entry(rupeesToPaise(v.value), text.slice(Math.min(it.start, v.start), Math.max(it.end, v.end)))
      used.add(n)
    }
  })
  // stated outstanding ("baaki 640")
  items.forEach((it, i) => {
    if (!isWord(it) || !PENDING_WORDS.has(it.norm) || base.outstanding_stated_paise) return
    const n = nearestNum(i, 1, 2)
    if (n >= 0) {
      const v = items[n] as Extract<Item, { kind: 'num' }>
      base.outstanding_stated_paise = entry(rupeesToPaise(v.value), text.slice(Math.min(it.start, v.start), Math.max(it.end, v.end)))
      used.add(n)
    }
  })
  const pendingWord = items.find((it) => isWord(it) && PENDING_WORDS.has(it.norm))
  if (pendingWord) base.pending_mentioned = entry('yes', pendingWord.text)

  /* ---- party label ---- */
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (!isWord(it)) continue
    const nx = items[i + 1]
    const nn = items[i + 2]
    if (['ke', 'के'].includes(it.norm) && nx && isWord(nx) && ['liye', 'lie', 'लिए'].includes(nx.norm)) {
      const p = items[i - 1]
      if (p && isWord(p) && !STOP_WORDS.has(p.norm) && !UNIT_LOOKUP.has(p.norm)) { base.party = entry(p.text, text.slice(p.start, nx.end)); break }
    }
    if (it.norm === 'for' && nx && isWord(nx) && !STOP_WORDS.has(nx.norm) && /^[A-Z\u0900-\u097F]/.test(nx.text)) { base.party = entry(nx.text, text.slice(it.start, nx.end)); break }
    void nn
  }

  /* ---- delivery ---- */
  if (when.found) base.delivery = entry(when.value, when.evidence)
  return { base, issues }
}

export function computeMoneyOrder(base: Base, ctx: Ctx, carried: Issue[]): { fields: Record<string, Field>; issues: Issue[] } {
  const issues: Issue[] = [...carried]
  const f: Record<string, Field> = {}
  const edited = (k: string) => (base[k]?.basis === 'user_edited' ? ('user_edited' as const) : ('stated' as const))

  const party = baseGet<string>(base, 'party')
  f.party = party ? mkField('party', party, party, edited('party'), base.party.evidence) : notStated('party')
  const item = baseGet<string>(base, 'item')
  f.item = item ? mkField('item', item, item, edited('item'), base.item.evidence) : notStated('item')
  if (!item) issues.push({ code: 'item_missing', severity: 'block', field: 'item', message: 'Item/service was not heard.', question: 'What is the item or service?' })

  const qty = baseGet<number>(base, 'quantity')
  f.quantity = qty !== null ? mkField('quantity', qty, formatQty(qty), edited('quantity'), base.quantity.evidence, true) : notStated('quantity', true)
  if (qty === null) issues.push({ code: 'quantity_missing', severity: 'block', field: 'quantity', message: 'Quantity was not heard.', question: 'How many (quantity)?' })
  else if (qty <= 0) issues.push({ code: 'quantity_invalid', severity: 'block', field: 'quantity', message: 'Quantity must be greater than zero.', question: 'What is the correct quantity?' })

  const unit = baseGet<string>(base, 'unit')
  f.unit = unit ? mkField('unit', unit, UNIT_LABEL_EN[unit] || unit, edited('unit'), base.unit.evidence, true) : notStated('unit', true)
  if (!unit) issues.push({ code: 'unit_missing', severity: 'block', field: 'unit', message: 'Unit was not heard (bag, kg, piece ...).', question: 'In which unit — bag, kilo, piece, or something else?' })

  const priceP = baseGet<number>(base, 'unit_price_paise')
  f.unit_price = priceP !== null ? mkField('unit_price', priceP, `${formatRupees(priceP)}${unit ? ' per ' + (UNIT_LABEL_EN[unit] || unit) : ''}`, edited('unit_price_paise'), base.unit_price_paise.evidence, true) : notStated('unit_price', true)

  let totalP: number | null = null
  let totalBasis: 'derived' | 'stated' = 'derived'
  const derived = qty !== null && qty > 0 && priceP !== null ? lineTotalPaise(qty, priceP) : null
  const statedTotal = baseGet<number>(base, 'total_stated_paise')
  if (derived !== null && statedTotal !== null && derived !== statedTotal) {
    issues.push({ code: 'total_mismatch', severity: 'block', field: 'total', message: `Stated total ${formatRupees(statedTotal)} does not match quantity × price = ${formatRupees(derived)}.`, question: `Is the total ${formatRupees(derived)} (calculated) or ${formatRupees(statedTotal)} (stated)? Please correct the quantity, price or total.` })
    totalP = derived
  } else if (derived !== null) totalP = derived
  else if (statedTotal !== null) { totalP = statedTotal; totalBasis = 'stated' }
  if (totalP !== null) f.total = mkField('total', totalP, formatRupees(totalP), totalBasis, totalBasis === 'stated' ? base.total_stated_paise.evidence : `${qty !== null ? formatQty(qty) : ''} × ${formatRupees(priceP ?? 0)}`, true)
  else f.total = notStated('total', true)
  if (priceP === null && statedTotal === null) {
    issues.push({ code: 'price_missing', severity: 'warn', field: 'unit_price', message: 'No price was heard. The total cannot be calculated and will be recorded as not stated.', question: 'What is the price per unit (or the total)?' })
  }

  const paidFull = baseGet<string>(base, 'paid_in_full') === 'yes'
  let advP = baseGet<number>(base, 'advance_paise')
  const unclassified = baseGet<number>(base, 'received_unclassified_paise')
  if (unclassified !== null && advP === null && !paidFull) {
    issues.push({ code: 'payment_kind_ambiguous', severity: 'block', field: 'advance_received', message: `${formatRupees(unclassified)} was received, but it is unclear whether it is an advance or the full payment.`, question: `Is ${formatRupees(unclassified)} an advance (balance still pending) or the full payment?` })
  }
  if (paidFull && advP === null && totalP !== null) advP = totalP
  if (advP !== null && totalP !== null && advP > totalP) {
    issues.push({ code: 'advance_exceeds_total', severity: 'block', field: 'advance_received', message: `Advance ${formatRupees(advP)} is more than the total ${formatRupees(totalP)}.`, question: 'Please correct the advance or the total.' })
  }
  f.advance_received = advP !== null ? mkField('advance_received', advP, formatRupees(advP), paidFull && !base.advance_paise ? 'derived' : edited('advance_paise'), base.advance_paise?.evidence ?? base.paid_in_full?.evidence ?? null, true) : notStated('advance_received', true)

  let outP: number | null = null
  if (totalP !== null && advP !== null) outP = Math.max(0, totalP - advP)
  else if (totalP !== null && advP === null && baseGet(base, 'pending_mentioned')) outP = totalP
  const statedOut = baseGet<number>(base, 'outstanding_stated_paise')
  if (statedOut !== null && outP !== null && statedOut !== outP) {
    issues.push({ code: 'outstanding_mismatch', severity: 'block', field: 'outstanding', message: `Stated balance ${formatRupees(statedOut)} does not match the calculated ${formatRupees(outP)}.`, question: `Is the balance ${formatRupees(outP)} (calculated) or ${formatRupees(statedOut)} (stated)?` })
  }
  if (outP !== null) f.outstanding = mkField('outstanding', outP, formatRupees(outP), 'derived', null, true)
  else if (statedOut !== null) f.outstanding = mkField('outstanding', statedOut, formatRupees(statedOut), 'stated', base.outstanding_stated_paise.evidence, true)
  else f.outstanding = notStated('outstanding', true)

  let status = 'not recorded'
  if (paidFull) status = 'paid in full (as stated)'
  else if (advP !== null && advP > 0) status = 'advance received, balance pending'
  else if (baseGet(base, 'pending_mentioned')) status = 'pending'
  f.payment_status = mkField('payment_status', status, status, paidFull || advP !== null || baseGet(base, 'pending_mentioned') ? 'stated' : 'derived', base.paid_in_full?.evidence ?? base.pending_mentioned?.evidence ?? null, true)

  const del = baseGet<string>(base, 'delivery')
  if (del) {
    const parts = del.split(' ')
    const dateIso = /^\d{4}-\d{2}-\d{2}$/.test(parts[0]) ? parts[0] : null
    const rest = parts.slice(dateIso ? 1 : 0).join(' ')
    const dateDisp = dateIso ? new Date(`${dateIso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : ''
    let restDisp = rest
    const m = rest.match(/^(\d{2}):00(?:-(\d{2}):00)?$/)
    if (m) {
      const lab = (h: number) => `${((h + 11) % 12) + 1} ${h % 24 >= 12 ? 'PM' : 'AM'}`
      restDisp = m[2] ? `${lab(Number(m[1]))} to ${lab(Number(m[2]))}` : lab(Number(m[1]))
    }
    f.delivery = mkField('delivery', del, [dateDisp, restDisp].filter(Boolean).join(', '), edited('delivery'), base.delivery.evidence, true)
  } else {
    f.delivery = notStated('delivery', true)
    issues.push({ code: 'delivery_missing', severity: 'warn', field: 'delivery', message: 'No delivery day/time was heard.', question: 'When is the delivery?' })
  }

  // digit confusion guard
  for (const [k, v] of [['quantity', qty], ['unit_price', priceP !== null ? priceP / 100 : null], ['advance_received', advP !== null ? advP / 100 : null]] as Array<[string, number | null]>) {
    if (v !== null && Number.isInteger(v)) {
      const c = confusableWith(v)
      if (c !== null) issues.push({ code: 'digit_confusable', severity: 'info', field: k, message: `${v} sounds like ${c}; the readback spells the digits to avoid a mix-up.` })
    }
  }
  return { fields: f, issues }
}

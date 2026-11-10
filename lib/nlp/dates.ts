import type { Ctx, Issue } from '../types'
import type { Item } from './tokens'
import { AMPM_AM, AMPM_PM, DAY_AFTER, PARTS_OF_DAY, TODAY, TOMORROW, WEEKDAYS } from './lexicon'

export interface Ymd { y: number; m: number; d: number; dow: number }

export function localYmd(now: Date, tz: string): Ymd {
  let zone = tz
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone })
  } catch {
    zone = 'Asia/Kolkata'
  }
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), dow: dowMap[get('weekday')] ?? 0 }
}

export function addDays(base: Ymd, n: number): Ymd {
  const dt = new Date(Date.UTC(base.y, base.m - 1, base.d + n))
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), dow: dt.getUTCDay() }
}

export function ymdString(v: Ymd): string {
  return `${v.y}-${String(v.m).padStart(2, '0')}-${String(v.d).padStart(2, '0')}`
}

export function fmtYmd(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

const hh = (n: number) => String(n).padStart(2, '0')

export interface WhenResult {
  found: boolean
  /** machine value, e.g. "2026-11-11 afternoon" or "2026-11-14 10:00-12:00" */
  value: string | null
  display: string | null
  evidence: string | null
  consumed: Set<number>
  issues: Issue[]
}

const RANGE_JOIN = new Set(['to', 'se', 'tak', '-', '–', 'से', 'तक'])
const BAJE = new Set(['baje', 'bje', 'बजे', 'o\'clock', 'oclock', 'am', 'pm'])

export function resolveWhen(text: string, items: Item[], ctx: Ctx, field = 'delivery'): WhenResult {
  const issues: Issue[] = []
  const consumed = new Set<number>()
  const hits: number[] = []
  const today = localYmd(ctx.now, ctx.tz)

  let date: Ymd | null = null
  let dayKind: string | null = null
  let part: 'morning' | 'afternoon' | 'evening' | 'night' | null = null
  let partIdx = -1

  items.forEach((it, i) => {
    if (it.kind !== 'word') return
    const n = it.norm
    if (!date && TOMORROW.has(n)) {
      date = addDays(today, 1)
      dayKind = n === 'kal' || n === 'कल' ? 'kal' : 'tomorrow'
      hits.push(i)
    } else if (!date && DAY_AFTER.has(n)) {
      date = addDays(today, 2)
      dayKind = 'day_after'
      hits.push(i)
    } else if (!date && TODAY.has(n)) {
      date = today
      dayKind = 'today'
      hits.push(i)
    } else if (!date && WEEKDAYS[n] !== undefined) {
      const target = WEEKDAYS[n]
      let delta = (target - today.dow + 7) % 7
      if (delta === 0) {
        delta = 7
        issues.push({ code: 'weekday_is_today', severity: 'warn', field, message: `You said a weekday that is also today; I assumed next week.`, question: 'Did you mean today or next week?' })
      }
      date = addDays(today, delta)
      dayKind = 'weekday'
      hits.push(i)
    } else if (!part && PARTS_OF_DAY[n]) {
      part = PARTS_OF_DAY[n]
      partIdx = i
      hits.push(i)
    }
  })

  // time range / single time
  let window: { from: number; to: number | null; assumed: boolean } | null = null
  const hasContext = !!date || !!part
  for (let i = 0; i < items.length && !window; i++) {
    const a = items[i]
    if (a.kind !== 'num' || !Number.isInteger(a.value) || a.value < 1 || a.value > 24 || consumed.has(i)) continue
    // range
    let j = i + 1
    if (items[j] && items[j].kind !== 'num' && RANGE_JOIN.has(items[j].norm)) j++
    const b = items[j]
    if (j > i + 1 && b?.kind === 'num' && Number.isInteger(b.value) && b.value >= 1 && b.value <= 24 && b.value !== a.value && (hasContext || BAJE.has(items[j + 1]?.norm || ''))) {
      let from = a.value
      let to = b.value
      let assumed = false
      const after = items[j + 1]?.norm || ''
      const explicitPm = AMPM_PM.has(after) && after === 'pm'
      const explicitAm = after === 'am'
      if (to <= 24 && from < 24 && !(from > 12 || to > 12)) {
        if (explicitPm || part === 'afternoon' || part === 'evening' || part === 'night') {
          if (from < 12) from += 12
          if (to < 12) to += 12
        } else if (explicitAm || part === 'morning') {
          if (to === 12) to = 12
        } else {
          assumed = true
          if (from >= 1 && from <= 6) {
            from += 12
            to += 12
          } else if (to < from) to += 12
        }
      }
      window = { from, to, assumed }
      hits.push(i, j)
      consumed.add(i)
      consumed.add(j)
      if (items[j + 1] && BAJE.has(items[j + 1].norm)) hits.push(j + 1)
      break
    }
    // single "N baje"
    const nx = items[i + 1]
    if (nx && BAJE.has(nx.norm)) {
      let h = a.value
      let assumed = false
      if (nx.norm === 'pm' && h < 12) h += 12
      else if (nx.norm === 'am' || part === 'morning') h = h === 12 ? 0 : h
      else if (part === 'afternoon' || part === 'evening' || part === 'night') h = h < 12 ? h + 12 : h
      else assumed = true
      window = { from: h, to: null, assumed }
      hits.push(i, i + 1)
      consumed.add(i)
      break
    }
  }

  const found = hits.length > 0
  if (!found) return { found: false, value: null, display: null, evidence: null, consumed, issues }

  if (dayKind === 'kal') {
    issues.push({ code: 'kal_ambiguous', severity: 'warn', field, message: '"kal" can mean yesterday or tomorrow in Hindi; taken as tomorrow because this is a forward-looking request.', question: 'Is this tomorrow?' })
  }
  if (dayKind === 'weekday') {
    issues.push({ code: 'weekday_resolved', severity: 'info', field, message: `Weekday resolved against the displayed date (${fmtYmd(ymdString(today))}, ${ctx.tz}).` })
  }
  if ((part || window) && !date) {
    issues.push({ code: 'when_date_missing', severity: 'block', field, message: 'A time was given without a day.', question: 'Which day (for example tomorrow, Saturday, or a date)?' })
  }
  if (window?.assumed) {
    issues.push({ code: 'ampm_assumed', severity: 'warn', field, message: 'AM/PM was not stated; a reasonable guess was applied and is shown in the readback.', question: 'Please check the time of day.' })
  }

  const span = hits.map((i) => items[i])
  const start = Math.min(...span.map((s) => s.start))
  const end = Math.max(...span.map((s) => s.end))
  const evidence = text.slice(start, end)

  const bits: string[] = []
  const bitsDisp: string[] = []
  if (date) {
    const iso = ymdString(date)
    bits.push(iso)
    bitsDisp.push(fmtYmd(iso))
  }
  if (window) {
    const f = window.from % 24
    const tstr = window.to === null ? `${hh(f)}:00` : `${hh(f)}:00-${hh(window.to % 24)}:00`
    bits.push(tstr)
    const label = (h: number) => `${((h + 11) % 12) + 1}${h % 24 >= 12 ? ' PM' : ' AM'}`
    bitsDisp.push(window.to === null ? label(f) : `${label(f)} to ${label(window.to % 24)}`)
  } else if (part) {
    bits.push(part)
    bitsDisp.push(part)
  }
  void partIdx
  return { found: true, value: bits.join(' '), display: bitsDisp.join(', '), evidence, consumed, issues }
}

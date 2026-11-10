/** Decimal-safe money & quantity helpers. Money is integer paise; quantity is a decimal number with <= 3 dp. */

export function rupeesToPaise(r: number): number {
  return Math.round(r * 100)
}

export function qtyToMilli(q: number): number {
  return Math.round(q * 1000)
}

/** total = qty * unit price, rounded half-up to the nearest paisa, using BigInt (no float drift). */
export function lineTotalPaise(qty: number, unitPaise: number): number {
  const q = BigInt(qtyToMilli(qty))
  const u = BigInt(unitPaise)
  return Number((q * u + 500n) / 1000n)
}

function indianGroup(intStr: string): string {
  if (intStr.length <= 3) return intStr
  const last3 = intStr.slice(-3)
  const rest = intStr.slice(0, -3)
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3
}

export function formatRupees(paise: number): string {
  const neg = paise < 0
  const abs = Math.abs(paise)
  const rupees = Math.floor(abs / 100)
  const p = abs % 100
  const base = indianGroup(String(rupees))
  return `${neg ? '-' : ''}₹${base}${p ? '.' + String(p).padStart(2, '0') : ''}`
}

export function formatQty(q: number): string {
  return Number.isInteger(q) ? String(q) : String(Number(q.toFixed(3)))
}

/** Pairs people routinely confuse when hearing numbers (13/30 ... 19/90). */
const CONFUSABLE: Record<number, number> = {
  13: 30, 14: 40, 15: 50, 16: 60, 17: 70, 18: 80, 19: 90,
  30: 13, 40: 14, 50: 15, 60: 16, 70: 17, 80: 18, 90: 19,
}
export function confusableWith(n: number): number | null {
  return Number.isInteger(n) && CONFUSABLE[n] !== undefined ? CONFUSABLE[n] : null
}

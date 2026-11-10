/**
 * Tokenisation + number-word parsing for Hindi / Hinglish / English transcripts.
 * Every produced item keeps exact character offsets into the ORIGINAL transcript so that
 * every extracted value can cite an exact evidence substring.
 */

export interface Token {
  text: string
  norm: string
  start: number
  end: number
  kind: 'word' | 'digits' | 'sym'
}

export type Item =
  | { kind: 'word'; text: string; norm: string; start: number; end: number }
  | { kind: 'sym'; text: string; norm: string; start: number; end: number }
  | {
      kind: 'num'
      value: number
      start: number
      end: number
      text: string
      norm: string
      via: 'digits' | 'words'
      colloquial?: boolean
    }

const DEV_DIGITS = '०१२३४५६७८९'

/** Same-length replacement so offsets stay valid. */
export function asciiDigits(s: string): string {
  let out = ''
  for (const ch of s) {
    const i = DEV_DIGITS.indexOf(ch)
    out += i >= 0 ? String(i) : ch
  }
  return out
}

/** Key used for lexicon matching (not offset-preserving; per token only). */
export function normKey(w: string): string {
  return w
    .normalize('NFC')
    .toLowerCase()
    .replace(/\u093c/g, '') // nukta
    .replace(/\u0901/g, '\u0902') // chandrabindu -> anusvara
    .replace(/\u2019/g, "'")
}

const TOKEN_RE = /\d+(?:,\d{2,3})*(?:\.\d+)?|[\p{L}\p{M}]+(?:'[\p{L}]+)?|[₹%]|[-–/@:]/gu

export function tokenize(text: string): Token[] {
  const src = asciiDigits(text)
  const out: Token[] = []
  for (const m of src.matchAll(TOKEN_RE)) {
    const s = m[0]
    const start = m.index ?? 0
    const kind: Token['kind'] = /^\d/.test(s) ? 'digits' : /^[\p{L}\p{M}]/u.test(s) ? 'word' : 'sym'
    out.push({ text: text.slice(start, start + s.length), norm: kind === 'word' ? normKey(s) : s, start, end: start + s.length, kind })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Lexicon                                                              */
/* ------------------------------------------------------------------ */

const EN_UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const EN_TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }

/** Hindi 0..99 (romanised, with common spelling variants). */
const HI_ROMAN: Array<[number, string]> = [
  [0, 'shunya'], [1, 'ek'], [2, 'do'], [3, 'teen tin'], [4, 'char chaar'], [5, 'paanch panch paach pach'],
  [6, 'chhe chhah che chah'], [7, 'saat sat'], [8, 'aath ath'], [9, 'nau no'], [10, 'das dus'],
  [11, 'gyarah gyaarah giyarah igyarah'], [12, 'barah baarah'], [13, 'terah tera'], [14, 'chaudah chaudaha chaudha'],
  [15, 'pandrah pandra pandhrah'], [16, 'solah sola'], [17, 'satrah satra'], [18, 'atharah athaarah atharah athara'],
  [19, 'unnis unis unnees unnis'], [20, 'bees bis'], [21, 'ikkis ikkees ekkis'], [22, 'baais bais baaees'],
  [23, 'teis teeis tevis'], [24, 'chaubis chaubees'], [25, 'pachchis pachis pachees pachchees pacchis'],
  [26, 'chhabbis chhabbees chabbis'], [27, 'sattais sattaees satais'], [28, 'atthais atthaees athais'],
  [29, 'unatis unattis unteess untis'], [30, 'tees tis tiis'], [31, 'ikatis iktis ikattis'], [32, 'battis battees'],
  [33, 'tentis tentees taintis'], [34, 'chauntis chauntees'], [35, 'paintis paitis paintees'], [36, 'chhattis chhattees'],
  [37, 'saintis saitis sentis'], [38, 'adtis artis adatis'], [39, 'unchalis untalis untaalis'], [40, 'chalis chaalis'],
  [41, 'iktalis ikatalis'], [42, 'bayalis bayaalis byalis'], [43, 'tentalis taintalis tirtalis'],
  [44, 'chauwalis chavalis chauvalis'], [45, 'paitalis paintalis pentalis'], [46, 'chhiyalis chhiyaalis'],
  [47, 'saintalis saitalis'], [48, 'adtalis artalis adatalis'], [49, 'unchas unanchas'], [50, 'pachas pachaas pachaas'],
  [51, 'ikyavan ikyawan'], [52, 'bavan baawan'], [53, 'tirpan trepan'], [54, 'chauvan chauwan'], [55, 'pachpan'],
  [56, 'chhappan'], [57, 'satavan sattavan'], [58, 'athavan atthavan'], [59, 'unsath unsaath'], [60, 'saath sath'],
  [61, 'iksath ikasath'], [62, 'baasath basath'], [63, 'tirsath'], [64, 'chaunsath'], [65, 'painsath paisath'],
  [66, 'chhiyasath'], [67, 'adsath arsath'], [68, 'artsath adhsath'], [69, 'unhattar unahattar'], [70, 'sattar'],
  [71, 'ikhattar'], [72, 'bahattar'], [73, 'tihattar'], [74, 'chauhattar'], [75, 'pachhattar pachattar'],
  [76, 'chhihattar'], [77, 'satahattar'], [78, 'athahattar'], [79, 'unnasi unaasi'], [80, 'assi'], [81, 'ikyasi'],
  [82, 'bayasi'], [83, 'tirasi'], [84, 'chaurasi'], [85, 'pachasi'], [86, 'chhiyasi'], [87, 'sattasi'],
  [88, 'atthasi'], [89, 'nawasi navasi'], [90, 'nabbe'], [91, 'ikyanve'], [92, 'bayanve'], [93, 'tiranve'],
  [94, 'chauranve'], [95, 'pachanve'], [96, 'chhiyanve'], [97, 'sattanve'], [98, 'atthanve'], [99, 'ninyanve ninaanve'],
]

/** Devanagari spellings (main forms; STT with format=transcribe usually returns digits anyway). */
const HI_DEV: Array<[number, string]> = [
  [0, 'शून्य'], [1, 'एक'], [2, 'दो'], [3, 'तीन'], [4, 'चार'], [5, 'पांच'], [6, 'छह छः छे'], [7, 'सात'], [8, 'आठ'], [9, 'नौ'],
  [10, 'दस'], [11, 'ग्यारह'], [12, 'बारह'], [13, 'तेरह'], [14, 'चौदह'], [15, 'पंद्रह पन्द्रह'], [16, 'सोलह'], [17, 'सत्रह'],
  [18, 'अठारह'], [19, 'उन्नीस'], [20, 'बीस'], [21, 'इक्कीस'], [22, 'बाईस'], [23, 'तेईस'], [24, 'चौबीस'],
  [25, 'पच्चीस'], [26, 'छब्बीस'], [27, 'सत्ताईस'], [28, 'अट्ठाईस'], [29, 'उनतीस'], [30, 'तीस'], [40, 'चालीस'],
  [50, 'पचास'], [60, 'साठ'], [70, 'सत्तर'], [80, 'अस्सी'], [90, 'नब्बे'],
]

export const ATOMIC: Map<string, { v: number; en: boolean }> = new Map()
for (const [w, v] of Object.entries(EN_UNITS)) ATOMIC.set(w, { v, en: false })
for (const [w, v] of Object.entries(EN_TENS)) ATOMIC.set(w, { v, en: true })
for (const [v, ws] of HI_ROMAN) for (const w of ws.split(' ')) if (!ATOMIC.has(w)) ATOMIC.set(w, { v, en: false })
for (const [v, ws] of HI_DEV) for (const w of ws.split(' ')) ATOMIC.set(normKey(w), { v, en: false })

export const MULTIPLIER: Map<string, number> = new Map([
  ['hundred', 100], ['sau', 100], ['सौ', 100], ['sao', 100],
  ['thousand', 1000], ['hazaar', 1000], ['hazar', 1000], ['hajar', 1000], [normKey('हज़ार'), 1000], [normKey('हजार'), 1000],
  ['lakh', 100000], ['lac', 100000], ['lakhs', 100000], ['लाख', 100000],
  ['crore', 10000000], ['karod', 10000000], [normKey('करोड़'), 10000000], [normKey('करोड'), 10000000],
])

export const FRACTION_WORDS: Map<string, number> = new Map([
  ['dedh', 1.5], ['derh', 1.5], ['डेढ़', 1.5], ['dhai', 2.5], ['dhaai', 2.5], ['ढाई', 2.5],
  ['aadha', 0.5], ['aadhe', 0.5], ['adha', 0.5], ['half', 0.5], ['आधा', 0.5], ['आधे', 0.5],
])

/** Hindi "do" is also the imperative "give": "de do", "kar do". */
const IMPERATIVE_PRECEDERS = new Set(['de', 'kar', 'le', 'dijiye', 'kijiye', 'karo', 'ho', 'rakh', 'bhej', 'दे', 'कर', 'ले'])

function isNumberWord(norm: string): boolean {
  return ATOMIC.has(norm) || MULTIPLIER.has(norm) || FRACTION_WORDS.has(norm)
}

function parseDigits(s: string): number {
  return Number(s.replace(/,/g, ''))
}

interface Atom {
  idx: number
  v?: number
  m?: number
  en?: boolean
  digits?: boolean
  frac?: boolean
}

function canAdd(current: number, atom: Atom): boolean {
  if (atom.v === undefined) return false
  if (current === 0) return true
  if (atom.frac) return false
  const tail = current % 100
  if (atom.digits) return tail === 0 && current > 0 && atom.v < 100
  if (tail === 0) return atom.v < 100
  // English compounds: twenty + five
  if (atom.v < 10 && tail >= 20 && tail % 10 === 0 && !atom.en) return true
  return false
}

/**
 * Convert tokens into items, merging number words/digits into numeric items.
 * Colloquial two-part prices ("four twenty" => 420) are merged and flagged.
 */
export function toItems(tokens: Token[]): Item[] {
  // 1. classify atoms
  const atoms: Array<Atom | null> = tokens.map((t, i) => {
    if (t.kind === 'digits') return { idx: i, v: parseDigits(t.norm), digits: true }
    if (t.kind !== 'word') return null
    const prev = tokens[i - 1]
    if (t.norm === 'do' && prev && IMPERATIVE_PRECEDERS.has(prev.norm)) return null
    if (t.norm === 'do' && prev && prev.kind === 'word' && prev.norm === 'kar') return null
    const a = ATOMIC.get(t.norm)
    if (a) return { idx: i, v: a.v, en: a.en }
    const m = MULTIPLIER.get(t.norm)
    if (m) return { idx: i, m }
    const f = FRACTION_WORDS.get(t.norm)
    if (f !== undefined) return { idx: i, v: f, frac: true }
    return null
  })

  const items: Item[] = []
  let i = 0
  const pushTok = (t: Token) => {
    items.push({ kind: t.kind === 'sym' ? 'sym' : 'word', text: t.text, norm: t.norm, start: t.start, end: t.end } as Item)
  }

  while (i < tokens.length) {
    const a = atoms[i]
    if (!a) {
      pushTok(tokens[i])
      i++
      continue
    }
    // start a run
    let total = 0
    let current = 0
    let lastScale = Infinity
    let first = i
    let last = i
    let viaDigits = a.digits === true
    let k = i
    let consumedAny = false
    while (k < tokens.length) {
      // allow hyphen between number words (twenty-five, four-twenty)
      let at = atoms[k]
      let hop = 0
      if (!at && tokens[k].kind === 'sym' && tokens[k].norm === '-' && consumedAny && atoms[k + 1] && atoms[k + 1]!.v !== undefined) {
        at = atoms[k + 1]
        hop = 1
      }
      if (!at) break
      if (at.v !== undefined) {
        if (!canAdd(current, at)) {
          if (!(current === 0)) break
        }
        // a digit token directly following a completed number never merges
        if (at.digits && consumedAny && current === 0 && total === 0) break
        current += at.v
        if (at.digits) viaDigits = viaDigits || true
        else if (consumedAny) viaDigits = false
        last = k + hop
        consumedAny = true
      } else if (at.m !== undefined) {
        const m = at.m
        if (m === 100) {
          if (current >= 100 && current % 100 === 0) break
          current = (current || 1) * 100
        } else {
          if (m >= lastScale) break
          total += (current || 1) * m
          current = 0
          lastScale = m
        }
        last = k + hop
        consumedAny = true
      }
      k += 1 + hop
    }
    if (!consumedAny) {
      pushTok(tokens[i])
      i++
      continue
    }
    const value = total + current
    const start = tokens[first].start
    const end = tokens[last].end
    const sliceTokens = tokens.slice(first, last + 1)
    const words = sliceTokens.some((t) => t.kind === 'word')
    items.push({
      kind: 'num',
      value: Math.round(value * 1000) / 1000,
      start,
      end,
      text: '',
      norm: '',
      via: words ? 'words' : 'digits',
    })
    i = last + 1
  }

  // fill text/norm lazily (needs original text) — caller supplies via fillText
  return mergeColloquial(items)
}

export function fillText(items: Item[], text: string): Item[] {
  return items.map((it) => (it.kind === 'num' ? { ...it, text: text.slice(it.start, it.end), norm: text.slice(it.start, it.end).toLowerCase() } : it))
}

function mergeColloquial(items: Item[]): Item[] {
  const out: Item[] = []
  for (let i = 0; i < items.length; i++) {
    const a = items[i]
    let bi = i + 1
    if (items[bi]?.kind === 'sym' && items[bi].norm === '-') bi++
    const b = items[bi]
    if (
      a?.kind === 'num' && b?.kind === 'num' && a.via === 'words' && b.via === 'words' &&
      Number.isInteger(a.value) && a.value >= 1 && a.value <= 9 && Number.isInteger(b.value) && b.value >= 20 && b.value <= 99
    ) {
      // adjacent (a space or a single hyphen between): "four twenty" / "four-twenty" => 420
      out.push({ ...a, value: a.value * 100 + b.value, end: b.end, colloquial: true })
      i = bi
      continue
    }
    out.push(a)
  }
  return out
}

export function parseItems(text: string): Item[] {
  return fillText(toItems(tokenize(text)), text)
}

/** Spell a small integer in English for readback ("fifteen"). */
export function numberToEnglish(n: number): string {
  if (!Number.isInteger(n) || n < 0) return String(n)
  const ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
  if (n < 20) return ones[n]
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '')
  if (n < 1000) return ones[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numberToEnglish(n % 100) : '')
  if (n < 100000) return numberToEnglish(Math.floor(n / 1000)) + ' thousand' + (n % 1000 ? ' ' + numberToEnglish(n % 1000) : '')
  if (n < 10000000) return numberToEnglish(Math.floor(n / 100000)) + ' lakh' + (n % 100000 ? ' ' + numberToEnglish(n % 100000) : '')
  return numberToEnglish(Math.floor(n / 10000000)) + ' crore' + (n % 10000000 ? ' ' + numberToEnglish(n % 10000000) : '')
}

export { isNumberWord }

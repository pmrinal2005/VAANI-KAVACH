import { normKey } from './tokens'

function set(words: string): Set<string> {
  return new Set(words.split(/\s+/).filter(Boolean).map(normKey))
}

/** canonical unit -> spoken variants (Hindi/Hinglish/English + small Tamil/Bengali example sets). */
const UNIT_VARIANTS: Record<string, string> = {
  bag: 'bag bags bori boriyan bora thaila थैला बोरी बोरे bag बैग मूट்டை மூட்டை বস্তা',
  kg: 'kg kgs kilo kilos kilogram kilograms किलो किग्रा கிலோ কেজি কিলো',
  g: 'gram grams gm ग्राम',
  quintal: 'quintal quintals क्विंटल',
  tonne: 'ton tons tonne tonnes टन',
  piece: 'piece pieces pcs pc nag number nos पीस नग',
  dozen: 'dozen dozens darjan दर्जन',
  litre: 'litre litres liter liters ltr lit लीटर',
  packet: 'packet packets pkt पैकेट',
  box: 'box boxes dabba dibba डिब्बा',
  bundle: 'bundle bundles gaddi गड्डी',
  metre: 'metre metres meter meters mtr मीटर',
  foot: 'foot feet ft फुट',
  bottle: 'bottle bottles botal बोतल',
  hour: 'hour hours ghanta ghante घंटा घंटे',
  day: 'day days din दिन',
  tray: 'tray trays',
  can: 'can cans',
}

export const UNIT_LOOKUP: Map<string, string> = new Map()
for (const [canon, vars] of Object.entries(UNIT_VARIANTS)) for (const v of vars.split(/\s+/)) if (v) UNIT_LOOKUP.set(normKey(v), canon)

export const UNIT_LABEL_EN: Record<string, string> = {
  bag: 'bag', kg: 'kg', g: 'g', quintal: 'quintal', tonne: 'tonne', piece: 'piece', dozen: 'dozen', litre: 'litre',
  packet: 'packet', box: 'box', bundle: 'bundle', metre: 'metre', foot: 'foot', bottle: 'bottle', hour: 'hour', day: 'day', tray: 'tray', can: 'can',
}
export const UNIT_LABEL_HI: Record<string, string> = {
  bag: 'बैग', kg: 'किलो', g: 'ग्राम', quintal: 'क्विंटल', tonne: 'टन', piece: 'पीस', dozen: 'दर्जन', litre: 'लीटर',
  packet: 'पैकेट', box: 'डिब्बा', bundle: 'गड्डी', metre: 'मीटर', foot: 'फुट', bottle: 'बोतल', hour: 'घंटा', day: 'दिन', tray: 'ट्रे', can: 'कैन',
}

export const STOP_WORDS = set(`
the a an of for to and or ke ki ka ko se me mein mai hai hain ho tha thi the ye yeh woh wo is us ek bhi hi
please pls kar karo karna dena dedo de do le lo liye lie wala wale wali ji sir madam bhai
और के की का को से में है हैं हो था थी ये यह वो
`)

export const PER_WORDS = set('per prati har har-ek each ek ke hisab hisaab rate bhav bhaav के हिसाब रेट भाव प्रति हर पर')
export const RS_WORDS = set('rs rupee rupees rupaye rupaiya rupay rupya inr ₹ रुपये रुपए रुपया रु')
export const ADVANCE_WORDS = set('advance token bayana bayna peshgi paishgi अग्रिम एडवांस बयाना टोकन அட்வான்ஸ் முன்பணம் অগ্রিম')
export const RECEIVED_WORDS = set('mila mili mile received diya diye di liya liye le liya jama aaya aayi mil gaya मिला मिली मिले दिया दी दिये जमा आया கிடைத்தது পেয়েছি')
export const TOTAL_WORDS = set('total kul kul-milakar sum कुल टोटल मिलाकर')
export const PENDING_WORDS = set('pending baaki baki bakaya bacha bachi due outstanding balance remaining बाकी बकाया பாக்கி বাকি')
export const NEGATION_WORDS = set('nahi nahin na not no nope mat galat wrong नहीं नही मत गलत illai নয় না')
export const PAID_WORDS = set('paid payment pay settled clear cleared भुगतान पेमेंट चुकता')
export const FULL_WORDS = set('full poora pura puri sab sabhi saara sara all complete completely fully पूरा पूरी सब सारा')
export const UNPAID_WORDS = set('unpaid pending baaki baki udhaar udhar udhari credit khata उधार बाकी')

export const TOMORROW = set('kal tomorrow कल நாளை কাল')
export const TODAY = set('aaj today आज இன்று আজ')
export const DAY_AFTER = set('parso parson day-after परसों परसो')
export const WEEKDAYS: Record<string, number> = {}
;(
  [
    ['sunday ravivar itwar sun', 0],
    ['monday somvar somwar mon', 1],
    ['tuesday mangalvar mangalwar tue tues', 2],
    ['wednesday budhvar budhwar wed', 3],
    ['thursday guruvar guruwar brihaspativar veervar thu thur thurs', 4],
    ['friday shukravar shukrawar fri', 5],
    ['saturday shanivar shaniwar sat', 6],
  ] as Array<[string, number]>
).forEach(([ws, d]) => ws.split(' ').forEach((w) => (WEEKDAYS[normKey(w)] = d)))
for (const [w, d] of [['रविवार', 0], ['सोमवार', 1], ['मंगलवार', 2], ['बुधवार', 3], ['गुरुवार', 4], ['शुक्रवार', 5], ['शनिवार', 6]] as Array<[string, number]>) WEEKDAYS[normKey(w)] = d

export const PARTS_OF_DAY: Record<string, 'morning' | 'afternoon' | 'evening' | 'night'> = {}
for (const [part, ws] of [
  ['morning', 'subah subha morning savere सुबह सवेरे'],
  ['afternoon', 'afternoon dopahar dophar दोपहर'],
  ['evening', 'evening shaam sham शाम'],
  ['night', 'night raat raatri रात'],
] as Array<[ 'morning' | 'afternoon' | 'evening' | 'night', string]>) ws.split(' ').forEach((w) => (PARTS_OF_DAY[normKey(w)] = part))

export const AMPM_AM = set('am a.m. subah morning सुबह')
export const AMPM_PM = set('pm p.m. shaam evening afternoon dopahar raat night शाम दोपहर रात')

export const CANCEL_PHRASES = [
  /\bcancel\b/i, /\brehne\s*do\b/i, /\bchhod\s*do\b/i, /\bchodo\b/i, /\bchhodo\b/i, /\bstop\b/i, /\bdiscard\b/i,
  /\bबंद\s*करो\b/, /\bरहने\s*दो\b/, /\bछोड़\s*दो\b/, /\bकैंसिल\b/,
]
export const CONFIRM_LIKE = /^\s*(haan|han|haanji|ha|yes|yep|yeah|ok|okay|theek hai|thik hai|sahi hai|sahi|correct|confirm|confirmed|done|हाँ|हां|जी|ठीक है|सही है|सही|ठीक)\s*[.!]*\s*$/i

export const INJECTION_PATTERNS = [
  /ignore (all |any )?(previous|prior|above) (instructions|prompts?)/i,
  /disregard (the )?(previous|above|system) /i,
  /system prompt/i,
  /you are now\b/i,
  /developer mode/i,
  /(mark|set|record|save|commit|confirm)\s+(this\s+|it\s+)?(as\s+)?(confirmed|committed|paid|done)\b/i,
  /\bdo not (ask|require) (for )?confirmation/i,
  /\bskip (the )?confirmation/i,
]

export const ROLE_WORDS: Record<string, string> = {
  plumber: 'plumber', plumbar: 'plumber', नलसाज: 'plumber', प्लम्बर: 'plumber',
  electrician: 'electrician', bijliwala: 'electrician', इलेक्ट्रीशियन: 'electrician',
  carpenter: 'carpenter', badhai: 'carpenter', बढ़ई: 'carpenter',
  mechanic: 'mechanic', mistri: 'mechanic', मिस्त्री: 'mechanic',
  painter: 'painter', ac: 'AC technician', technician: 'technician',
  supervisor: 'supervisor', सुपरवाइज़र: 'supervisor', सुपरवाइजर: 'supervisor',
  manager: 'manager', secretary: 'secretary', driver: 'driver', ड्राइवर: 'driver',
  security: 'security', guard: 'security guard', cleaner: 'cleaner', maid: 'maid',
}
for (const k of Object.keys(ROLE_WORDS)) ROLE_WORDS[normKey(k)] = ROLE_WORDS[k]

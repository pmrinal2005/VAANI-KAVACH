/** UI strings. Hindi/Hinglish-first; English always available. (Tamil/Bengali UI strings are planned, not shipped.) */
import type { Lang, WorkflowId } from '@/lib/types'

export type UiLang = 'hi' | 'en'
export const uiLangOf = (l: Lang): UiLang => (l === 'en' ? 'en' : 'hi')

export const T = {
  tagline: { hi: 'बोलिए। मतलब जाँचिए। फिर पक्का कीजिए।', en: 'Speak naturally. Check the meaning. Confirm the action.' },
  sub: { hi: 'भारत की सत्यापित आवाज़ परत', en: "Bharat's Verified Voice Layer" },
  start: { hi: 'शुरू करें', en: 'Start' },
  chooseTask: { hi: 'आज क्या करना है?', en: 'What do you want to do?' },
  language: { hi: 'भाषा', en: 'Language' },
  typeHere: { hi: 'यहाँ लिखिए या माइक दबाकर बोलिए', en: 'Type here, or press the mic and speak' },
  send: { hi: 'भेजें', en: 'Send' },
  record: { hi: 'बोलना शुरू करें', en: 'Start recording' },
  stopRecord: { hi: 'रिकॉर्डिंग रोकें', en: 'Stop recording' },
  draft: { hi: 'जो मैंने समझा', en: 'What I understood' },
  readback: { hi: 'पढ़कर सुनाएँ / दिखाएँ', en: 'Read it back' },
  playReadback: { hi: 'आवाज़ में सुनें', en: 'Play readback' },
  confirm: { hi: 'पक्का करें', en: 'Confirm' },
  cancel: { hi: 'रद्द करें', en: 'Cancel' },
  newSession: { hi: 'नई शुरुआत', en: 'Start over' },
  receipt: { hi: 'पक्की रसीद', en: 'Confirmed record' },
  verify: { hi: 'अपने ब्राउज़र में जाँचें', en: 'Verify in this browser' },
  resetDevice: { hi: 'इस डिवाइस से सब हटाएँ', en: 'Clear everything on this device' },
  ack: { hi: 'मैंने मात्रा, इकाई, दाम, एडवांस और डिलीवरी जाँच ली है।', en: 'I checked the quantity, unit, price, advance and delivery.' },
} as const
export const tr = (k: keyof typeof T, l: UiLang) => T[k][l]

export const WORKFLOW_CARDS: Array<{ id: WorkflowId; icon: string; hi: string; en: string; hint: string; maturity: 'live' | 'review'; example: string }> = [
  { id: 'money_order', icon: '₹', hi: 'पैसा या ऑर्डर दर्ज करें', en: 'Record money or an order', hint: 'Quantity, unit, price, advance, delivery', maturity: 'live', example: 'Ravi ke liye do cement bags, four-twenty per bag. Advance two hundred mila hai, baaki pending. Delivery kal afternoon.' },
  { id: 'service_request', icon: '🛠', hi: 'रिक्वेस्ट बनाएँ', en: 'Make a request', hint: 'Problem, who, when, conditions', maturity: 'live', example: 'Bathroom tap leak ho raha hai. Plumber ko Saturday ten to twelve ka request bhejna. Parts ka estimate pehle chahiye.' },
  { id: 'instruction', icon: '🔔', hi: 'निर्देश या रिमाइंडर', en: 'Instruction or reminder', hint: 'Task, for whom, when, conditions', maturity: 'live', example: 'Ramesh ko kal subah ten baje gate ka lock check karna hai, guest aane se pehle.' },
  { id: 'handover', icon: '🔁', hi: 'हैंडओवर', en: 'Handover', hint: 'Done, pending, where things are, next owner', maturity: 'live', example: 'Pump inspection complete, but filter change pending. Spare filter store room mein hai. Next shift ko motor restart se pehle supervisor se check karna hai.' },
  { id: 'risk_review', icon: '🛡', hi: 'संदिग्ध संदेश जाँचें', en: 'Review a risky message', hint: 'Caution note only. Never a safety certificate', maturity: 'review', example: 'Your KYC will expire today. Share your OTP immediately and click here http://example.test to avoid account block.' },
]

export const MATURITY: Record<string, { label: string; cls: string; icon: string }> = {
  live: { label: 'Live and tested', cls: 'm-live', icon: '✔' },
  review: { label: 'Live, review-only (rules are limited)', cls: 'm-review', icon: '◐' },
  example: { label: 'Example', cls: 'm-example', icon: '◇' },
  planned: { label: 'Planned', cls: 'm-planned', icon: '○' },
}

export const LANG_OPTIONS: Array<{ id: Lang; label: string; note?: string }> = [
  { id: 'hinglish', label: 'हिन्दी / Hinglish' },
  { id: 'en', label: 'English' },
  { id: 'ta', label: 'தமிழ் / Tanglish', note: 'Speech recognition hints are Tamil. Readback is English only for now (native-reviewed Tamil readback is planned).' },
  { id: 'bn', label: 'বাংলা / Benglish', note: 'Speech recognition hints are Bengali. Readback is English only for now (native-reviewed Bengali readback is planned).' },
]

export const PLANNED_GROUPS = ['Farmers and dairy suppliers', 'Kirana and street vendors', 'Electricians, plumbers, carpenters', 'Tailors and artisans', 'Delivery and transport', 'Warehouse and security shifts', 'Households and older adults', 'Students, tutors, freelancers', 'Self-help groups, NGOs, housing societies']

export const STEPS = ['Capture', 'Transcribe', 'Structure', 'Validate', 'Clarify / Read back', 'Confirm', 'Committed'] as const
export function stepIndex(state: string, hasDraft: boolean, status?: string): number {
  if (state === 'committed') return 6
  if (state === 'awaiting_confirmation') return 5
  if (state === 'ready_for_readback') return 4
  if (state === 'clarifying') return 4
  return hasDraft ? (status === 'ready' ? 4 : 4) : 0
}

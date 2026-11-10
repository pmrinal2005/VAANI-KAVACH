import type { Base, Ctx, Field, Issue } from '../types'
import { mkField, entry, detectInjection } from './common'
import { baseGet } from './common'

interface Rule { id: string; label: string; re: RegExp }
const RULES: Rule[] = [
  { id: 'otp_pin', label: 'Asks for an OTP, PIN, CVV or password', re: /\b(otp|one[- ]time password|pin|cvv|password|passcode|mpin|upi pin)\b.{0,40}\b(share|send|tell|bata|batao|dena|de do|give|provide|enter)\b|\b(share|send|tell|bata|batao|give|provide)\b.{0,40}\b(otp|pin|cvv|password|mpin)\b/i },
  { id: 'urgency', label: 'Pressures you to act immediately', re: /\b(immediately|right now|within \d+ (minutes|hours|mins)|urgent(ly)?|last chance|abhi|turant|jaldi|aaj hi|today only|expires? (today|soon)|blocked today|will be blocked|band ho jayega|बंद हो जाएगा|तुरंत)\b/i },
  { id: 'payment_request', label: 'Asks you to send or transfer money', re: /\b(send|transfer|pay|bhej(o|na)?|de do|deposit)\b.{0,40}(rs\.?|₹|rupees?|upi|gpay|phonepe|paytm|bank|account)|(rs\.?|₹)\s?\d[\d,]*.{0,40}\b(send|transfer|pay|bhej)/i },
  { id: 'unknown_link', label: 'Contains a link to open or an app to install', re: /(https?:\/\/|www\.|bit\.ly|tinyurl|\.apk\b|click (here|the link)|link pe click|download (the )?app)/i },
  { id: 'kyc_threat', label: 'Threatens account block or SIM disconnection', re: /\b(kyc)\b.{0,50}\b(expire|update|pending|block|suspend)|\b(account|sim|card|number)\b.{0,40}\b(block(ed)?|suspend(ed)?|deactivate(d)?|disconnect(ed)?)\b/i },
  { id: 'prize', label: 'Claims you won a prize, lottery or refund', re: /\b(lottery|lucky draw|you (have )?won|prize|jackpot|cashback offer|refund (is )?(pending|waiting)|inaam|इनाम)\b/i },
  { id: 'impersonation', label: 'Claims to be a bank, police, courier or government office', re: /\b(i am calling from|this is (the )?)?(rbi|cbi|police|customs|income tax|trai|bank (officer|manager|executive)|courier|fedex|narcotics|cyber ?crime|government officer)\b/i },
  { id: 'remote_access', label: 'Asks you to install a screen-sharing / remote app', re: /\b(anydesk|teamviewer|quicksupport|screen ?share|remote (access|support))\b/i },
  { id: 'secrecy', label: 'Tells you to keep it secret', re: /\b(don'?t|do not|kisi ko (mat|nahi)|mat)\b.{0,30}\b(tell|share|bata|batana|inform)\b.{0,20}\b(anyone|anybody|family|kisi)\b|\bkeep (this )?(a )?secret\b|\bconfidential\b.{0,20}\bdo not\b/i },
  { id: 'id_documents', label: 'Asks for Aadhaar, PAN, card number or ID photos', re: /\b(aadhaar|aadhar|pan (card|number)|card number|account number|selfie|id proof)\b.{0,40}\b(send|share|upload|bata|dena|provide|give)\b|\b(send|share|upload|provide|give)\b.{0,40}\b(aadhaar|aadhar|pan|card number|selfie)\b/i },
]

export function extractRiskReview(text: string, _ctx: Ctx): { base: Base; issues: Issue[] } {
  const base: Base = {}
  const issues: Issue[] = [...detectInjection(text)]
  const hits: string[] = []
  const ev: string[] = []
  for (const r of RULES) {
    const m = text.match(r.re)
    if (m) {
      hits.push(`${r.label} - "${m[0].trim().slice(0, 80)}"`)
      ev.push(m[0].trim())
    }
  }
  if (hits.length) base.indicators = entry(hits, ev.join(' | '))
  base.submitted = entry(text.slice(0, 400), text.slice(0, 400))
  return { base, issues }
}

export function computeRiskReview(base: Base, _ctx: Ctx, carried: Issue[]): { fields: Record<string, Field>; issues: Issue[] } {
  const issues = [...carried]
  const hits = baseGet<string[]>(base, 'indicators') || []
  const f: Record<string, Field> = {}
  f.indicators = hits.length ? mkField('indicators', hits, hits.join('; '), 'stated', base.indicators.evidence, true) : mkField('indicators', [], 'none matched by the current rules', 'derived', null, true)
  const caution = hits.length
    ? `${hits.length} risky-request pattern${hits.length > 1 ? 's were' : ' was'} found. Treat this message as suspicious until verified through an official channel you look up yourself.`
    : 'No risky-request pattern matched the current rules. This is NOT a safety certificate; scams change wording constantly.'
  f.caution = mkField('caution', caution, caution, 'derived', null)
  const step = hits.length
    ? 'Do not share OTPs, PINs or passwords, do not click links or install apps, and do not transfer money. Contact the organisation using the number printed on your card or its official website. For financial fraud in India you can call 1930.'
    : 'If anything still feels wrong, pause and verify through an official channel you look up yourself before acting.'
  f.next_safe_step = mkField('next_safe_step', step, step, 'derived', null)
  if (!baseGet<string>(base, 'submitted')) issues.push({ code: 'empty', severity: 'block', message: 'No message was provided.', question: 'Paste or speak the message to review.' })
  return { fields: f, issues }
}

import type { Draft, Field, Lang, RecordPayload } from './types'
import { numberToEnglish } from './nlp/tokens'
import { confusableWith, formatRupees } from './money'
import { UNIT_LABEL_EN } from './nlp/lexicon'

export interface Readback {
  text: string
  /** BCP-47-ish code accepted by the Gnani TTS `language` parameter. */
  ttsLanguage: string
  /** Honest label: readbacks for ta/bn are English text, not native-reviewed translations. */
  note: string | null
  lines: string[]
}

export function ttsLanguageFor(lang: Lang): string {
  return lang === 'hinglish' ? 'hi-en' : 'en-IN'
}

function spellDigits(n: number): string {
  return String(n).split('').map((d) => numberToEnglish(Number(d))).join(' ')
}

function amountSpoken(paise: number): string {
  const r = paise / 100
  if (Number.isInteger(r)) {
    const c = confusableWith(r)
    const base = `${formatRupees(paise)} (${numberToEnglish(r)} rupees)`
    return c !== null ? `${base}, that is ${spellDigits(r)}` : base
  }
  return formatRupees(paise)
}

function qtySpoken(q: number): string {
  if (Number.isInteger(q)) {
    const c = confusableWith(q)
    return c !== null ? `${q}, that is ${spellDigits(q)}` : String(q)
  }
  return String(q)
}

const v = (f: Field | undefined) => (f && f.value !== null && f.value !== undefined && !(Array.isArray(f.value) && f.value.length === 0) ? f.display : null)

export function buildReadback(draft: Draft): Readback {
  const F = draft.fields
  const lines: string[] = []
  const wf = draft.workflow
  if (wf === 'money_order') {
    const unit = F.unit?.value ? UNIT_LABEL_EN[F.unit.value as string] || String(F.unit.value) : null
    const qty = F.quantity?.value as number | null
    lines.push(`Order${F.party?.value ? ` for ${F.party.display}` : ''}: ${qty !== null && qty !== undefined ? qtySpoken(qty) : 'quantity not stated'}${unit ? ' ' + unit + (qty !== null && qty !== undefined && qty > 1 ? 's' : '') : ''}${v(F.item) ? ' of ' + F.item.display : ''}.`)
    lines.push(F.unit_price?.value !== null && F.unit_price?.value !== undefined ? `Unit price: ${amountSpoken(F.unit_price.value as number)} per ${unit ?? 'unit'}.` : 'Unit price: not stated.')
    lines.push(F.total?.value !== null && F.total?.value !== undefined ? `Total: ${amountSpoken(F.total.value as number)}.` : 'Total: not stated.')
    lines.push(F.advance_received?.value !== null && F.advance_received?.value !== undefined ? `Advance received: ${amountSpoken(F.advance_received.value as number)}.` : 'Advance received: not recorded.')
    if (F.outstanding?.value !== null && F.outstanding?.value !== undefined) lines.push(`Balance pending: ${amountSpoken(F.outstanding.value as number)}.`)
    lines.push(`Payment status: ${F.payment_status?.display ?? 'not recorded'}.`)
    lines.push(`Delivery: ${v(F.delivery) ?? 'not stated'}.`)
  } else if (wf === 'service_request') {
    lines.push(`Problem: ${v(F.problem) ?? 'not stated'}.`)
    if (v(F.location)) lines.push(`Location: ${F.location.display}.`)
    lines.push(`Send to: ${v(F.recipient_role) ?? 'not stated'}.`)
    lines.push(`Requested time: ${v(F.requested_window) ?? 'not stated'}.`)
    if (v(F.condition)) lines.push(`Condition: ${F.condition.display}.`)
    if (v(F.urgency)) lines.push(`Urgency: ${F.urgency.display}.`)
    lines.push('Status: request prepared. This is not a confirmed booking.')
  } else if (wf === 'handover') {
    lines.push(`Completed: ${v(F.completed) ?? 'nothing stated'}.`)
    lines.push(`Pending: ${v(F.pending) ?? 'nothing stated'}.`)
    if (v(F.resources)) lines.push(`Resources: ${F.resources.display}.`)
    if (v(F.constraints)) lines.push(`Constraints: ${F.constraints.display}.`)
    lines.push(`Next owner: ${v(F.next_owner) ?? 'not stated'}.`)
  } else {
    lines.push(`Review result: ${F.caution?.display ?? ''}`)
    lines.push(`Next safe step: ${F.next_safe_step?.display ?? ''}`)
  }
  if (draft.committable) lines.push('Confirm, correct, or cancel?')
  const note = draft.lang === 'ta' || draft.lang === 'bn' ? 'Readback is generated in English. A native-reviewed Tamil/Bengali readback pack is planned, not yet available.' : null
  return { text: lines.join(' '), ttsLanguage: ttsLanguageFor(draft.lang), note, lines }
}

/** Narration for an already-approved record (used by the cloned-voice playback). Deterministic. */
export function buildNarration(payload: RecordPayload): string {
  const d = payload.field_display
  const wf = payload.workflow
  if (wf === 'money_order') {
    return `Approved record. ${d.party ? 'For ' + d.party + '. ' : ''}${d.quantity ?? ''} ${d.unit ?? ''} ${d.item ?? ''}. Total ${d.total ?? 'not stated'}. Advance ${d.advance_received ?? 'not recorded'}. Balance ${d.outstanding ?? 'not stated'}. Delivery ${d.delivery ?? 'not stated'}. This is a synthetic voice.`.replace(/\s+/g, ' ')
  }
  if (wf === 'service_request') {
    return `Approved request. Problem: ${d.problem ?? 'not stated'}. Send to ${d.recipient_role ?? 'not stated'}. Requested time ${d.requested_window ?? 'not stated'}. ${d.condition ? 'Condition: ' + d.condition + '. ' : ''}This is a request, not a confirmed booking. This is a synthetic voice.`
  }
  return `Approved handover. Completed: ${d.completed ?? 'nothing stated'}. Pending: ${d.pending ?? 'nothing stated'}. ${d.constraints ? 'Constraints: ' + d.constraints + '. ' : ''}Next owner ${d.next_owner ?? 'not stated'}. This is a synthetic voice.`
}

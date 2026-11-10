'use client'
import { useState } from 'react'
import { FIELD_LABELS } from '@/lib/labels'
import type { DraftView } from '@/lib/client/types'
import type { UiLang } from '@/lib/client/copy'

/** Fields a person may correct by typing. Computed fields (total, balance, status) are derived and never directly editable. */
export const EDITABLE = new Set([
  'party', 'item', 'quantity', 'unit', 'unit_price', 'advance_received', 'delivery',
  'problem', 'location', 'recipient_role', 'condition', 'requested_window',
  'completed', 'pending', 'resources', 'constraints', 'next_owner',
])

const BASIS: Record<string, string> = { stated: 'heard', derived: 'calculated', user_edited: 'you edited', not_stated: 'not stated', assumed: 'assumed' }
const SEV_ICON: Record<string, string> = { block: '⛔', warn: '⚠', info: 'ℹ' }
const SEV_WORD: Record<string, string> = { block: 'Must fix', warn: 'Please check', info: 'Note' }

export default function DraftPanel({ draft, ui, onEdit, busy }: { draft: DraftView; ui: UiLang; onEdit?: (key: string, value: string) => void; busy?: boolean }) {
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null)
  const main = draft.issues.filter((i) => i.severity !== 'info')
  const info = draft.issues.filter((i) => i.severity === 'info')

  return (
    <section aria-labelledby="draft-h">
      <h2 id="draft-h" style={{ margin: '0 0 6px', fontSize: '1.05rem' }}>
        {ui === 'hi' ? 'जो मैंने समझा' : 'What I understood'} <small style={{ color: 'var(--muted)', fontWeight: 400 }}>· v{draft.version}</small>
      </h2>
      <div className="fields" role="list">
        {draft.fields.map((f) => {
          const lab = FIELD_LABELS[f.key]
          const label = lab ? (ui === 'hi' ? lab.hi : lab.en) : f.label
          const isEditing = editing?.key === f.key
          return (
            <div key={f.key} role="listitem" className={`field${f.critical ? ' critical' : ''}${f.empty ? ' empty' : ''}`}>
              <div className="k">{label}{f.critical ? <span title="Critical field"> ★</span> : null}</div>
              <div className="v">
                {isEditing ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      onEdit?.(f.key, editing.value)
                      setEditing(null)
                    }}
                    style={{ display: 'flex', gap: 6 }}
                  >
                    <label className="sr-only" htmlFor={`ed-${f.key}`}>{label}</label>
                    <input id={`ed-${f.key}`} type="text" autoFocus value={editing.value} onChange={(e) => setEditing({ key: f.key, value: e.target.value })} />
                    <button className="btn primary" type="submit">OK</button>
                    <button className="btn" type="button" onClick={() => setEditing(null)}>✕</button>
                  </form>
                ) : (
                  <>
                    {f.display}
                    {f.evidence && f.basis !== 'not_stated' ? <span className="ev">“{f.evidence}”</span> : null}
                  </>
                )}
              </div>
              <div>
                <span className={`tag ${f.basis}`}>{BASIS[f.basis] ?? f.basis}</span>
                {onEdit && EDITABLE.has(f.key) && !isEditing ? (
                  <div>
                    <button className="edit" disabled={busy} onClick={() => setEditing({ key: f.key, value: f.empty ? '' : f.key === 'unit_price' || f.key === 'advance_received' ? String(f.display).replace(/[^\d.]/g, '') : f.key === 'quantity' ? String(f.display) : f.display.replace(/ per .*/, '') })} aria-label={`Edit ${label}`}>
                      {ui === 'hi' ? 'बदलें' : 'Edit'}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      {draft.question ? (
        <div className="notice q" role="status"><strong>❓ {ui === 'hi' ? 'एक जानकारी चाहिए' : 'One detail needed'}</strong><br />{draft.question}</div>
      ) : null}
      {main.length > 0 ? (
        <div className="notice q" role="status">
          <strong>{ui === 'hi' ? 'जाँच के लिए' : 'Before you confirm'}</strong>
          <ul className="issues">
            {main.map((i, n) => (
              <li key={`${i.code}-${n}`}><span aria-hidden="true">{SEV_ICON[i.severity]}</span> <strong>{SEV_WORD[i.severity]}:</strong> {i.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {info.length > 0 ? (
        <details className="how">
          <summary>{ui === 'hi' ? 'अन्य नोट' : 'Other notes'} ({info.length})</summary>
          <ul className="issues">{info.map((i, n) => <li key={`${i.code}-${n}`}>ℹ {i.message}</li>)}</ul>
        </details>
      ) : null}
    </section>
  )
}

'use client'
import { useState } from 'react'
import { verifySigned, VERIFY_LIMITATIONS, type VerifyResult } from '@/lib/verify'
import type { SignedRecord } from '@/lib/client/types'
import type { UiLang } from '@/lib/client/copy'

const KEYS_CACHE = 'vk_keys_v1'

export interface CachedKeys { keys: Record<string, string>; fetched_at: string }
export function loadCachedKeys(): CachedKeys | null {
  try {
    const raw = localStorage.getItem(KEYS_CACHE)
    return raw ? (JSON.parse(raw) as CachedKeys) : null
  } catch {
    return null
  }
}
export function saveCachedKeys(k: CachedKeys): void {
  try { localStorage.setItem(KEYS_CACHE, JSON.stringify(k)) } catch { /* private mode */ }
}
export function clearCachedKeys(): void {
  try { localStorage.removeItem(KEYS_CACHE) } catch { /* ignore */ }
}

/** Fetch the public key list; fall back to the cached copy when offline. Public keys are not secret. */
export async function getKnownKeys(extra: Record<string, string> = {}): Promise<{ keys: Record<string, string>; fetchedAt: string | null; fromCache: boolean }> {
  try {
    const r = await fetch('/api/keys', { cache: 'no-store' })
    if (r.ok) {
      const j = (await r.json()) as { keys: Record<string, string>; fetched_at: string }
      saveCachedKeys({ keys: j.keys, fetched_at: j.fetched_at })
      return { keys: { ...j.keys, ...extra }, fetchedAt: j.fetched_at, fromCache: false }
    }
  } catch { /* offline: use cache */ }
  const c = loadCachedKeys()
  return { keys: { ...(c?.keys ?? {}), ...extra }, fetchedAt: c?.fetched_at ?? null, fromCache: true }
}

export default function Receipt({ record, ui, replayKeys, canNarrate, onNarrate, onStandard, narrating, voiceLabel }: {
  record: SignedRecord
  ui: UiLang
  replayKeys?: Record<string, string>
  canNarrate?: boolean
  onNarrate?: () => void
  onStandard?: () => void
  narrating?: boolean
  voiceLabel?: string | null
}) {
  const [res, setRes] = useState<(VerifyResult & { fromCache: boolean; fetchedAt: string | null }) | null>(null)
  const [pasted, setPasted] = useState('')
  const [shareMsg, setShareMsg] = useState<string | null>(null)
  const p = record.payload
  const text = JSON.stringify(record, null, 2)

  async function verify(obj: unknown) {
    const k = await getKnownKeys(replayKeys)
    const r = await verifySigned(obj, k.keys)
    setRes({ ...r, fromCache: k.fromCache, fetchedAt: k.fetchedAt })
  }
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${p.id}.vk.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  async function share() {
    const summary = `${p.workflow} - ${Object.entries(p.field_display).filter(([, v]) => v && v !== 'not stated').map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('; ')}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Vaani Kavach record', text: summary })
        setShareMsg('Share sheet opened. This does not prove the other person received or agreed to it.')
      } else {
        await navigator.clipboard.writeText(summary)
        setShareMsg('Summary copied. Sharing does not prove the other person received or agreed to it.')
      }
    } catch {
      setShareMsg('Sharing was cancelled or is not available on this device.')
    }
  }

  return (
    <section className="card receipt" aria-labelledby="rec-h">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id="rec-h" style={{ margin: 0, fontSize: '1.1rem' }}>{ui === 'hi' ? 'पक्की रसीद' : 'Confirmed record'}</h2>
        <span className="stamp" role="img" aria-label="Author confirmed">AUTHOR CONFIRMED</span>
      </div>
      <dl className="kv">
        <dt>Record ID</dt><dd className="digest">{p.id}</dd>
        {Object.entries(p.field_display).map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}><dt>{k.replace(/_/g, ' ')}</dt><dd>{v}</dd></div>
        ))}
        <dt>Draft version</dt><dd>{p.draft_version}</dd>
        <dt>Content digest</dt><dd className="digest">{p.content_digest}</dd>
        <dt>Key ID</dt><dd className="digest">{record.key_id} ({record.alg})</dd>
        <dt>Confirmed at</dt><dd>{p.confirmation.at} · {p.timezone}</dd>
        <dt>Recipient acknowledged</dt><dd>No (not recorded yet)</dd>
      </dl>
      {record.signing_note ? <div className="notice info">{record.signing_note}</div> : null}
      <div className="notice info" role="note">
        <strong>What this means</strong>
        <ul className="issues">
          <li>You approved this version of the application&apos;s interpretation.</li>
          <li>It is not proof that another person agreed, that the statements are true, or that anything is legally binding.</li>
        </ul>
      </div>

      <div className="row no-print" style={{ marginTop: 8 }}>
        <button className="btn" onClick={() => verify(record)}>{ui === 'hi' ? 'अपने ब्राउज़र में जाँचें' : 'Verify in this browser'}</button>
        <button className="btn" onClick={download}>⬇ JSON</button>
        <button className="btn" onClick={share}>↗ Share</button>
        <button className="btn" onClick={() => window.print()}>🖨 Print</button>
      </div>
      {shareMsg ? <div className="notice info" role="status">{shareMsg}</div> : null}

      {onStandard || canNarrate ? (
        <div className="row no-print" style={{ marginTop: 8 }}>
          {onStandard ? <button className="btn" disabled={narrating} onClick={onStandard}>🔊 Standard voice</button> : null}
          {canNarrate ? <button className="btn primary" disabled={narrating} onClick={onNarrate}>🎙 Approved voice (synthetic)</button> : null}
        </div>
      ) : null}
      {voiceLabel ? <div className="notice info" role="status">🔔 {voiceLabel}</div> : null}

      {res ? (
        <div className={`notice ${res.valid ? 'good' : 'err'}`} role="status">
          <strong>{res.valid ? '✔ Signature valid' : `✖ Verification failed (${res.reason})`}</strong>
          {res.fromCache ? <div>Checked with cached keys{res.fetchedAt ? ` last updated ${res.fetchedAt}` : ''}. Offline checks cannot learn about later key revocation.</div> : null}
          <ul className="issues">{VERIFY_LIMITATIONS.map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      ) : null}

      <details className="how no-print">
        <summary>{ui === 'hi' ? 'किसी और रसीद की जाँच' : 'Verify a pasted record (works offline once keys are cached)'}</summary>
        <label htmlFor="paste">Signed record JSON</label>
        <textarea id="paste" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder='{"payload": {...}, "signature": "...", "key_id": "..."}' />
        <button
          className="btn"
          style={{ marginTop: 6 }}
          onClick={() => {
            try { void verify(JSON.parse(pasted)) } catch { setRes({ valid: false, reason: 'malformed', key_id: null, limitations: VERIFY_LIMITATIONS, fromCache: false, fetchedAt: null }) }
          }}
        >Verify</button>
      </details>
    </section>
  )
}

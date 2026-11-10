'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Lang, WorkflowId } from '@/lib/types'
import { ApiError, api, apiAudio, apiUpload } from '@/lib/client/api'
import type { DraftView, ReadyInfo, SessionView, SignedRecord } from '@/lib/client/types'
import { LANG_OPTIONS, PLANNED_GROUPS, STEPS, WORKFLOW_CARDS, MATURITY, stepIndex, tr, uiLangOf } from '@/lib/client/copy'
import { startRecording, type RecorderHandle, type RecordingResult } from '@/lib/client/wav'
import DraftPanel from './DraftPanel'
import Receipt, { clearCachedKeys } from './Receipt'

type Screen = 'start' | 'session' | 'replay'
interface Replay {
  note: string
  generatedAt: string
  workflow: WorkflowId
  steps: Array<{ say: string; notice: string | null; draft: DraftView }>
  readback: { lines: string[]; checks: string[] }
  record: SignedRecord
  keys: Record<string, string>
}
interface Telemetry { audioMs: number; peak: number; clipped: boolean; path: string; sttMs: number | null; detected: string | null }
const OFFLINE_KEY = 'vk_offline_v1'

function fmtLeft(ms: number): string {
  if (ms <= 0) return '0:00'
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong.')

export default function App() {
  const [screen, setScreen] = useState<Screen>('start')
  const [ready, setReady] = useState<ReadyInfo | null>(null)
  const [readyErr, setReadyErr] = useState(false)
  const [online, setOnline] = useState(true)

  const [lang, setLang] = useState<Lang>('hinglish')
  const [workflow, setWorkflow] = useState<WorkflowId>('money_order')
  const ui = uiLangOf(lang)

  const [token, setToken] = useState<string | null>(null)
  const [session, setSession] = useState<SessionView | null>(null)
  const [draft, setDraft] = useState<DraftView | null>(null)
  const [record, setRecord] = useState<SignedRecord | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'err' | 'info' | 'good'; text: string } | null>(null)
  const [ack, setAck] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const [rec, setRec] = useState<RecorderHandle | null>(null)
  const [level, setLevel] = useState(0)
  const [clipNow, setClipNow] = useState(false)
  const [rawMic, setRawMic] = useState(false)
  const [tele, setTele] = useState<Telemetry | null>(null)
  const [voiceLabel, setVoiceLabel] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioCache = useRef(new Map<string, string>())
  const idemRef = useRef<{ k: string; v: string } | null>(null)
  const toggleRef = useRef<() => Promise<void>>(async () => undefined)

  const [replay, setReplay] = useState<Replay | null>(null)
  const [replayStep, setReplayStep] = useState(0)
  const [offlineDrafts, setOfflineDrafts] = useState<string[]>([])

  /* ---------- boot: readiness (non-billable), online status, offline drafts ---------- */
  useEffect(() => {
    let alive = true
    api<ReadyInfo>('/api/ready').then((r) => alive && setReady(r)).catch(() => alive && setReadyErr(true))
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    setOnline(navigator.onLine)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    try { setOfflineDrafts(JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]')) } catch { /* ignore */ }
    return () => { alive = false; window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  useEffect(() => () => { audioRef.current?.pause(); audioCache.current.forEach((u) => URL.revokeObjectURL(u)) }, [])

  const left = session ? Date.parse(session.expiresAt) - now : 0
  const expired = !!session && session.state !== 'committed' && left <= 0
  const closed = !session || ['committed', 'cancelled', 'expired'].includes(session.state) || expired
  const isLive = session?.mode === 'live'

  /* ---------- helpers ---------- */
  const apply = useCallback((r: { session?: SessionView; draft?: DraftView | null; notice?: string | null }) => {
    if (r.session) setSession(r.session)
    if (r.draft !== undefined) setDraft(r.draft)
    if (r.notice) setMsg({ kind: 'info', text: r.notice })
  }, [])
  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setMsg(null)
    try { await fn() } catch (e) { setMsg({ kind: 'err', text: errMsg(e) }) } finally { setBusy(null) }
  }, [])

  function stopAudio() {
    audioRef.current?.pause()
    audioRef.current = null
    setPlaying(false)
  }
  function resetAll() {
    stopAudio()
    rec?.cancel()
    setRec(null)
    audioCache.current.forEach((u) => URL.revokeObjectURL(u))
    audioCache.current.clear()
    setToken(null); setSession(null); setDraft(null); setRecord(null); setText(''); setMsg(null); setAck(false)
    setTele(null); setVoiceLabel(null); setReplay(null); setReplayStep(0); idemRef.current = null
    setScreen('start')
  }
  function clearDevice() {
    resetAll()
    try { localStorage.removeItem(OFFLINE_KEY) } catch { /* ignore */ }
    clearCachedKeys()
    setOfflineDrafts([])
    setMsg({ kind: 'good', text: 'Cleared this session, cached keys and offline drafts from this device.' })
  }

  /* ---------- session ---------- */
  async function begin(wantLive: boolean) {
    await run('start', async () => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'
      const r = await api<{ token: string; session: SessionView }>('/api/session', { body: { workflow, lang, tz, wantLive } })
      setToken(r.token); setSession(r.session); setDraft(null); setRecord(null); setAck(false); setTele(null); setVoiceLabel(null)
      setScreen('session')
    })
  }
  async function send(raw: string) {
    if (!token || !session) return
    const t = raw.trim()
    if (!t) return
    if (!online) {
      const next = [...offlineDrafts, t].slice(-5)
      setOfflineDrafts(next)
      try { localStorage.setItem(OFFLINE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      setText('')
      setMsg({ kind: 'info', text: 'Offline - not submitted. Your text is saved on this device only and has not been checked.' })
      return
    }
    await run('send', async () => {
      const r = await api<{ session: SessionView; draft: DraftView | null; notice: string | null }>(`/api/session/${session.id}/utterance`, { token, body: { text: t } })
      apply(r); setText(''); setAck(false)
    })
  }
  async function edit(field: string, value: string) {
    if (!token || !session) return
    await run('edit', async () => {
      const r = await api<{ session: SessionView; draft: DraftView }>(`/api/session/${session.id}/edit`, { token, body: { field, value } })
      apply(r); setAck(false)
      setMsg({ kind: 'info', text: 'Changed. This is a new version, so the readback must be done again.' })
    })
  }
  async function readback() {
    if (!token || !session) return
    await run('readback', async () => {
      const r = await api<{ session: SessionView; draft: DraftView }>(`/api/session/${session.id}/readback`, { token, body: {} })
      apply(r); setAck(false)
    })
  }
  async function confirmNow() {
    if (!token || !session || !draft) return
    await run('confirm', async () => {
      const k = `${draft.version}:${draft.digest}`
      if (idemRef.current?.k !== k) idemRef.current = { k, v: `${session.id}:${k}:${crypto.randomUUID()}` }
      const r = await api<{ session: SessionView; record: SignedRecord; duplicate: boolean }>(`/api/session/${session.id}/confirm`, {
        token,
        body: { version: draft.version, digest: draft.digest, criticalAck: ack, idempotencyKey: idemRef.current.v },
      })
      setSession(r.session); setRecord(r.record)
      setMsg({ kind: 'good', text: r.duplicate ? 'This record was already confirmed; showing the same record.' : 'Confirmed and signed.' })
    })
  }
  async function cancelNow() {
    if (!token || !session) return
    await run('cancel', async () => {
      const r = await api<{ session: SessionView }>(`/api/session/${session.id}/cancel`, { token, body: {} })
      setSession(r.session); setMsg({ kind: 'info', text: 'Cancelled. Nothing was recorded.' })
    })
  }

  /* ---------- audio out (cached per version so replays cost nothing) ---------- */
  async function play(kind: 'readback' | 'question' | 'narrate') {
    if (!token || !session) return
    const key = kind === 'narrate' ? `n:${session.committedRecordId}` : `${kind}:${draft?.version}:${draft?.digest}`
    stopAudio()
    await run('audio', async () => {
      let url = audioCache.current.get(key)
      if (!url) {
        const path = kind === 'narrate' ? 'narrate' : 'tts'
        const { blob, headers } = await apiAudio(`/api/session/${session.id}/${path}`, token, kind === 'narrate' ? {} : { target: kind })
        url = URL.createObjectURL(blob)
        audioCache.current.set(key, url)
        if (kind === 'narrate') setVoiceLabel('Playing a synthetic approved voice. The record content digest is unchanged; only the narration voice differs.')
        else setVoiceLabel(headers.get('X-VK-Voice') === 'standard-synthetic' ? 'Playing a synthetic standard voice.' : null)
        // refresh the playback counters (read-only; no state change)
        api<{ session: SessionView }>(`/api/session/${session.id}`, { token }).then((r) => setSession(r.session)).catch(() => undefined)
      } else if (kind === 'narrate') setVoiceLabel('Playing a synthetic approved voice (cached; no new provider call).')
      else setVoiceLabel('Playing a synthetic standard voice (cached; no new provider call).')
      const a = new Audio(url)
      audioRef.current = a
      a.onended = () => setPlaying(false)
      a.onerror = () => { setPlaying(false); setMsg({ kind: 'err', text: 'Could not play this audio. Read the text instead.' }) }
      setPlaying(true)
      await a.play()
    })
  }

  /* ---------- recording (push-to-talk) ---------- */
  async function toggleRec() {
    if (rec) {
      const h = rec
      setRec(null); setLevel(0)
      await run('stt', async () => {
        const out: RecordingResult = await h.stop()
        if (out.durationMs < 350) throw new Error('That was too short. Hold the mic a little longer and speak clearly.')
        if (!token || !session) return
        const form = new FormData()
        form.append('audio', out.blob, 'turn.wav')
        form.append('durationMs', String(Math.round(out.durationMs)))
        const t0 = performance.now()
        const r = await apiUpload<{ transcript: string; detectedLanguage: string | null; notice: string | null; session: SessionView; draft: DraftView | null }>(`/api/session/${session.id}/stt`, token, form)
        setTele({ audioMs: out.durationMs, peak: out.peak, clipped: out.clipped, path: rawMic ? 'raw microphone (no browser processing)' : 'browser echo cancel + noise suppression', sttMs: Math.round(performance.now() - t0), detected: r.detectedLanguage })
        apply(r); setAck(false)
        if (out.clipped) setMsg({ kind: 'info', text: 'The microphone clipped (too loud). Move back slightly - clipping can change numbers.' })
      })
      return
    }
    stopAudio()
    try {
      const h = await startRecording({
        browserProcessing: !rawMic,
        maxMs: 19_000, // stay under the server's 20 s limit so rounding can never reject a clip
        onLevel: (p, c) => { setLevel(p); setClipNow(c) },
        onAutoStop: () => { void toggleRef.current() },
      })
      setRec(h)
      setMsg(null)
    } catch (e) {
      const name = (e as DOMException)?.name
      setMsg({ kind: 'err', text: name === 'NotAllowedError' ? 'Microphone permission was denied. You can still type your message.' : errMsg(e) })
    }
  }

  toggleRef.current = toggleRec // always points at the latest closure so auto-stop finishes the clip and submits it

  /* ---------- replay ---------- */
  async function openReplay() {
    await run('replay', async () => {
      const r = await fetch('/replay.json', { cache: 'no-store' })
      if (!r.ok) throw new Error('The prerecorded example is not available.')
      setReplay((await r.json()) as Replay)
      setReplayStep(0)
      setScreen('replay')
    })
  }

  /* ---------- derived ---------- */
  const step = session ? stepIndex(session.state, !!draft, draft?.status) : 0
  const liveReason = ready?.live.reason
  const canConfirm = !!draft && draft.readbackDone && draft.committable && draft.status === 'ready' && (!draft.requiresCriticalAck || ack) && !closed
  const cardOf = WORKFLOW_CARDS.find((c) => c.id === workflow)!

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      {!online ? <div className="banner off" role="status">Offline - not submitted. You can read what is on screen; nothing new can be checked or recorded.</div> : null}
      {screen === 'replay' ? <div className="banner replay" role="status">Prerecorded example - not live. Generated {replay?.generatedAt ? replay.generatedAt.slice(0, 10) : ''} with synthetic data.</div> : null}
      {readyErr && screen === 'start' ? <div className="banner off" role="status">The server is not answering right now. The prerecorded example still works.</div> : null}

      <div className="shell">
        <header className="top">
          <div className="brand">
            <div className="logo" aria-hidden="true">🛡</div>
            <div>
              <h1>VAANI KAVACH</h1>
              <p>{tr('sub', ui)}</p>
            </div>
          </div>
          <div className="chips" aria-label="Status">
            {screen === 'replay' ? <span className="chip warn"><span className="dot" />Prerecorded example</span>
              : session ? (isLive ? <span className="chip ok"><span className="dot" />Live voice</span> : <span className="chip warn"><span className="dot" />Text mode</span>)
              : ready ? (ready.live.available ? <span className="chip ok"><span className="dot" />Live voice available</span> : <span className="chip warn"><span className="dot" />Text mode only</span>)
              : <span className="chip"><span className="dot" />Checking...</span>}
            {ready?.clone.available ? <span className="chip ok"><span className="dot" />Approved voice on</span> : <span className="chip"><span className="dot" />Approved voice off</span>}
            {session && !closed ? <span className="chip" aria-live="off">⏱ {fmtLeft(left)}</span> : null}
            <button className="btn" onClick={clearDevice} title={tr('resetDevice', ui)} aria-label={tr('resetDevice', ui)}>🧹</button>
          </div>
        </header>

        <main id="main" tabIndex={-1}>
          <div aria-live="polite" className="sr-only">{msg?.text ?? ''}</div>

          {screen === 'start' ? (
            <>
              <section className="hero" aria-labelledby="hero-h">
                <div>
                  <h2 id="hero-h">{tr('tagline', ui)}</h2>
                  <p className="lead">
                    {ui === 'hi'
                      ? 'हिन्दी/हिंग्लिश में बोली गई बात को चेक किए हुए ऑर्डर, रिक्वेस्ट और हैंडओवर में बदलिए। आपके पक्का करने से पहले कुछ भी रिकॉर्ड नहीं होता।'
                      : 'Turn noisy Hindi/Hinglish speech into checked orders, requests and handovers. Nothing becomes a record until you confirm the exact version that was read back.'}
                  </p>
                  <div className="row" style={{ marginTop: 14 }}>
                    <a className="btn primary big" href="#pick">{tr('start', ui)} →</a>
                    <button className="btn big" onClick={openReplay} disabled={busy === 'replay'}>▶ {ui === 'hi' ? 'पहले से रिकॉर्ड किया उदाहरण' : 'Prerecorded example'}</button>
                  </div>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="wave">{Array.from({ length: 38 }, (_, i) => <i key={i} style={{ animationDuration: `${1 + ((i * 37) % 9) / 10}s` }} />)}</div>
                  <div className="chain">{['Speak', 'Transcribe', 'Structure', 'Validate', 'Read back', 'Confirm', 'Sign'].map((s, i) => <span key={s} className={i === 4 || i === 5 ? 'on' : ''}>{s}</span>)}</div>
                  <p className="limits" style={{ marginTop: 14 }}>“Fifteen” is not “fifty”. “Advance” is not “paid in full”. Vaani Kavach makes you check.</p>
                </div>
              </section>

              <section id="pick" aria-labelledby="pick-h" style={{ marginTop: 26 }}>
                <h2 id="pick-h" style={{ fontSize: '1.2rem' }}>{tr('chooseTask', ui)}</h2>
                <div className="grid cards" role="group" aria-label="Workflow">
                  {WORKFLOW_CARDS.map((c) => (
                    <button key={c.id} className="wf" aria-pressed={workflow === c.id} onClick={() => setWorkflow(c.id)}>
                      <div className="ic" aria-hidden="true">{c.icon}</div>
                      <h3>{ui === 'hi' ? c.hi : c.en}</h3>
                      <p>{c.hint}</p>
                      <span className={`badge ${MATURITY[c.maturity].cls}`}>{MATURITY[c.maturity].icon} {MATURITY[c.maturity].label}</span>
                    </button>
                  ))}
                </div>
                <div className="card" style={{ marginTop: 14 }}>
                  <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
                    <div>
                      <label htmlFor="lang">{tr('language', ui)}</label>
                      <select id="lang" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                        {LANG_OPTIONS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                      </select>
                      {LANG_OPTIONS.find((l) => l.id === lang)?.note ? <p className="limits">{LANG_OPTIONS.find((l) => l.id === lang)?.note}</p> : null}
                    </div>
                    <div>
                      <p className="limits" style={{ marginTop: 22 }}>
                        {ready ? (ready.live.available
                          ? <>🎙 Live voice is available (one session at a time, up to {Math.round((ready.limits.sessionSeconds) / 60)} min, {ready.limits.maxTurns} spoken turns, {ready.limits.maxAudioSeconds}s each). Text always works.</>
                          : <>⌨ Text mode: {liveReason ?? 'live voice is not available'} The same checking engine runs; only paid speech services are off.</>) : 'Checking availability...'}
                      </p>
                    </div>
                  </div>
                  <div className="row" style={{ marginTop: 12 }}>
                    <button className="btn primary big" onClick={() => begin(true)} disabled={busy === 'start'}>{tr('start', ui)}</button>
                    {ready?.live.available ? <button className="btn" onClick={() => begin(false)} disabled={busy === 'start'}>Text only</button> : null}
                  </div>
                  {msg ? <div className={`notice ${msg.kind === 'err' ? 'err' : msg.kind}`} role="status">{msg.text}</div> : null}
                  {offlineDrafts.length ? (
                    <div className="notice info">Offline drafts on this device (unchecked, never submitted): {offlineDrafts.length}. Start a session and paste them, or clear the device above.</div>
                  ) : null}
                </div>
              </section>

              <section aria-labelledby="plan-h" style={{ marginTop: 26 }}>
                <h2 id="plan-h" style={{ fontSize: '1.1rem' }}>One engine, many people</h2>
                <p className="limits">The engine is shared; occupations are workflow packs. Only the five cards above are implemented. The groups below are the <strong>planned</strong> expansion surface, not finished products.</p>
                <div className="planned">{PLANNED_GROUPS.map((g) => <span key={g}>○ Planned · {g}</span>)}</div>
              </section>
            </>
          ) : null}

          {screen === 'session' && session ? (
            <>
              <ol className="stepper" aria-label="Progress">
                {STEPS.map((s, i) => <li key={s} className={i < step ? 'done' : i === step ? 'now' : ''} aria-current={i === step ? 'step' : undefined}>{i < step ? '✓ ' : ''}{s}</li>)}
              </ol>

              {!isLive && session.modeReason ? <div className="notice info" role="status">⌨ {session.modeReason}</div> : null}
              {expired ? <div className="notice err" role="alert">This session has expired. Start over - nothing was recorded.</div> : null}
              {session.state === 'cancelled' ? <div className="notice info" role="status">This session was cancelled. Nothing was recorded.</div> : null}
              {msg ? <div className={`notice ${msg.kind === 'err' ? 'err' : msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</div> : null}

              <div className="layout">
                <div className="grid">
                  <section className="card" aria-labelledby="in-h">
                    <h2 id="in-h" style={{ margin: '0 0 8px', fontSize: '1.05rem' }}>{ui === 'hi' ? WORKFLOW_CARDS.find((c) => c.id === session.workflow)?.hi : WORKFLOW_CARDS.find((c) => c.id === session.workflow)?.en}</h2>
                    {session.utterances.map((u) => (
                      <div key={u.id} className="bubble"><small>{u.source === 'stt' ? '🎙 heard' : '⌨ typed'}{u.detectedLanguage ? ` · ${u.detectedLanguage}` : ''}</small>{u.text}</div>
                    ))}
                    {draft?.question ? <div className="bubble sys"><small>❓ question</small>{draft.question}
                      {isLive ? <div><button className="edit" disabled={!!busy || playing} onClick={() => play('question')}>🔊 {ui === 'hi' ? 'आवाज़ में सुनें' : 'Hear it'}</button></div> : null}</div> : null}

                    {!closed ? (
                      <>
                        <label htmlFor="msg" style={{ marginTop: 8 }}>{tr('typeHere', ui)}</label>
                        <textarea id="msg" value={text} maxLength={600} onChange={(e) => setText(e.target.value)} placeholder={cardOf.example} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send(text) }} />
                        <div className="row" style={{ marginTop: 8 }}>
                          <button className="btn primary" onClick={() => send(text)} disabled={!!busy || !text.trim()}>{tr('send', ui)}</button>
                          {isLive ? (
                            <button className={`btn mic${rec ? ' rec' : ''}`} onClick={toggleRec} disabled={(!!busy && !rec) || session.turns >= session.maxTurns} aria-pressed={!!rec} aria-label={rec ? tr('stopRecord', ui) : tr('record', ui)}>{rec ? '■' : '🎙'}</button>
                          ) : null}
                          <button className="btn" onClick={() => setText(cardOf.example)} disabled={!!busy}>{ui === 'hi' ? 'उदाहरण भरें' : 'Fill example'}</button>
                          <button className="btn danger" onClick={cancelNow} disabled={!!busy}>{tr('cancel', ui)}</button>
                        </div>
                        {isLive ? (
                          <>
                            <div className="meter" aria-hidden="true"><b style={{ width: `${Math.min(100, Math.round(level * 100))}%` }} /></div>
                            <p className="limits">
                              {rec ? (clipNow ? '⚠ Too loud - clipping' : 'Recording... press ■ when done (it stops by itself at 19 s).') : `Spoken turns: ${session.turns}/${session.maxTurns}. Push-to-talk; nothing is recorded until you press the mic.`}
                            </p>
                            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={rawMic} disabled={!!rec} onChange={(e) => setRawMic(e.target.checked)} /> Raw microphone (bypass browser noise processing)</label>
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </section>
                </div>

                <div className="grid">
                  {draft ? (
                    <section className="card" aria-label="Draft">
                      <DraftPanel draft={draft} ui={ui} onEdit={!closed && draft.committable ? edit : undefined} busy={!!busy} />
                      {!closed && draft.status === 'ready' ? (
                        <div style={{ marginTop: 12 }}>
                          {!draft.readbackDone ? (
                            <button className="btn primary big" onClick={readback} disabled={!!busy}>{tr('readback', ui)}</button>
                          ) : (
                            <div className="notice info" role="region" aria-label="Readback">
                              <strong>{ui === 'hi' ? 'पढ़कर सुनाया गया' : 'Readback'} (v{draft.version})</strong>
                              <ul className="readback">{draft.readback?.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                              {draft.checks.length ? <p><strong>Please check:</strong> {draft.checks.join(' ')}</p> : null}
                              {draft.readback?.note ? <p className="limits">{draft.readback.note}</p> : null}
                              <p className="digest">digest {draft.digest}</p>
                              <div className="row">
                                {isLive ? <button className="btn" disabled={!!busy || playing} onClick={() => play('readback')}>🔊 {tr('playReadback', ui)}</button> : <span className="limits">Text readback is authoritative. Voice playback needs live mode.</span>}
                                {playing ? <button className="btn" onClick={stopAudio}>⏹ Stop</button> : null}
                                <button className="btn" onClick={readback} disabled={!!busy}>↻</button>
                              </div>
                            </div>
                          )}
                          {draft.readbackDone && draft.committable ? (
                            <div style={{ marginTop: 10 }}>
                              {draft.requiresCriticalAck ? (
                                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: 'var(--text)', fontSize: '0.95rem' }}>
                                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ width: 22, height: 22, marginTop: 2 }} />
                                  <span>{tr('ack', ui)}</span>
                                </label>
                              ) : null}
                              <button className="btn go big" style={{ marginTop: 8 }} disabled={!canConfirm || !!busy} onClick={confirmNow}>✔ {tr('confirm', ui)}</button>
                              <p className="limits">Voice cannot confirm. Only this button can, and only for the version shown above.</p>
                            </div>
                          ) : null}
                          {draft.readbackDone && !draft.committable ? <p className="limits">Review-only: this never creates a record. It is a caution note, not a safety certificate.</p> : null}
                        </div>
                      ) : null}
                    </section>
                  ) : (
                    <section className="card"><p className="limits">{ui === 'hi' ? 'पहले अपनी बात लिखिए या बोलिए। मैं जो समझूँगा यहाँ दिखाऊँगा।' : 'Say or type something first. What I understood will appear here, with the exact words I based it on.'}</p></section>
                  )}

                  {record ? (
                    <Receipt
                      record={record}
                      ui={ui}
                      voiceLabel={voiceLabel}
                      onStandard={isLive ? () => play('readback') : undefined}
                      canNarrate={isLive && !!ready?.clone.available && !session.cloneUsed}
                      onNarrate={() => play('narrate')}
                      narrating={!!busy || playing}
                    />
                  ) : null}

                  <details className="card how">
                    <summary>How this was processed</summary>
                    <dl className="kv">
                      <dt>Mode</dt><dd>{isLive ? 'Live voice (recorded-turn upload)' : 'Text mode (no paid speech services)'}</dd>
                      <dt>Speech model</dt><dd>{isLive ? ready?.live.sttModel : 'not used'}</dd>
                      <dt>Extractor</dt><dd>Deterministic rules with exact-text evidence (no language model decides anything)</dd>
                      <dt>Spoken turns</dt><dd>{session.turns}/{session.maxTurns}</dd>
                      <dt>Voice playbacks</dt><dd>{session.ttsCalls}/{session.maxTtsCalls}{session.cloneUsed ? ' · approved voice used' : ''}</dd>
                      <dt>Storage</dt><dd>{ready ? `${ready.storage.kind}${ready.storage.durable ? ' (durable)' : ' (not durable: lost on restart)'}` : '-'}</dd>
                      <dt>Budget left</dt><dd>{ready?.budget ? `${ready.budget.remaining}/${ready.budget.cap} application credit units${ready.budget.tariffCalibrated ? '' : ' (uncalibrated placeholders, not Gnani tariffs)'}` : '-'}</dd>
                      {tele ? <>
                        <dt>Last clip</dt><dd>{(tele.audioMs / 1000).toFixed(1)} s · peak {Math.round(tele.peak * 100)}% · {tele.clipped ? 'clipped' : 'no clipping'}</dd>
                        <dt>Cleanup path</dt><dd>{tele.path}</dd>
                        <dt>Round trip</dt><dd>{tele.sttMs} ms{tele.detected ? ` · text script ${tele.detected}` : ''}</dd>
                      </> : null}
                    </dl>
                    <p className="limits">No word-confidence, dialect, anonymity or scam-probability scores are shown because the speech service does not provide them.</p>
                  </details>
                  <div className="row"><button className="btn" onClick={resetAll}>{tr('newSession', ui)}</button></div>
                </div>
              </div>
            </>
          ) : null}

          {screen === 'replay' && replay ? (
            <ReplayView replay={replay} step={replayStep} setStep={setReplayStep} ui={ui} onExit={resetAll} />
          ) : null}
        </main>

        <footer className="foot">
          Vaani Kavach is a verification layer, not an authority. It checks what was said, never what is true. Demo data is synthetic. Do not enter real phone, account, Aadhaar or PAN numbers.
        </footer>
      </div>
    </>
  )
}

function ReplayView({ replay, step, setStep, ui, onExit }: { replay: Replay; step: number; setStep: (n: number) => void; ui: 'hi' | 'en'; onExit: () => void }) {
  const total = replay.steps.length
  const showReadback = step >= total
  const showRecord = step >= total + 1
  const cur = replay.steps[Math.min(step, total - 1)]
  return (
    <div className="layout">
      <section className="card" aria-labelledby="rp-h">
        <h2 id="rp-h" style={{ margin: '0 0 6px' }}>{ui === 'hi' ? 'पहले से रिकॉर्ड किया उदाहरण' : 'Prerecorded example'}</h2>
        <p className="limits">{replay.note}</p>
        {replay.steps.slice(0, Math.min(step + 1, total)).map((s, i) => (
          <div key={i} className="bubble"><small>{i === 0 ? 'said' : 'correction'}</small>{s.say}{s.notice ? <div className="limits">→ {s.notice}</div> : null}</div>
        ))}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary" disabled={step >= total + 1} onClick={() => setStep(step + 1)}>{step < total - 1 ? 'Next: correction →' : step === total - 1 ? 'Next: read it back →' : step === total ? 'Next: confirm →' : 'Done'}</button>
          <button className="btn" onClick={() => setStep(0)} disabled={step === 0}>↺ Restart</button>
          <button className="btn" onClick={onExit}>Exit</button>
        </div>
      </section>
      <div className="grid">
        <section className="card"><DraftPanel draft={cur.draft} ui={ui} /></section>
        {showReadback ? (
          <section className="card notice info" aria-label="Readback">
            <strong>Readback</strong>
            <ul className="readback">{replay.readback.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            {replay.readback.checks.length ? <p><strong>Please check:</strong> {replay.readback.checks.join(' ')}</p> : null}
          </section>
        ) : null}
        {showRecord ? <Receipt record={replay.record} ui={ui} replayKeys={replay.keys} /> : null}
      </div>
    </div>
  )
}

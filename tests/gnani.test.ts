import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryStore } from '@/lib/store'
import { transcribe, synthesize, synthesizeClone, createEmbedding, setFetchForTests } from '@/lib/gnani'
import { runProvider } from '@/lib/provider'
import { summary, adminView } from '@/lib/budget'
import { wavSeconds } from '@/lib/audio'
import { encryptJson, decryptJson } from '@/lib/crypto'
import { consentState, loadEmbedding, revokeConsent, recordConsent } from '@/lib/voice'

const env = { ...process.env }
let calls: Array<{ url: string; init: RequestInit }> = []
const audio = (n = 200) => new Uint8Array(n).fill(7)
function mock(fn: (url: string, init: RequestInit) => Response | Promise<Response>) {
  setFetchForTests((async (url: string, init: RequestInit) => { calls.push({ url, init }); return fn(url, init) }) as unknown as typeof fetch)
}
beforeEach(() => { calls = []; process.env = { ...env, GNANI_API_KEY: 'test-key-123' } })
afterEach(() => { setFetchForTests(null); process.env = { ...env } })

describe('STT adapter (Prisma v3.0 REST contract)', () => {
  it('sends the documented multipart fields and header; never the key in the body', async () => {
    mock(() => Response.json({ success: true, request_id: 'r1', transcript: 'do bag 420 rupees', model: 'prisma-v3.0', detected_language_code: 'hi-IN' }))
    const r = await transcribe({ audio: audio(), filename: 'turn.wav', mime: 'audio/wav', lang: 'hinglish', workflow: 'money_order' })
    expect(r.ok && r.value.transcript).toBe('do bag 420 rupees')
    expect(r.ok && r.value.detectedLanguage).toBe('hi-IN')
    const c = calls[0]
    expect(c.url).toBe('https://api.vachana.ai/stt/v3')
    expect((c.init.headers as Record<string, string>)['X-API-Key-ID']).toBe('test-key-123')
    const f = c.init.body as FormData
    expect(f.get('model')).toBe('prisma-v3.0')
    expect(f.get('language_code')).toBe('hi-IN,en-IN')
    expect(f.get('format')).toBe('transcribe')
    expect(JSON.parse(String(f.get('keyterms')))).toContain('advance')
    expect(f.get('audio_file')).toBeInstanceOf(Blob)
    // the API key travels only in the X-API-Key-ID header, never inside the multipart body
    for (const [, v] of f.entries()) if (typeof v === 'string') expect(v).not.toContain('test-key-123')
    expect([...f.keys()]).not.toContain('api_key')
  })

  it('maps the three error shapes and treats timeouts as NOT definite', async () => {
    mock(() => Response.json({ success: false, error: { type: 'MAX_AUDIO_DURATION_EXCEEDED', message: 'too long' } }, { status: 400 }))
    let r = await transcribe({ audio: audio(), filename: 'a.wav', mime: 'audio/wav', lang: 'en', workflow: 'handover' })
    expect(!r.ok && r.code).toBe('MAX_AUDIO_DURATION_EXCEEDED')
    expect(!r.ok && r.definite).toBe(true)

    mock(() => Response.json({ detail: { error_code: 'RATE_LIMITED', message: 'slow down' } }, { status: 429 }))
    r = await transcribe({ audio: audio(), filename: 'a.wav', mime: 'audio/wav', lang: 'en', workflow: 'handover' })
    expect(!r.ok && r.code).toBe('RATE_LIMITED')

    mock(() => Response.json({ detail: [{ msg: 'Field required' }] }, { status: 422 }))
    r = await transcribe({ audio: audio(), filename: 'a.wav', mime: 'audio/wav', lang: 'en', workflow: 'handover' })
    expect(!r.ok && r.code).toBe('VALIDATION')

    mock(() => Response.json({ code: 'UPSTREAM_TIMEOUT' }, { status: 504 }))
    r = await transcribe({ audio: audio(), filename: 'a.wav', mime: 'audio/wav', lang: 'en', workflow: 'handover' })
    expect(!r.ok && r.definite).toBe(false)

    mock(() => { throw Object.assign(new Error('x'), { name: 'AbortError' }) })
    r = await transcribe({ audio: audio(), filename: 'a.wav', mime: 'audio/wav', lang: 'en', workflow: 'handover' })
    expect(!r.ok && r.code).toBe('TIMEOUT')
    expect(!r.ok && r.definite).toBe(false)
  })

  it('empty transcript is returned as-is (not an error)', async () => {
    mock(() => Response.json({ success: true, request_id: 'r', transcript: '' }))
    const r = await transcribe({ audio: audio(), filename: 'a.wav', mime: 'audio/wav', lang: 'en', workflow: 'handover' })
    expect(r.ok && r.value.transcript).toBe('')
  })
})

describe('TTS + voice-clone adapters', () => {
  it('standard TTS body follows the Timbre contract', async () => {
    mock(() => new Response(audio(500), { headers: { 'content-type': 'audio/mpeg' } }))
    const r = await synthesize('hello', 'hi-en')
    expect(r.ok && r.value.contentType).toBe('audio/mpeg')
    const b = JSON.parse(String(calls[0].init.body))
    expect(calls[0].url).toBe('https://api.vachana.ai/api/v1/tts/inference')
    expect(b).toMatchObject({ text: 'hello', model: 'timbre-v3.0', voice: 'Shivani', language: 'hi-en' })
    expect(b.speed).toBeGreaterThanOrEqual(0.85)
    expect(b.speed).toBeLessThanOrEqual(1.15)
    expect(b.audio_config.container).toBe('mp3')
  })

  it('embedding is preserved exactly as returned; clone request carries it unchanged', async () => {
    const emb = { embedding: 'QUJD+/=', shape: [1, 768], dtype: 'torch.bfloat16' }
    mock(() => Response.json({ success: true, message: 'ok', data: { voice_clone_embedding: emb } }))
    const e = await createEmbedding({ audio: audio(5000), filename: 'ref.wav', mime: 'audio/wav' })
    expect(e.ok && e.value).toEqual(emb)
    expect(calls[0].url).toBe('https://api.vachana.ai/api/v1/tts/voice-clone/embeddings')

    mock(() => new Response(audio(500), { headers: { 'content-type': 'audio/mpeg' } }))
    const a = await synthesizeClone('approved text', emb)
    expect(a.ok).toBe(true)
    const b = JSON.parse(String(calls[1].init.body))
    expect(b.speaker_embedding).toEqual(emb)
    expect(b.model).toBeUndefined() // implied by speaker_embedding per the docs
  })

  it('rejects a JSON body or tiny payload posing as audio', async () => {
    mock(() => Response.json({ oops: true }))
    expect((await synthesize('x', 'en-IN')).ok).toBe(false)
    mock(() => new Response(new Uint8Array(3), { headers: { 'content-type': 'audio/mpeg' } }))
    expect((await synthesize('x', 'en-IN')).ok).toBe(false)
  })

  it('malformed embedding response is a non-definite failure', async () => {
    mock(() => Response.json({ success: true, data: {} }))
    const e = await createEmbedding({ audio: audio(5000), filename: 'r.wav', mime: 'audio/wav' })
    expect(!e.ok && e.code).toBe('BAD_RESPONSE')
  })
})

describe('provider wrapper keeps the budget honest', () => {
  it('success spends; rejected (4xx) releases; timeout stays reserved; no automatic retry', async () => {
    const store = new MemoryStore()
    mock(() => Response.json({ success: true, request_id: 'r', transcript: 'ok' }))
    const ok = await runProvider(store, 'stt', () => transcribe({ audio: audio(), filename: 'a.wav', mime: 'audio/wav', lang: 'en', workflow: 'handover' }))
    expect(ok.ok).toBe(true)
    expect((await summary(store)).remaining).toBe(597)

    calls = []
    mock(() => Response.json({ detail: { error_code: 'RATE_LIMITED', message: 'x' } }, { status: 429 }))
    const rl = await runProvider(store, 'stt', () => transcribe({ audio: audio(), filename: 'a.wav', mime: 'audio/wav', lang: 'en', workflow: 'handover' }))
    expect(!rl.ok && rl.status).toBe(429)
    expect(calls.length).toBe(1) // exactly one attempt
    expect((await summary(store)).remaining).toBe(597) // released

    mock(() => { throw Object.assign(new Error('t'), { name: 'AbortError' }) })
    const to = await runProvider(store, 'stt', () => transcribe({ audio: audio(), filename: 'a.wav', mime: 'audio/wav', lang: 'en', workflow: 'handover' }))
    expect(!to.ok && to.message).toMatch(/not retried/i)
    expect((await summary(store)).remaining).toBe(594)
    expect((await adminView(store)).uncertain).toHaveLength(1)
  })

  it('exhausted pool blocks the provider call entirely', async () => {
    process.env.POOL_PUBLIC_CAP = '2'
    const store = new MemoryStore()
    mock(() => Response.json({ success: true, transcript: 'x' }))
    const r = await runProvider(store, 'stt', () => transcribe({ audio: audio(), filename: 'a.wav', mime: 'audio/wav', lang: 'en', workflow: 'handover' }))
    expect(!r.ok && r.code).toBe('budget_exhausted')
    expect(calls.length).toBe(0)
  })

  it('auth failure message never echoes the key', async () => {
    const store = new MemoryStore()
    mock(() => Response.json({ detail: { error_code: 'INVALID_API_KEY', message: 'Unauthorized test-key-123' } }, { status: 401 }))
    const r = await runProvider(store, 'tts', () => synthesize('x', 'en-IN'))
    expect(JSON.stringify(r)).not.toContain('test-key-123')
  })
})

describe('voice consent', () => {
  const keyHex = 'ab'.repeat(32)
  it('is inactive by default; active only with env consent + sealed artifact; revocation blocks immediately', async () => {
    const store = new MemoryStore()
    expect((await consentState(store)).active).toBe(false)
    const emb = { embedding: 'AAA', shape: [1, 768], dtype: 'torch.bfloat16' }
    const sealed = await encryptJson(emb, keyHex)
    expect(sealed).not.toContain('AAA')
    process.env.VOICE_ENC_KEY = keyHex
    process.env.VOICE_EMBEDDING_ENC = sealed
    process.env.VOICE_CONSENT_ENV = 'active'
    await recordConsent(store, 'approved-record narration')
    expect((await consentState(store)).active).toBe(true)
    const l = await loadEmbedding(store)
    expect(l.ok && l.embedding).toEqual(emb)
    await revokeConsent(store)
    expect((await consentState(store)).active).toBe(false)
    expect((await loadEmbedding(store)).ok).toBe(false)
  })
  it('a tampered or wrong-key artifact fails closed', async () => {
    const sealed = await encryptJson({ a: 1 }, keyHex)
    await expect(decryptJson(sealed, 'cd'.repeat(32))).rejects.toBeTruthy()
    process.env.VOICE_ENC_KEY = 'cd'.repeat(32)
    process.env.VOICE_EMBEDDING_ENC = sealed
    process.env.VOICE_CONSENT_ENV = 'active'
    expect((await loadEmbedding(new MemoryStore())).ok).toBe(false)
  })
  it('CLONE_ENABLED=false switches it off even with everything configured', async () => {
    process.env.CLONE_ENABLED = 'false'
    process.env.VOICE_CONSENT_ENV = 'active'
    expect((await consentState(new MemoryStore())).active).toBe(false)
  })
})

describe('wav duration', () => {
  it('computes seconds from a PCM WAV and returns null for non-WAV', () => {
    const rate = 16000
    const data = rate * 2 * 3 // 3 s
    const b = new Uint8Array(44 + data)
    const dv = new DataView(b.buffer)
    b.set([82, 73, 70, 70], 0); dv.setUint32(4, 36 + data, true); b.set([87, 65, 86, 69], 8); b.set([102, 109, 116, 32], 12)
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true)
    b.set([100, 97, 116, 97], 36); dv.setUint32(40, data, true)
    expect(wavSeconds(b)).toBeCloseTo(3, 3)
    expect(wavSeconds(new Uint8Array(100))).toBeNull()
  })
})

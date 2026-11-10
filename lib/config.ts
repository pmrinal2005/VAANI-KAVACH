/** Central, server-side configuration. Never import from client components. */

function num(name: string, dflt: number): number {
  const v = process.env[name]
  if (!v) return dflt
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}

export const POOL_CAPS = {
  contract: 120,
  voice: 180,
  eval: 650,
  integration: 350,
  rehearsal: 500,
  public: 600,
  reserve: 600,
} as const
export type PoolName = keyof typeof POOL_CAPS

export function cfg() {
  const env = process.env
  return {
    gnaniBase: (env.GNANI_BASE_URL || 'https://api.vachana.ai').replace(/\/$/, ''),
    gnaniKey: env.GNANI_API_KEY || '',
    sttModel: env.GNANI_STT_MODEL || 'prisma-v3.0',
    ttsModel: env.GNANI_TTS_MODEL || 'timbre-v3.0',
    ttsVoice: env.GNANI_TTS_VOICE || 'Shivani',
    useKeyterms: env.STT_USE_KEYTERMS !== 'false',
    groqKey: env.GROQ_API_KEY || '',
    groqExtractorModel: env.GROQ_EXTRACTOR_MODEL || 'openai/gpt-oss-20b',
    groqReviewerModel: env.GROQ_REVIEWER_MODEL || 'openai/gpt-oss-120b',
    liveEnabled: env.LIVE_INFERENCE_ENABLED !== 'false',
    cloneEnabled: env.CLONE_ENABLED !== 'false',
    sessionSecret: env.SESSION_SECRET || '',
    signingKeyHex: env.SIGNING_KEY_HEX || '',
    adminToken: env.ADMIN_TOKEN || '',
    voiceEncKeyHex: env.VOICE_ENC_KEY || '',
    voiceEmbeddingEnc: env.VOICE_EMBEDDING_ENC || '',
    voiceConsentEnv: env.VOICE_CONSENT_ENV || 'revoked',
    supabaseUrl: (env.SUPABASE_URL || '').replace(/\/$/, ''),
    supabaseServiceKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
    storeBackend: (env.STORE_BACKEND || (env.SUPABASE_URL ? 'supabase' : 'memory')) as 'memory' | 'supabase',
    // Application policy limits (NOT provider limits).
    sessionMaxSeconds: num('SESSION_MAX_SECONDS', 180),
    maxTurns: num('MAX_TURNS', 4),
    maxAudioSeconds: num('MAX_AUDIO_SECONDS', 20),
    maxAudioBytes: num('MAX_AUDIO_BYTES', 1_000_000),
    maxTextChars: num('MAX_TEXT_CHARS', 600),
    providerTimeoutMs: num('PROVIDER_TIMEOUT_MS', 25_000),
    // Conservative PLACEHOLDER reservations in application credit units.
    // These are NOT Gnani tariffs: calibrate in Phase 0 and override via env.
    costStt: num('COST_STT', 3),
    costTts: num('COST_TTS', 2),
    costVc: num('COST_VC', 4),
    costEmbed: num('COST_EMBED', 6),
    tariffCalibrated: env.TARIFF_CALIBRATED === 'true',
    publicPoolCap: num('POOL_PUBLIC_CAP', POOL_CAPS.public),
  }
}
export type Cfg = ReturnType<typeof cfg>

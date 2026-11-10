# Vaani Kavach - Bharat's Verified Voice Layer

> Speak naturally. Check the meaning. Confirm the action.

A Hindi/Hinglish-first, multilingual **voice-to-action verification** layer. Spoken (or typed) input becomes a typed draft with evidence; the draft is validated, read back from a reviewed template, corrected if needed, and only becomes a signed record after an explicit confirmation of **that exact version and digest**.

Stack: **Next.js 16 (App Router) + TypeScript + Vitest, deployed on Vercel.** No Cloudflare, no Hono.

## Status (honest)
- Text mode: fully working (the whole engine runs with no paid service).
- Live voice (Gnani STT, standard TTS, cloned narration): adapters are implemented against the documented contracts and tested with mocked HTTP. **They have not been exercised against a real Gnani account from this repo.** Set `GNANI_API_KEY` and run the Phase 0 checks before claiming live integration.
- Budget numbers are application credit units, not Gnani tariffs (`TARIFF_CALIBRATED=false` until measured).
- Not implemented: LiveKit realtime transport, RNNoise/WASM denoising, Groq extractor/reviewer roles (the extractor is deterministic rules), Tamil/Bengali native-reviewed readback packs, recipient acknowledgement flow.

## Workflow packs
| Pack | Maturity | Result |
|---|---|---|
| Money or order | Live, tested | Confirmed, signed record (needs second critical confirmation) |
| Service request | Live, tested | "Request prepared", never a booking |
| Instruction or reminder | Live, tested (new) | "Instruction prepared", never claims acknowledgement |
| Handover | Live, tested | Completed / pending / resources / constraints / next owner |
| Risky-message review | Review-only | Caution note, never a safety certificate, never a record |

## Invariants (covered by tests)
Only the server commits; every correction is a new version; readback and confirmation are bound to version + sha256 digest; stale/cancelled/expired cannot commit; confirm is idempotent; a spoken "haan" never commits; a cloned voice never authorizes anything; provider keys and voice embeddings never reach the browser; the reserve budget pool is never spent automatically; uncertain provider timeouts stay reserved and are never auto-retried.

## Gnani contracts used (verified against docs.gnani.ai, 2026-11-10)
| Capability | Request |
|---|---|
| STT REST | `POST {base}/stt/v3`, multipart `audio_file`, `language_code`, `model=prisma-v3.0`, `format`, `keyterms`; header `X-API-Key-ID` |
| Standard TTS | `POST {base}/api/v1/tts/inference` JSON `text, model, voice, language, speed, audio_config` returns binary audio |
| Voice embedding | `POST {base}/api/v1/tts/voice-clone/embeddings` multipart `audio_file`; response nesting is `data.voice_clone_embedding` in the OpenAPI schema but flat in the quick-start example, so the adapter accepts both |
| Cloned TTS | `POST {base}/api/v1/tts/inference` JSON `text, speaker_embedding{embedding,shape,dtype}, audio_config` (`vachana-vc-v1` is implied) |

## Run
```bash
npm ci
npm run dev          # http://localhost:3000
npm run typecheck && npm test
npm run build
npm run gen:replay   # regenerates public/replay.json (prerecorded, synthetic, signed with a dev key)
npm run validate:vercel
```

## Deploy to Vercel
1. Import the repo; framework is auto-detected (`vercel.json`: Next.js, `npm ci`, region `bom1`, 60 s API function limit, security headers).
2. Add the environment variables from `.env.example`. Live voice requires a durable store: run `migrations/0001_vk_kv.sql` in Supabase and set `STORE_BACKEND=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Without them the app runs in text mode and says so.
3. `GET /api/health` (liveness) and `GET /api/ready` (readiness) never call Gnani, so they cost nothing.
4. Vercel Hobby is non-commercial. Treat a public demo and a commercial service as separate stages.

## Synthetic-data rule
Use fictitious people and transactions only. Do not enter real phone, account, Aadhaar or PAN numbers. Confirm the contest policy before enrolling any voice reference.

## Limits of a signed record
A valid signature means the content is unchanged since signing. It does not prove the statements are true, who spoke, that the other party agreed, or legal enforceability.

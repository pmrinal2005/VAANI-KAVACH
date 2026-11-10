import { publicKeyInfo, verifySigned } from '@/lib/records'
import { fail, json, readJson, safe } from '@/lib/http'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const POST = safe(async (req: Request) => {
  const body = await readJson<{ signed?: unknown }>(req, 60_000)
  if (!body || !body.signed) return fail(400, 'bad_request', 'Send { "signed": <signed record> }.')
  const k = await publicKeyInfo()
  const r = await verifySigned(body.signed, { [k.key_id]: k.public_key_hex })
  return json({ ok: true, ...r })
})

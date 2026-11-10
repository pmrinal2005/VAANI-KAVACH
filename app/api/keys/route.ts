import { publicKeyInfo } from '@/lib/records'
import { json, safe } from '@/lib/http'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
/** Public verification key (never the private seed). Cache this for offline verification. */
export const GET = safe(async () => {
  const k = await publicKeyInfo()
  return json({ ok: true, keys: { [k.key_id]: k.public_key_hex }, current: k, fetched_at: new Date().toISOString() })
})

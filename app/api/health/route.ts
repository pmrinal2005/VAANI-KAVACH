import { json } from '@/lib/http'
export const dynamic = 'force-dynamic'
/** Liveness. Never touches storage or any paid provider. */
export function GET() {
  return json({ ok: true, service: 'vaani-kavach', time: new Date().toISOString() })
}

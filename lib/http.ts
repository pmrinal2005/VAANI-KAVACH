/** Shared helpers for route handlers. No transcript or secret is ever logged. */
import { NextResponse } from 'next/server'
import { verifyToken } from './auth'
import { getSession, isErr, type EngineError } from './engine'
import { getStore, type Store } from './store'
import type { Session } from './types'

const NOSTORE = { 'Cache-Control': 'no-store' }

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { ...NOSTORE, ...headers } })
}
export function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}): NextResponse {
  return json({ ok: false, code, message, ...extra }, status)
}
export function engineFail(e: EngineError): NextResponse {
  return fail(e.status, e.code, e.message)
}

export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 20_000): Promise<T | null> {
  try {
    const len = Number(req.headers.get('content-length') || 0)
    if (len > maxBytes) return null
    const text = await req.text()
    if (text.length > maxBytes) return null
    const v = JSON.parse(text)
    return v && typeof v === 'object' ? (v as T) : null
  } catch {
    return null
  }
}

/** Authenticate the caller against the session in the URL. Returns the session or an error response. */
export async function authSession(req: Request, id: string): Promise<{ store: Store; session: Session } | NextResponse> {
  const sid = await verifyToken(req.headers.get('x-vk-token'))
  if (!sid || sid !== id) return fail(401, 'unauthorized', 'Missing or invalid session token. Start a new session.')
  const store = getStore()
  const session = await getSession(store, id)
  if (!session) return fail(404, 'not_found', 'Session not found. It may have expired.')
  return { store, session }
}
export const isResp = (x: unknown): x is NextResponse => x instanceof NextResponse

/** Wrap a handler so unexpected errors become a generic 500 without leaking content. */
export function safe<A extends unknown[]>(fn: (...a: A) => Promise<NextResponse>) {
  return async (...a: A): Promise<NextResponse> => {
    try {
      return await fn(...a)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (/store_|budget_contention|contention/.test(msg)) return fail(503, 'state_unavailable', 'State storage is temporarily unavailable. Please try again.')
      return fail(500, 'internal', 'Something went wrong on the server. Nothing was recorded.')
    }
  }
}

export { isErr }

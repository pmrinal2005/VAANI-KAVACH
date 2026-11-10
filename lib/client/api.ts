/** Thin browser client. The session token lives in memory only (never localStorage) so closing the tab ends access. */
export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message)
  }
}

async function parse(res: Response): Promise<unknown> {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return {}
  }
}

export async function api<T = Record<string, unknown>>(path: string, o: { method?: 'GET' | 'POST'; body?: unknown; token?: string | null } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: o.method ?? (o.body === undefined ? 'GET' : 'POST'),
      headers: { ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(o.token ? { 'x-vk-token': o.token } : {}) },
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      cache: 'no-store',
    })
  } catch {
    throw new ApiError('offline', 'Could not reach the server. Check your connection. Nothing was recorded.', 0)
  }
  const j = (await parse(res)) as { ok?: boolean; code?: string; message?: string }
  if (!res.ok || j.ok === false) throw new ApiError(j.code ?? `http_${res.status}`, j.message ?? `Request failed (${res.status}).`, res.status)
  return j as T
}

/** For endpoints that return audio. */
export async function apiAudio(path: string, token: string, body?: unknown): Promise<{ blob: Blob; headers: Headers }> {
  let res: Response
  try {
    res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-vk-token': token }, body: JSON.stringify(body ?? {}), cache: 'no-store' })
  } catch {
    throw new ApiError('offline', 'Could not reach the server.', 0)
  }
  if (!res.ok) {
    const j = (await parse(res)) as { code?: string; message?: string }
    throw new ApiError(j.code ?? `http_${res.status}`, j.message ?? `Request failed (${res.status}).`, res.status)
  }
  return { blob: await res.blob(), headers: res.headers }
}

export async function apiUpload<T = Record<string, unknown>>(path: string, token: string, form: FormData): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { method: 'POST', headers: { 'x-vk-token': token }, body: form, cache: 'no-store' })
  } catch {
    throw new ApiError('offline', 'Could not reach the server. Nothing was recorded.', 0)
  }
  const j = (await parse(res)) as { ok?: boolean; code?: string; message?: string }
  if (!res.ok || j.ok === false) throw new ApiError(j.code ?? `http_${res.status}`, j.message ?? `Request failed (${res.status}).`, res.status)
  return j as T
}

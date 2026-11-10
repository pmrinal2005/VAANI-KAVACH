import { cfg } from '@/lib/config'
import { getStore } from '@/lib/store'
import { acquireSlot, releaseSlot, summary } from '@/lib/budget'
import { createSession, isErr, sessionView } from '@/lib/engine'
import { issueToken } from '@/lib/auth'
import { fail, json, readJson, safe, engineFail } from '@/lib/http'
import type { Lang, WorkflowId } from '@/lib/types'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = safe(async (req: Request) => {
  const body = await readJson<{ workflow?: string; lang?: string; tz?: string; wantLive?: boolean }>(req)
  if (!body) return fail(400, 'bad_request', 'Invalid JSON body.')
  const c = cfg()
  const store = getStore()

  let mode: 'live' | 'text' = 'text'
  let reason: string | undefined = 'Text mode: the engine runs without paid speech services.'
  let slot = false
  if (body.wantLive !== false) {
    if (!c.liveEnabled || c.killSwitch) reason = 'Live voice is switched off.'
    else if (!c.gnaniKey) reason = 'Speech provider is not configured on this deployment.'
    else if (!store.durable && !c.allowMemoryBudget) reason = 'Live voice needs durable storage; running in text mode.'
    else {
      const sum = await summary(store).catch(() => null)
      if (!sum) reason = 'State storage is unavailable; running in text mode.'
      else if (sum.remaining <= 0) reason = 'The live allocation is used up; running in text mode.'
      else {
        const probe = `slot_${crypto.randomUUID()}`
        const got = await acquireSlot(store, probe)
        if (got.ok) {
          mode = 'live'
          reason = undefined
          slot = true
          // re-key the slot to the real session id below
          await releaseSlot(store, probe)
        } else reason = 'Another live session is running (one at a time). Text mode is available now.'
      }
    }
  }

  const made = await createSession(store, { workflow: (body.workflow ?? 'money_order') as WorkflowId, lang: (body.lang ?? 'hinglish') as Lang, tz: body.tz, mode, modeReason: reason, liveSlot: false })
  if (isErr(made)) return engineFail(made)
  let session = made.session
  if (mode === 'live' && slot) {
    const got = await acquireSlot(store, session.id)
    if (!got.ok) {
      // lost the race between probe and claim: downgrade honestly
      session = { ...session, mode: 'text', modeReason: 'Another live session just started (one at a time). Text mode is available now.' }
      const cur = await store.get<typeof session>(`sess:${session.id}`)
      if (cur) await store.cas(`sess:${session.id}`, cur.rev, session)
    } else {
      const cur = await store.get<typeof session>(`sess:${session.id}`)
      if (cur) {
        session = { ...cur.value, liveSlot: true }
        await store.cas(`sess:${session.id}`, cur.rev, session)
      }
    }
  }
  const token = await issueToken(session.id, Math.floor(Date.parse(session.expiresAt) / 1000) + 30)
  return json({ ok: true, token, session: sessionView(session) }, 201)
})

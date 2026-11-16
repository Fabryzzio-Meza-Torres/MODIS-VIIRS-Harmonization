import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectPages, type Page } from './paging.ts'

type E = { event_id: number }
const server = (total: number, opts: { overlap?: boolean; delay?: number } = {}) => {
  const state = { calls: [] as number[], inflight: 0, maxInflight: 0 }
  const fetchPage = async (offset: number, limit: number): Promise<Page<E>> => {
    state.calls.push(offset); state.inflight++; state.maxInflight = Math.max(state.maxInflight, state.inflight)
    await new Promise((r) => setTimeout(r, opts.delay ?? 1))
    state.inflight--
    const from = opts.overlap && offset > 0 ? offset - 10 : offset // simulates data shifting between requests
    return { total, events: Array.from({ length: Math.max(0, Math.min(limit, total - from)) }, (_, i) => ({ event_id: from + i + 1 })) }
  }
  return { fetchPage, state }
}

test('paging: complete download, every id once, concurrency bounded', async () => {
  const s = server(4500)
  const r = await collectPages(s.fetchPage, { concurrency: 3 })
  assert.equal(r.events.length, 4500); assert.equal(new Set(r.events.map((e) => e.event_id)).size, 4500)
  assert.equal(r.complete, true); assert.equal(r.pages, 5)
  assert.ok(s.state.maxInflight <= 3, `max in flight ${s.state.maxInflight}`)
  assert.deepEqual([...s.state.calls].sort((a, b) => a - b), [0, 1000, 2000, 3000, 4000])
})

test('paging: empty and single-page results are complete', async () => {
  assert.deepEqual(await collectPages(server(0).fetchPage), { events: [], total: 0, complete: true, pages: 1 })
  const one = await collectPages(server(335).fetchPage)
  assert.equal(one.events.length, 335); assert.equal(one.complete, true)
})

test('paging: over the cap the result is partial, never reported complete', async () => {
  const r = await collectPages(server(25000).fetchPage, { maxPages: 20 })
  assert.equal(r.events.length, 20000); assert.equal(r.total, 25000); assert.equal(r.complete, false); assert.equal(r.pages, 20)
})

test('paging: duplicates are dropped and a shifted dataset is flagged incomplete', async () => {
  const r = await collectPages(server(3000, { overlap: true }).fetchPage)
  assert.equal(new Set(r.events.map((e) => e.event_id)).size, r.events.length)
  assert.equal(r.complete, r.events.length === 3000)
})

test('paging: progress is monotonic and ends at the loaded count; abort rejects', async () => {
  const seen: number[] = []
  const r = await collectPages(server(3500).fetchPage, { onProgress: (n) => seen.push(n) })
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b)); assert.equal(seen.at(-1), r.events.length)
  const ctl = new AbortController()
  const p = collectPages(server(9000, { delay: 20 }).fetchPage, { signal: ctl.signal })
  setTimeout(() => ctl.abort(), 30)
  await assert.rejects(p, /abort/i)
})

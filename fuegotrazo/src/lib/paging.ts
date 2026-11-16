export interface Page<T> { total: number; events: T[] }
export interface Collected<T> {
  events: T[]; total: number
  /** true only if every page was fetched AND the distinct events equal the API's total. Otherwise the figures are a minimum. */
  complete: boolean
  pages: number
}
interface Opts { pageSize?: number; maxPages?: number; concurrency?: number; signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void }

/**
 * Downloads a paged query: page 1 gives the total, the rest are requested with bounded concurrency.
 * Deduplicates by event_id; stops at maxPages (default 20 pages x 1 000 = 20 000 events) and says so via `complete`.
 */
export async function collectPages<T extends { event_id: number }>(fetchPage: (offset: number, limit: number) => Promise<Page<T>>, o: Opts = {}): Promise<Collected<T>> {
  const size = o.pageSize ?? 1000, max = o.maxPages ?? 20, conc = o.concurrency ?? 4
  const check = () => { if (o.signal?.aborted) throw new DOMException('aborted', 'AbortError') }
  check()
  const first = await fetchPage(0, size)
  check()
  const byId = new Map<number, T>(first.events.map((e) => [e.event_id, e]))
  o.onProgress?.(byId.size, first.total)
  const needed = Math.ceil(first.total / size)
  const toFetch = Math.min(needed, max)
  const offsets = Array.from({ length: Math.max(0, toFetch - 1) }, (_, i) => (i + 1) * size)
  let next = 0
  const worker = async () => {
    while (next < offsets.length) {
      const page = await fetchPage(offsets[next++], size)
      check()
      for (const e of page.events) byId.set(e.event_id, e)
      o.onProgress?.(byId.size, first.total)
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, offsets.length) }, worker))
  return { events: [...byId.values()], total: first.total, complete: needed <= max && byId.size === first.total, pages: Math.max(1, toFetch) }
}

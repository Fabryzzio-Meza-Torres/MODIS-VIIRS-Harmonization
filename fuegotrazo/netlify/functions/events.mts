// Read-only proxy to the events API (it sends no CORS headers). Same-origin for the app: /api/events/*.
import { buildUpstream, EVENTS_UPSTREAM } from '../../src/lib/proxy-rules.ts'

const PREFIX = '/api/events'
const json = (body: unknown, status: number, cache = 'no-store') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache } })

export async function handle(req: Request, doFetch: typeof fetch = fetch): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
  const url = new URL(req.url)
  if (!url.pathname.startsWith(PREFIX)) return json({ error: 'route_not_allowed' }, 404)

  const built = buildUpstream(url.pathname.slice(PREFIX.length) || '/', url.searchParams)
  if ('error' in built) return json({ error: built.error }, 400)

  let upstream: Response
  try {
    upstream = await doFetch(`${EVENTS_UPSTREAM}${built.path}${built.query ? `?${built.query}` : ''}`, {
      headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000),
    })
  } catch {
    return json({ error: 'upstream_unreachable' }, 502)
  }
  const text = await upstream.text()
  if (upstream.status === 404 || upstream.status === 422) return new Response(text, { status: upstream.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
  if (!upstream.ok) return json({ error: 'upstream_error', status: upstream.status }, 502)
  return new Response(text, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': built.cache === 'short' ? 'public, max-age=300' : 'no-store' } })
}

export default (req: Request) => handle(req)
// Literal on purpose: Netlify reads this by static analysis and cannot evaluate template strings.
export const config = { path: '/api/events/*' }

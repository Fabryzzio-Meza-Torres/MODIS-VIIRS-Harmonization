import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { handle } from './netlify/functions/events.mts'

// Dev/preview serve /api/events with the very same handler Netlify runs in production.
const eventsProxy = (): Plugin => {
  // must return void: a returned function would be treated by Vite as a post-middleware hook
  const mount = (server: { middlewares: { use: (path: string, fn: (req: any, res: any) => void) => unknown } }): void => {
    server.middlewares.use('/api/events', async (req, res) => {
      const r = await handle(new Request(`http://localhost/api/events${req.url}`, { method: req.method }))
      res.statusCode = r.status
      r.headers.forEach((v, k) => res.setHeader(k, v))
      res.end(Buffer.from(await r.arrayBuffer()))
    })
  }
  return { name: 'events-proxy', configureServer: mount, configurePreviewServer: mount }
}

export default defineConfig({ plugins: [react(), eventsProxy()] })

import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import auditRouter from './routes/audit.js'
import demoRouter, { loadAllDemos, isDemoMode } from './routes/demo.js'
import compareRouter from './routes/compare.js'
import { set as cacheSet } from './services/cache.js'
import { connectDB } from './services/mongodb.js'
import { hasApifyToken } from './services/apify.js'
import { hasLLM } from './services/llm.js'

const app = express()
const PORT = process.env.PORT ?? 3001

// Behind Render/Railway proxies, so req.ip is the real client (rate limiting)
app.set('trust proxy', 1)

const ALLOWED_ORIGINS = [
  'http://localhost:5173', 'http://localhost:5174',
  'http://127.0.0.1:5173', 'http://127.0.0.1:5174',
  'http://localhost:4173', 'http://localhost:3000',
  /\.vercel\.app$/,
  process.env.FRONTEND_URL,
].filter(Boolean)
app.use(cors({ origin: ALLOWED_ORIGINS }))
app.use(express.json({ limit: '32kb' }))

// ── Simple in-memory rate limit for scraping endpoints (each scan costs money)
const WINDOW_MS = 10 * 60 * 1000
const MAX_PER_WINDOW = Number(process.env.RATE_LIMIT_PER_10MIN ?? 60)
const hits = new Map()
function rateLimit(req, res, next) {
  const now = Date.now()
  const entry = hits.get(req.ip)
  if (!entry || now > entry.resetAt) {
    hits.set(req.ip, { count: 1, resetAt: now + WINDOW_MS })
    return next()
  }
  if (++entry.count > MAX_PER_WINDOW) {
    res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)))
    return res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' })
  }
  next()
}
setInterval(() => {
  const now = Date.now()
  for (const [ip, e] of hits) if (now > e.resetAt) hits.delete(ip)
}, WINDOW_MS).unref()

// Health
app.get('/health', (_, res) => res.json({ ok: true, ts: Date.now(), demoMode: isDemoMode() }))

// Routes
app.use('/api/audit', rateLimit, auditRouter)
app.use('/api/compare', rateLimit, compareRouter)
app.use('/api/demo-gallery', demoRouter)

// 404
app.use((req, res) => res.status(404).json({ error: `No route: ${req.method} ${req.path}` }))

// Error handler
app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body must be valid JSON' })
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' })
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

// Pre-load demo audits into cache (follow-up chat works on gallery items after restart)
function warmDemoCache() {
  const demos = loadAllDemos()
  for (const d of demos) {
    if (d.id) cacheSet(`audit:id:${d.id}`, d, 0)
  }
  console.log(`Demo cache warmed: ${demos.length} audits`)
}

async function start() {
  await connectDB()

  app.listen(PORT, () => {
    warmDemoCache()
    console.log(`\nTrustLens backend → http://localhost:${PORT}`)
    console.log(`Mode            : ${isDemoMode() ? 'DEMO (canned data, DEMO_MODE=true)' : 'LIVE scraping'}`)
    console.log(`Apify token     : ${hasApifyToken() ? 'YES (Amazon + cross-platform search enabled)' : 'NO (Flipkart/Myntra/Croma etc. work; Amazon + cross-platform search disabled)'}`)
    console.log(`LLM key         : ${hasLLM() ? 'YES' : 'NO (rule-based narrative + follow-up answers)'}`)
    console.log(`NVIDIA key      : ${process.env.NVIDIA_API_KEY ? 'YES (semantic similarity active)' : 'NO (using Jaccard fallback)'}`)
    console.log(`MiniMax key     : ${process.env.MINIMAX_API_KEY ? 'YES' : 'NO (using configured LLM / rules)'}`)
    console.log('')
  })
}

start().catch(err => {
  console.error('Startup failed:', err)
  process.exit(1)
})

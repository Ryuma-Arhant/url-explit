import { Router } from 'express'
import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const DEMO_DIR = join(__dir, '../../../demo-data')

// Demo mode is opt-in only (DEMO_MODE=true). Live scraping is the default.
export function isDemoMode() {
  return process.env.DEMO_MODE === 'true'
}

export function loadAllDemos() {
  try {
    return readdirSync(DEMO_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .map(f => {
        try { return JSON.parse(readFileSync(join(DEMO_DIR, f), 'utf-8')) }
        catch { return null }
      })
      .filter(Boolean)
  } catch { return [] }
}

// Deterministic demo pick for a URL. Audit and compare MUST use this same
// function so they always describe the same product.
export function pickDemo(url) {
  const demos = loadAllDemos()
  if (!demos.length) return null
  const keyword = demos.find(d => d._matchKeyword && url.includes(d._matchKeyword))
  if (keyword) return keyword
  const hash = [...url].reduce((a, c) => a + c.charCodeAt(0), 0)
  return demos[hash % demos.length]
}

const router = Router()

// GET /api/demo-gallery — returns all pre-cached audits for the gallery page
router.get('/', (req, res) => {
  const demos = loadAllDemos().map(d => ({ ...d, _demo: true }))
  // Sort: AVOID first (the money shot), then WAIT, then BUY
  const order = { AVOID: 0, WAIT: 1, BUY: 2 }
  demos.sort((a, b) => (order[a.verdict] ?? 3) - (order[b.verdict] ?? 3))
  res.json(demos)
})

export default router

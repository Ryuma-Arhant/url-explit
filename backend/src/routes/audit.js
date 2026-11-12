import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { scrapeProduct } from '../services/scraper.js'
import { findCompetitors, hasApifyToken } from '../services/apify.js'
import { computeTrustScore, scoreToVerdict } from '../services/trustScore.js'
import { generateNarrative, answerFollowUp } from '../services/llm.js'
import { get as cacheGet, set as cacheSet } from '../services/cache.js'
import { validateProductUrl } from '../services/sites.js'
import { isDemoMode, pickDemo } from './demo.js'
import { asyncHandler, sendScrapeError } from './util.js'

const router = Router()

// POST /api/audit
router.post('/', asyncHandler(async (req, res) => {
  const { url } = req.body ?? {}
  const demo = isDemoMode()
  const validationError = validateProductUrl(url, { demo })
  if (validationError) return res.status(400).json({ error: validationError })

  const cleanUrl = url.trim()
  const cacheKey = `audit:${cleanUrl}`
  const cached = cacheGet(cacheKey)
  if (cached) return res.json(cached)

  // Demo mode (DEMO_MODE=true): canned audits, clearly labelled as demo data
  if (demo) {
    const d = pickDemo(cleanUrl)
    if (!d) return res.status(500).json({ error: 'No demo data found in demo-data/' })
    const result = { ...d, sourceUrl: cleanUrl, _demo: true }
    cacheSet(cacheKey, result, 300)
    return res.json(result)
  }

  // ── Live scraping path ───────────────────────────────────────────────────
  let productData
  try {
    productData = await scrapeProduct(cleanUrl)
  } catch (err) {
    return sendScrapeError(res, err, 'Audit')
  }

  let competitors = []
  if (hasApifyToken()) {
    try {
      competitors = (await findCompetitors(productData.title, productData.brand))?.matches ?? []
    } catch (err) {
      console.warn('Competitor search failed (non-fatal):', err.message)
    }
  }

  const scoreData = computeTrustScore(productData, productData.reviews ?? [], productData.seller ?? {}, competitors)
  const verdict = scoreToVerdict(scoreData.trustScore)
  const narrative = await generateNarrative(productData, scoreData, verdict)

  const audit = {
    id: randomUUID(),
    sourceUrl: cleanUrl,
    product: {
      title: productData.title,
      brand: productData.brand,
      images: productData.images ?? [],
      price_current: productData.price_current,
      rating_avg: productData.rating_avg,
      rating_count: productData.rating_count,
      source_site: productData.source_site,
      delivery_estimate: productData.delivery_estimate,
      return_policy_text: productData.return_policy_text,
      in_stock: productData.in_stock ?? null,
      availability: productData.availability ?? null,
    },
    verdict,
    verdictReason: narrative?.verdictReason ?? 'Analysis complete.',
    insights: narrative?.insights ?? [],
    trustScore: scoreData.trustScore,
    signals: scoreData.signals,
    priceData: scoreData.priceData,
    reviewData: scoreData.reviewData,
    sellerData: scoreData.sellerData,
    auditedAt: new Date().toISOString(),
  }

  cacheSet(`audit:id:${audit.id}`, audit, 0) // never expires in session
  cacheSet(cacheKey, audit, 1800)
  return res.json(audit)
}))

// POST /api/audit/:id/ask
router.post('/:id/ask', asyncHandler(async (req, res) => {
  const { id } = req.params
  const { question } = req.body ?? {}

  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'question is required' })
  }
  if (question.length > 500) {
    return res.status(400).json({ error: 'question is too long (max 500 characters)' })
  }

  const audit = cacheGet(`audit:id:${id}`)
  if (!audit) {
    return res.status(404).json({ error: 'Audit session expired. Run a new audit first.' })
  }

  const answer = await answerFollowUp(question.trim(), {
    product: audit.product,
    verdict: audit.verdict,
    verdictReason: audit.verdictReason,
    trustScore: audit.trustScore,
    signals: audit.signals,
    priceData: audit.priceData,
    reviewData: { ...audit.reviewData, sampleReviews: undefined },
    sellerData: audit.sellerData,
  })

  return res.json({ answer })
}))

export default router

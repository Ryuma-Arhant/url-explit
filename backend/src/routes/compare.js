import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { scrapeProduct } from '../services/scraper.js'
import { findProductOnPlatforms, hasApifyToken } from '../services/apify.js'
import { computeTrustScore, scoreToVerdict } from '../services/trustScore.js'
import { productSimilarity } from '../services/nvidia.js'
import { generateComparisonAnalysis, generateRuleBasedAnalysis } from '../services/minimax.js'
import { get as cacheGet, set as cacheSet } from '../services/cache.js'
import { isUsingMemory } from '../services/mongodb.js'
import { validateProductUrl, identifySite } from '../services/sites.js'
import { isDemoMode, pickDemo } from './demo.js'
import { asyncHandler, sendScrapeError } from './util.js'

let ComparisonModel = null
async function getModel() {
  if (ComparisonModel) return ComparisonModel
  if (!isUsingMemory()) {
    const mod = await import('../models/Comparison.js')
    ComparisonModel = mod.default
  }
  return ComparisonModel
}

const router = Router()

// Build a snapshot from scraped data + search snippet fallback
function buildSnapshot(site, url, scraped, snippetData, similarity) {
  const data = scraped ?? {}
  const srcPrice = data.price_current ?? snippetData?.priceFromSearch ?? null
  const srcMrp   = data.price_mrp ?? null
  const discPct  = srcMrp && srcPrice && srcMrp > srcPrice
    ? Math.round(((srcMrp - srcPrice) / srcMrp) * 100)
    : null

  const scoreData = scraped
    ? computeTrustScore(scraped, scraped.reviews ?? [], scraped.seller ?? {}, [])
    : null

  return {
    site: identifySite(url)?.name ?? scraped?.source_site ?? site,
    url,
    title: scraped?.title ?? snippetData?.title ?? null,
    brand: scraped?.brand || null,
    price_current: srcPrice,
    price_mrp: srcMrp,
    currency: scraped?.currency ?? 'INR',
    image: scraped?.images?.[0] ?? null,
    images: scraped?.images ?? [],
    rating_avg: scraped?.rating_avg ?? null,
    rating_count: scraped?.rating_count ?? null,
    seller_name: scraped?.seller?.name ?? null,
    seller_age_days: scraped?.seller?.age_days ?? null,
    delivery_estimate: scraped?.delivery_estimate || null,
    in_stock: scraped?.in_stock ?? null,
    availability: scraped?.availability ?? null,
    similarity_score: Math.round((similarity ?? 0) * 100) / 100,
    trust_score: scoreData?.trustScore ?? null,
    verdict: scoreData ? scoreToVerdict(scoreData.trustScore) : null,
    is_suspicious: scoreData ? scoreData.trustScore < 40 : false,
    discount_pct: discPct,
    // detail for the seller page + AI context (null = page not analysed)
    _signals: scoreData?.signals ?? null,
    _review: scoreData ? {
      totalReviews: scoreData.reviewData.totalReviews,
      genericPhrasePct: scoreData.reviewData.genericPhrasePct,
      burstDetected: scoreData.reviewData.burstDetected,
      burstPct: scoreData.reviewData.burstPct,
      suspiciousNamePct: scoreData.reviewData.suspiciousNamePct,
      returnPolicyFlags: scoreData.sellerData.return_policy_flags,
    } : null,
  }
}

// ─── POST /api/compare ────────────────────────────────────────────────────────
router.post('/', asyncHandler(async (req, res) => {
  const { url } = req.body ?? {}
  const demo = isDemoMode()
  const err = validateProductUrl(url, { demo })
  if (err) return res.status(400).json({ error: err })

  const cleanUrl = url.trim()
  const cacheKey = `compare:${cleanUrl}`
  const cached = cacheGet(cacheKey)
  if (cached) return res.json({ ...cached, fromCache: true })

  if (demo) {
    const result = buildDemoComparison(cleanUrl)
    if (!result) return res.status(500).json({ error: 'No demo data found in demo-data/' })
    cacheSet(cacheKey, result, 300)
    cacheSet(`comparison:id:${result.id}`, result, 300)
    return res.json(result)
  }

  // ── Live path ──────────────────────────────────────────────────────────────
  // Step 1: Scrape the source product page (shared with the audit request)
  let sourceRaw
  try {
    sourceRaw = await scrapeProduct(cleanUrl)
  } catch (e) {
    return sendScrapeError(res, e, 'Compare')
  }

  const sourceSnapshot = buildSnapshot(identifySite(cleanUrl)?.name ?? 'Source', cleanUrl, sourceRaw, null, 1.0)

  // Step 2: Find same product on other platforms (needs Apify Google search)
  let platformResults = []
  let notice = null
  if (!hasApifyToken()) {
    notice = 'Cross-platform search needs an Apify token (APIFY_API_TOKEN in backend/.env). Showing this listing only.'
  } else {
    try {
      platformResults = await findProductOnPlatforms(sourceRaw.title, sourceRaw.brand, cleanUrl, 3)
      console.log(`Found ${platformResults.length} platform matches for: ${sourceRaw.title?.slice(0, 40)}`)
      if (!platformResults.length) notice = 'No matching listings were found on other platforms.'
    } catch (e) {
      console.warn('Platform search failed:', e.message)
      notice = `Cross-platform search failed: ${e.message}`
    }
  }

  // Step 3: Scrape each platform's product page in parallel
  const scrapedResults = await Promise.allSettled(platformResults.map(p => scrapeProduct(p.url)))

  // Step 4: Build match snapshots — use scraped data, fall back to search snippet
  const matchSnapshots = await Promise.all(
    platformResults.map(async (p, i) => {
      const r = scrapedResults[i]
      const scraped = r.status === 'fulfilled' ? r.value : null
      if (r.status === 'rejected') console.warn(`Scrape failed for ${p.url}: ${r.reason?.message}`)
      const sim = await productSimilarity(sourceRaw.title, scraped?.title ?? p.title).catch(() => p.similarity_score)
      return buildSnapshot(p.site, p.url, scraped, p, sim)
    })
  )

  const validMatches = matchSnapshots.filter(m => m.similarity_score >= 0.3 || m.price_current != null)

  // Step 5: AI comparison analysis (falls back to rule-based internally)
  const aiRecommendation = await generateComparisonAnalysis(sourceSnapshot, validMatches)
    .catch(() => generateRuleBasedAnalysis(sourceSnapshot, validMatches))

  const comparison = {
    id: randomUUID(),
    sourceUrl: cleanUrl,
    sourceProduct: sourceSnapshot,
    matches: validMatches,
    aiRecommendation,
    notice,
    comparedAt: new Date().toISOString(),
    fromCache: false,
  }

  // Persist to MongoDB (non-blocking)
  const Model = await getModel()
  if (Model) {
    Model.create({ _id: comparison.id, ...comparison })
      .catch(e => console.warn('DB save failed:', e.message))
  }

  cacheSet(cacheKey, comparison, 3600)
  cacheSet(`comparison:id:${comparison.id}`, comparison, 0)
  return res.json(comparison)
}))

// ─── GET /api/compare/:id ─────────────────────────────────────────────────────
router.get('/:id', asyncHandler(async (req, res) => {
  const cached = cacheGet(`comparison:id:${req.params.id}`)
  if (cached) return res.json({ ...cached, fromCache: true })

  const Model = await getModel()
  if (Model) {
    const doc = await Model.findById(req.params.id).lean().catch(() => null)
    if (doc) {
      cacheSet(`comparison:id:${req.params.id}`, doc, 3600)
      return res.json({ ...doc, fromCache: true })
    }
  }
  return res.status(404).json({ error: 'Comparison not found or expired' })
}))

// ─── Demo comparison (DEMO_MODE=true only) ───────────────────────────────────
function buildDemoComparison(url) {
  const base = pickDemo(url)
  if (!base) return null

  const sourceProduct = {
    site: identifySite(base.sourceUrl)?.name ?? base.product?.source_site ?? 'Source',
    url,
    title: base.product?.title,
    brand: base.product?.brand,
    price_current: base.priceData?.current,
    price_mrp: base.priceData?.mrp,
    currency: base.priceData?.currency ?? 'INR',
    image: base.product?.images?.[0] ?? null,
    images: base.product?.images ?? [],
    rating_avg: base.product?.rating_avg,
    rating_count: base.product?.rating_count,
    seller_name: base.sellerData?.name,
    seller_age_days: base.sellerData?.age_days ?? null,
    delivery_estimate: '2-4 days',
    similarity_score: 1.0,
    trust_score: base.trustScore,
    verdict: base.verdict,
    is_suspicious: base.trustScore < 40,
    discount_pct: base.priceData?.discountPct,
    _signals: base.signals ?? null,
    _review: base.reviewData ? {
      totalReviews: base.reviewData.totalReviews,
      genericPhrasePct: base.reviewData.genericPhrasePct,
      burstDetected: base.reviewData.burstDetected,
      burstPct: base.reviewData.burstPct,
      suspiciousNamePct: base.reviewData.suspiciousNamePct,
      returnPolicyFlags: base.sellerData?.return_policy_flags ?? [],
    } : null,
  }

  const matches = (base.priceData?.competitors ?? []).map((c, i) => {
    const trust = 58 + i * 12
    const mrp = Math.round(c.price * 1.3)
    return {
      site: c.site ?? 'Other',
      url: c.url && c.url !== '#' ? c.url : null,
      title: c.title ?? base.product?.title,
      brand: null,
      price_current: c.price,
      price_mrp: mrp,
      currency: 'INR',
      image: null,
      images: [],
      rating_avg: parseFloat((3.8 + i * 0.2).toFixed(1)),
      rating_count: 500 + i * 300,
      seller_name: `${(c.site ?? 'Store').split('.')[0]} Official`,
      seller_age_days: 180 + i * 90,
      delivery_estimate: i === 0 ? '1-2 days' : '3-5 days',
      similarity_score: c.similarity_score ?? 0.85,
      trust_score: trust,
      verdict: scoreToVerdict(trust),
      is_suspicious: trust < 40,
      discount_pct: Math.round(((mrp - c.price) / mrp) * 100),
      _signals: null,
      _review: null,
    }
  })

  return {
    id: `demo-compare-${base.id}`,
    sourceUrl: url,
    sourceProduct,
    matches,
    aiRecommendation: generateRuleBasedAnalysis(sourceProduct, matches),
    notice: null,
    comparedAt: new Date().toISOString(),
    fromCache: false,
    _demo: true,
  }
}

export default router

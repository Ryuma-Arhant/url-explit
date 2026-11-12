import axios from 'axios'
import { SITES, identifySite } from './sites.js'
import { ScrapeError } from './errors.js'

const BASE = 'https://api.apify.com/v2'

// Actor IDs (verified against the Apify store)
const AMAZON_ACTOR  = 'junglee~amazon-crawler'          // "Amazon Product Scraper"
const CRAWLER_ACTOR = 'apify~website-content-crawler'
const GOOGLE_ACTOR  = 'apify~google-search-scraper'

export function hasApifyToken() {
  return !!process.env.APIFY_API_TOKEN
}

// Run actor synchronously, return dataset items array
async function runActor(actorId, input, timeoutSecs = 120) {
  if (!hasApifyToken()) throw new ScrapeError('APIFY_API_TOKEN is not set in backend/.env', 'NEEDS_APIFY_TOKEN', 503)
  try {
    const { data } = await axios.post(
      `${BASE}/acts/${actorId}/run-sync-get-dataset-items`,
      input,
      {
        params: { timeout: timeoutSecs },
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.APIFY_API_TOKEN}`,
        },
        timeout: (timeoutSecs + 30) * 1000,
      }
    )
    return Array.isArray(data) ? data : []
  } catch (err) {
    const status = err.response?.status
    const detail = err.response?.data?.error?.message
    if (status === 401) throw new ScrapeError('Apify rejected the API token (401). Check APIFY_API_TOKEN in backend/.env.', 'APIFY_AUTH', 502)
    if (status === 402) throw new ScrapeError('Apify account is out of credits (402).', 'APIFY_CREDITS', 502)
    if (status === 404) throw new ScrapeError(`Apify actor not found: ${actorId}.`, 'APIFY_ACTOR', 502)
    if (status === 408 || err.code === 'ECONNABORTED') throw new ScrapeError('The scraper timed out. Try again.', 'APIFY_TIMEOUT', 504)
    throw new ScrapeError(`Apify request failed${status ? ` (${status})` : ''}: ${detail ?? err.message}`, 'APIFY_FAILED', 502)
  }
}

// ─── Amazon product page ─────────────────────────────────────────────────────
export async function fetchAmazonItem(url) {
  const items = await runActor(AMAZON_ACTOR, {
    categoryOrProductUrls: [{ url }],
    maxItemsPerStartUrl: 1,
    maxOffers: 0,
    scrapeSellers: false,
    scrapeProductVariantPrices: false,
    maxProductVariantsAsSeparateResults: 0,
    useCaptchaSolver: false,
  }, 120)
  return items.find(i => i && i.title) ?? null
}

// ─── Generic page → markdown (used with LLM extraction as a last resort) ─────
export async function crawlPageMarkdown(url) {
  const items = await runActor(CRAWLER_ACTOR, {
    startUrls: [{ url }],
    maxCrawlPages: 1,
    crawlerType: 'playwright:adaptive',
  }, 150)
  const item = items[0]
  const markdown = item?.markdown ?? item?.text ?? ''
  if (!markdown.trim()) throw new ScrapeError('Website crawler returned empty content', 'NO_PRODUCT_DATA', 422)
  return markdown
}

// ─── Find same product on other platforms ────────────────────────────────────
const PLATFORM_ORDER = ['flipkart', 'amazon', 'myntra', 'meesho', 'croma', 'tatacliq', 'ajio', 'reliancedigital']

export async function findProductOnPlatforms(productTitle, brand, sourceUrl, maxPlatforms = 3) {
  const sourceKey = identifySite(sourceUrl)?.key
  const targets = PLATFORM_ORDER
    .filter(k => k !== sourceKey)
    .map(k => SITES.find(s => s.key === k))
    .slice(0, maxPlatforms)

  const shortTitle = (productTitle ?? '').split(/[,|–—(]/)[0].trim().slice(0, 80)
  if (!shortTitle) return []

  const searchResults = await Promise.allSettled(
    targets.map(platform => searchOnPlatform(shortTitle, brand, platform))
  )

  return searchResults
    .map(r => (r.status === 'fulfilled' ? r.value : null))
    .filter(Boolean)
    .filter(r => r.similarity_score >= 0.35)
}

async function searchOnPlatform(productTitle, brand, platform) {
  const query = `${productTitle} ${brand ?? ''} site:${platform.searchDomain}`.replace(/\s+/g, ' ').trim()
  const items = await runActor(GOOGLE_ACTOR, {
    queries: query,
    maxPagesPerQuery: 1,
    resultsPerPage: 10,
    countryCode: 'in',
    languageCode: 'en',
  }, 60)

  const results = items.flatMap(item => item.organicResults ?? item.results ?? [])
  const match = results.find(r => identifySite(r.url ?? r.link ?? '')?.key === platform.key)
  if (!match) return null

  const title = match.title ?? ''
  const snippet = match.description ?? match.snippet ?? ''
  const priceMatch = `${title} ${snippet}`.match(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i)

  return {
    site: platform.name,
    url: match.url ?? match.link,
    title,
    snippet,
    priceFromSearch: priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null,
    similarity_score: jaccardSimilarity(productTitle, title),
  }
}

// ─── Competitor prices for the audit's Price Reality signal ──────────────────
export async function findCompetitors(productTitle, brand) {
  const query = `${(productTitle ?? '').slice(0, 100)} ${brand ?? ''} price buy india`.replace(/\s+/g, ' ').trim()
  const items = await runActor(GOOGLE_ACTOR, {
    queries: query,
    maxPagesPerQuery: 1,
    resultsPerPage: 10,
    countryCode: 'in',
    languageCode: 'en',
  }, 60)

  const results = items.flatMap(item => item.organicResults ?? item.results ?? [])
  return parseSearchResults(results, productTitle)
}

function parseSearchResults(results, productTitle) {
  const PRICE_RE = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/gi
  const matches = []

  for (const r of results.slice(0, 8)) {
    const siteUrl = r.url ?? r.link ?? ''
    const site = identifySite(siteUrl)
    if (!site) continue

    const text = `${r.title ?? ''} ${r.description ?? r.snippet ?? ''}`
    const priceMatches = [...text.matchAll(PRICE_RE)]
    if (!priceMatches.length) continue

    const price = parseFloat(priceMatches[0][1].replace(/,/g, ''))
    if (!price || price < 10) continue

    matches.push({
      site: site.name,
      url: siteUrl,
      title: r.title ?? '',
      price,
      rating: null,
      similarity_score: jaccardSimilarity(productTitle, r.title ?? ''),
    })
  }

  return {
    matches: matches
      .filter(m => m.similarity_score >= 0.55)
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .slice(0, 3),
  }
}

function jaccardSimilarity(a, b) {
  if (!a || !b) return 0
  const wa = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 2))
  const wb = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 2))
  const inter = [...wa].filter(w => wb.has(w)).length
  const union = new Set([...wa, ...wb]).size
  return union === 0 ? 0 : inter / union
}

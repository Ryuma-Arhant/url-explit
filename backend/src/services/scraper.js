import axios from 'axios'
import * as cheerio from 'cheerio'
import { identifySite, siteDomain } from './sites.js'
import { hasApifyToken, fetchAmazonItem, crawlPageMarkdown } from './apify.js'
import { callLLM, parseJSON, hasLLM } from './llm.js'
import { get as cacheGet, set as cacheSet } from './cache.js'
import { ScrapeError } from './errors.js'

// Scrape failures are surfaced to the user as-is. We never substitute demo data
// for a real URL — a wrong verdict is worse than an honest error.
export { ScrapeError }

// ─── Public entry point ──────────────────────────────────────────────────────
const inflight = new Map()
const SCRAPE_TTL_SECS = 600

// The audit and compare endpoints both scrape the same URL at the same time;
// share one scrape (and one paid Apify run) between them.
export function scrapeProduct(url) {
  const key = url.trim()
  const cached = cacheGet(`scrape:${key}`)
  if (cached) return Promise.resolve(cached)
  if (inflight.has(key)) return inflight.get(key)

  const p = doScrape(key)
    .then(product => { cacheSet(`scrape:${key}`, product, SCRAPE_TTL_SECS); return product })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

async function doScrape(url) {
  const site = identifySite(url)

  // Amazon serves bot-protection challenges to plain HTTP clients, so it is
  // scraped only through Apify's Amazon actor.
  if (site?.key === 'amazon') {
    if (!hasApifyToken()) {
      throw new ScrapeError(
        'Amazon links need an Apify token: add APIFY_API_TOKEN to backend/.env (Flipkart, Myntra, Croma and other stores work without it).',
        'NEEDS_APIFY_TOKEN', 503
      )
    }
    const item = await fetchAmazonItem(url)
    if (!item) throw new ScrapeError('No product found at that Amazon link. Make sure it is a product page (…/dp/…).', 'NO_PRODUCT_DATA', 422)
    return mapAmazonItem(item, url)
  }

  // Everything else: fetch the page and read its structured product data.
  let directError
  try {
    const { html, finalUrl } = await fetchHtml(url)
    const product = parseProductHtml(html, finalUrl)
    if (isUsable(product)) return product
    directError = new ScrapeError(
      "Couldn't find product details on that page. Make sure the link opens a single product.",
      'NO_PRODUCT_DATA', 422
    )
  } catch (err) {
    directError = err
  }

  // Last resort: Apify headless crawler + LLM extraction (needs both keys).
  if (hasApifyToken() && hasLLM()) {
    try {
      const markdown = await crawlPageMarkdown(url)
      const product = await extractWithLLM(markdown, url)
      if (isUsable(product)) return product
    } catch (err) {
      console.warn('Apify crawler fallback failed:', err.message)
    }
  }

  if (directError instanceof ScrapeError) throw directError
  throw new ScrapeError(`Couldn't load that page: ${directError?.message ?? 'unknown error'}`, 'FETCH_FAILED', 502)
}

function isUsable(p) {
  return !!(p?.title && (p.price_current != null || p.images?.length))
}

// ─── Direct page fetch ───────────────────────────────────────────────────────
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-IN,en;q=0.9',
}

async function fetchHtml(url) {
  let res
  try {
    res = await axios.get(url, {
      headers: BROWSER_HEADERS,
      timeout: 20000,
      maxRedirects: 5,
      responseType: 'text',
      maxContentLength: 10 * 1024 * 1024,
      validateStatus: () => true,
    })
  } catch (err) {
    const reason = err.code === 'ECONNABORTED' ? 'the store took too long to respond' : err.message
    throw new ScrapeError(`Couldn't reach the store: ${reason}.`, 'FETCH_FAILED', 502)
  }

  const finalUrl = res.request?.res?.responseUrl ?? url
  // Redirects must stay on a supported marketplace (no open-redirect fetching)
  if (!identifySite(finalUrl)) {
    throw new ScrapeError('That link redirected away from a supported store.', 'UNSUPPORTED_REDIRECT', 422)
  }

  const html = typeof res.data === 'string' ? res.data : String(res.data ?? '')
  const host = siteDomain(finalUrl)
  if (res.status === 404) throw new ScrapeError('That product page was not found (404). Check the link.', 'NOT_FOUND', 422)
  if ([403, 429, 503].includes(res.status) || looksLikeBotChallenge(html)) {
    throw new ScrapeError(`${host} blocked the request with bot protection. Try again in a few minutes.`, 'BLOCKED', 502)
  }
  if (res.status >= 400) throw new ScrapeError(`${host} returned HTTP ${res.status} for that page.`, 'FETCH_FAILED', 502)
  return { html, finalUrl }
}

const CHALLENGE_MARKERS = /bm-verify|triggerInterstitialChallenge|cf-chl-|challenge-platform|px-captcha|Robot Check|Enter the characters you see below|Pardon Our Interruption|Access Denied<\/title>/i

export function looksLikeBotChallenge(html) {
  if (!html) return false
  if (!CHALLENGE_MARKERS.test(html)) return false
  // A real product page that merely mentions one of these strings still has product data
  return !/"@type"\s*:\s*"Product"/.test(html)
}

// ─── HTML → product ──────────────────────────────────────────────────────────
function toNumber(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const m = String(v).match(/\d[\d,]*(?:\.\d+)?/)
  if (!m) return null
  const n = parseFloat(m[0].replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function normalizeCurrency(c) {
  if (!c) return 'INR'
  const s = String(c).trim()
  if (s === '₹' || /^rs\.?$/i.test(s)) return 'INR'
  if (s === '$') return 'USD'
  if (s === '£') return 'GBP'
  if (s === '€') return 'EUR'
  return /^[A-Z]{3}$/.test(s) ? s : 'INR'
}

function absoluteUrl(src, base) {
  if (!src || typeof src !== 'string') return null
  try {
    const u = new URL(src.trim(), base)
    return ['http:', 'https:'].includes(u.protocol) ? u.href : null
  } catch { return null }
}

function imageList(value, base) {
  const out = []
  const visit = v => {
    if (!v) return
    if (Array.isArray(v)) return v.forEach(visit)
    if (typeof v === 'string') return out.push(absoluteUrl(v, base))
    if (typeof v === 'object') return visit(v.url ?? v.contentUrl ?? v.image)
  }
  visit(value)
  return out.filter(Boolean)
}

function uniq(list) {
  return [...new Set(list.filter(Boolean))]
}

function jsonLdProducts($) {
  const nodes = []
  const visit = n => {
    if (Array.isArray(n)) return n.forEach(visit)
    if (n && typeof n === 'object') {
      nodes.push(n)
      if (n['@graph']) visit(n['@graph'])
    }
  }
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html() ?? ''
    try { visit(JSON.parse(raw)) } catch {
      try { visit(JSON.parse(raw.replace(/[\u0000-\u001F]+/g, ' '))) } catch { /* ignore malformed block */ }
    }
  })
  return nodes.filter(n => [].concat(n['@type'] ?? []).some(t => /^(Product|ProductGroup|IndividualProduct)$/i.test(t)))
}

function cleanTitle(t) {
  if (!t) return null
  return t
    .replace(/\s+Price in India.*$/i, '')
    .replace(/\s+[|:–-]\s+[^|:–-]*(\.com|\.in|Online Shopping)[^|]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim() || null
}

// schema.org availability URL/text → true (in stock) | false (not buyable) | null (unknown)
function stockFromAvailability(v) {
  if (!v) return null
  const s = String(v)
  if (/InStock|LimitedAvailability|OnlineOnly|InStoreOnly|PreOrder|BackOrder/i.test(s)) return true
  if (/OutOfStock|SoldOut|Discontinued|unavailable/i.test(s)) return false
  return null
}

const RETURN_POLICY_RE = /\d+\s*Days?\s*(?:Return|Replacement|Exchange|Refund)[^.\n"<]{0,40}|No\s+(?:Returns?|Refunds?|Exchange)[^.\n"<]{0,30}|Non[-\s]?Returnable|Not\s+Returnable/i

export function parseProductHtml(html, pageUrl) {
  const $ = cheerio.load(html)
  const meta = name => $(`meta[property="${name}"]`).attr('content') ?? $(`meta[name="${name}"]`).attr('content') ?? null

  const ld = jsonLdProducts($)[0] ?? {}
  const offers = [].concat(ld.offers ?? [])[0] ?? {}
  const rating = ld.aggregateRating ?? {}

  const title = cleanTitle(ld.name) ?? cleanTitle(meta('og:title')) ?? cleanTitle($('h1').first().text()) ?? cleanTitle($('title').text())
  const brand = (typeof ld.brand === 'string' ? ld.brand : ld.brand?.name) ?? meta('product:brand') ?? ''

  const price = toNumber(offers.price ?? offers.lowPrice ?? offers.priceSpecification?.price)
    ?? toNumber(meta('product:price:amount') ?? meta('og:price:amount'))
    ?? toNumber($('[itemprop="price"]').attr('content'))
  const currency = normalizeCurrency(offers.priceCurrency ?? meta('product:price:currency') ?? meta('og:price:currency'))

  // MRP is rarely in JSON-LD; stores like Flipkart expose it in embedded state.
  let mrp = toNumber(meta('product:original_price:amount'))
  if (mrp == null) {
    const m = html.match(/"mrp"\s*:\s*"?(\d[\d,]*(?:\.\d+)?)/i)
    if (m) mrp = toNumber(m[1])
  }
  if (mrp != null && price != null && (mrp < price || mrp > price * 20)) mrp = null

  const images = uniq([
    ...imageList(ld.image, pageUrl),
    ...imageList(meta('og:image'), pageUrl),
    ...imageList(meta('twitter:image'), pageUrl),
  ]).slice(0, 8)

  const reviews = [].concat(ld.review ?? []).slice(0, 20).map(r => ({
    text: (r.reviewBody ?? r.description ?? r.name ?? '').toString().trim(),
    rating: toNumber(r.reviewRating?.ratingValue),
    timestamp: r.datePublished ?? null,
    reviewer_name: (typeof r.author === 'string' ? r.author : r.author?.name) ?? 'Anonymous',
  })).filter(r => r.text)

  const policySources = [ld.description, meta('description'), meta('og:description'), $('body').text()]
  const policyMatch = policySources.map(s => (s ?? '').match(RETURN_POLICY_RE)?.[0]).find(Boolean)
  const delivery = $('body').text().match(/(?:Delivery|Delivered)\s+by\s+[^.\n|]{3,40}/i)?.[0]?.trim() ?? ''

  const specifications = {}
  for (const k of ['category', 'color', 'material', 'model', 'sku']) {
    if (typeof ld[k] === 'string' && ld[k]) specifications[k] = ld[k]
  }

  const site = identifySite(pageUrl)
  const host = siteDomain(pageUrl)
  const sourceSite = site ? (site.domains.find(d => host === d || host.endsWith('.' + d)) ?? host) : host

  return {
    title,
    brand: brand || '',
    price_current: price,
    price_mrp: mrp,
    currency,
    images,
    rating_avg: toNumber(rating.ratingValue),
    rating_count: toNumber(rating.ratingCount ?? rating.reviewCount),
    reviews,
    seller: {
      name: offers.seller?.name ?? null,
      age_days: null,
      rating: null,
      total_reviews: null,
    },
    return_policy_text: policyMatch?.trim() ?? '',
    delivery_estimate: delivery,
    specifications,
    in_stock: stockFromAvailability(offers.availability ?? meta('product:availability') ?? meta('og:availability')),
    availability: offers.availability ? String(offers.availability).replace(/^https?:\/\/schema\.org\//i, '') : null,
    source_site: sourceSite,
  }
}

// ─── Apify Amazon actor (junglee/amazon-crawler) → product ───────────────────
export function mapAmazonItem(item, url) {
  const priceValue = item.price && typeof item.price === 'object' ? item.price.value : item.price
  const listValue = item.listPrice && typeof item.listPrice === 'object' ? item.listPrice.value : item.listPrice
  const price = toNumber(priceValue)
  let mrp = toNumber(listValue)
  if (mrp != null && price != null && mrp <= price) mrp = null

  const attrs = item.attributesMapped && typeof item.attributesMapped === 'object'
    ? item.attributesMapped
    : Object.fromEntries((item.attributes ?? []).filter(a => a?.key).map(a => [a.key, a.value]))

  const pageUrl = item.url ?? url
  const host = siteDomain(pageUrl)

  return {
    title: item.title ?? '',
    brand: item.brand ?? '',
    price_current: price,
    price_mrp: mrp,
    currency: normalizeCurrency(item.price?.currency),
    images: uniq([
      ...imageList(item.highResolutionImages, pageUrl),
      ...imageList(item.thumbnailImage, pageUrl),
    ]).slice(0, 8),
    rating_avg: toNumber(item.stars),
    rating_count: toNumber(item.reviewsCount),
    reviews: (Array.isArray(item.reviews) ? item.reviews : []).slice(0, 20).map(r => ({
      text: r.text ?? r.reviewDescription ?? r.body ?? '',
      rating: toNumber(r.rating ?? r.ratingScore ?? r.stars),
      timestamp: r.date ?? r.reviewedIn ?? null,
      reviewer_name: r.name ?? r.userName ?? 'Anonymous',
    })),
    seller: {
      name: item.seller?.name ?? item.sellerName ?? null,
      age_days: null,
      rating: toNumber(item.seller?.averageRating ?? item.seller?.rating),
      total_reviews: null,
    },
    return_policy_text: item.returnPolicy ?? '',
    delivery_estimate: item.delivery ?? item.fastestDelivery ?? '',
    specifications: attrs,
    in_stock: typeof item.inStock === 'boolean' ? item.inStock : null,
    // Actor repeats the text ("Currently unavailable.   Currently unavailable.")
    availability: item.inStockText ? item.inStockText.split(/\s{2,}/)[0].trim() : null,
    source_site: /amazon\.com$/.test(host) ? 'amazon.com' : 'amazon.in',
  }
}

// ─── LLM extraction (fallback for pages without structured data) ─────────────
async function extractWithLLM(rawContent, url) {
  const today = new Date().toISOString().slice(0, 10)
  const prompt = `Extract product data from this scraped e-commerce page. Return ONLY valid JSON, no markdown fences.

Schema (null for missing fields):
{"title":"string","brand":"string","price_current":number,"price_mrp":number|null,"currency":"INR","images":["absolute image url"],"rating_avg":number|null,"rating_count":number|null,"reviews":[{"text":"string","rating":number,"timestamp":"ISO8601|null","reviewer_name":"string"}],"seller":{"name":"string","age_days":number|null,"rating":number|null,"total_reviews":number|null},"return_policy_text":"string","delivery_estimate":"string","specifications":{}}

Rules:
- price_current = current selling price (number only)
- price_mrp = crossed-out/MRP price
- Max 20 reviews, most recent first
- seller.age_days: days from join date to today (${today}), null if unknown

SCRAPED CONTENT:
${rawContent.slice(0, 8000)}`

  const data = parseJSON(await callLLM(prompt, 2000)) ?? {}
  return {
    ...data,
    price_current: toNumber(data.price_current),
    price_mrp: toNumber(data.price_mrp),
    currency: normalizeCurrency(data.currency),
    images: uniq(imageList(data.images, url)).slice(0, 8),
    reviews: Array.isArray(data.reviews) ? data.reviews : [],
    seller: { name: data.seller?.name ?? null, age_days: data.seller?.age_days ?? null, rating: data.seller?.rating ?? null, total_reviews: data.seller?.total_reviews ?? null },
    source_site: siteDomain(url),
  }
}

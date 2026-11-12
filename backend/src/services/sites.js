// Single source of truth for supported marketplaces.
// Hostnames are matched exactly or as subdomains — never by substring,
// so "amazon-deals.evil.example" is NOT treated as Amazon.

export const SITES = [
  { key: 'amazon',          name: 'Amazon',           domains: ['amazon.in', 'amazon.com', 'amzn.in', 'amzn.to', 'amzn.eu'], searchDomain: 'amazon.in' },
  { key: 'flipkart',        name: 'Flipkart',         domains: ['flipkart.com'],                     searchDomain: 'flipkart.com' },
  { key: 'myntra',          name: 'Myntra',           domains: ['myntra.com'],                       searchDomain: 'myntra.com' },
  { key: 'meesho',          name: 'Meesho',           domains: ['meesho.com'],                       searchDomain: 'meesho.com' },
  { key: 'croma',           name: 'Croma',            domains: ['croma.com'],                        searchDomain: 'croma.com' },
  { key: 'tatacliq',        name: 'Tata CLiQ',        domains: ['tatacliq.com'],                     searchDomain: 'tatacliq.com' },
  { key: 'ajio',            name: 'AJIO',             domains: ['ajio.com'],                         searchDomain: 'ajio.com' },
  { key: 'reliancedigital', name: 'Reliance Digital', domains: ['reliancedigital.in'],               searchDomain: 'reliancedigital.in' },
  { key: 'snapdeal',        name: 'Snapdeal',         domains: ['snapdeal.com'],                     searchDomain: 'snapdeal.com' },
  { key: 'ebay',            name: 'eBay',             domains: ['ebay.com', 'ebay.in', 'ebay.co.uk'], searchDomain: 'ebay.com' },
]

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { return null }
}

export function identifySite(url) {
  const host = hostOf(url)
  if (!host) return null
  return SITES.find(s => s.domains.some(d => host === d || host.endsWith('.' + d))) ?? null
}

// Short display domain for a URL, e.g. "flipkart.com"
export function siteDomain(url) {
  return hostOf(url) ?? 'other'
}

// Returns an error message, or null when the URL is acceptable.
export function validateProductUrl(url, { demo = false } = {}) {
  if (typeof url !== 'string' || !url.trim()) return 'url is required'
  let parsed
  try { parsed = new URL(url.trim()) } catch { return 'Invalid URL format' }
  if (!['http:', 'https:'].includes(parsed.protocol)) return 'URL must start with http:// or https://'
  if (!demo && !identifySite(parsed.href)) {
    return `Unsupported site. Supported: ${SITES.map(s => s.name).join(', ')}.`
  }
  return null
}

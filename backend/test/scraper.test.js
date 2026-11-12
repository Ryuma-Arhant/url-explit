import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseProductHtml, looksLikeBotChallenge, mapAmazonItem } from '../src/services/scraper.js'

const fixture = name => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name), 'utf8')

test('extracts title, brand, price, MRP, images, rating and reviews from JSON-LD pages', () => {
  const p = parseProductHtml(fixture('product-jsonld.html'), 'https://www.flipkart.com/acme/p/itm123')
  assert.equal(p.title, 'Acme Wireless Earbuds with 40H Playback')
  assert.equal(p.brand, 'Acme')
  assert.equal(p.price_current, 999)
  assert.equal(p.price_mrp, 2490)
  assert.equal(p.currency, 'INR')
  assert.deepEqual(p.images, [
    'https://img.shop.example/1500/earbuds-main.jpg',
    'https://img.shop.example/1500/earbuds-side.jpg',
    'https://img.shop.example/300/earbuds-main.jpg',
  ])
  assert.equal(p.rating_avg, 4.2)
  assert.equal(p.rating_count, 15230)
  assert.equal(p.reviews.length, 2)
  assert.deepEqual(p.reviews[1], { text: 'Very nice product', rating: 5, timestamp: '2025-04-01', reviewer_name: 'Priya' })
  assert.equal(p.seller.name, 'RetailNet')
  assert.equal(p.seller.age_days, null)
  assert.match(p.return_policy_text, /7 Days Replacement/i)
  assert.equal(p.source_site, 'flipkart.com')
})

test('falls back to OpenGraph/meta tags and resolves relative image URLs', () => {
  const p = parseProductHtml(fixture('product-og-only.html'), 'https://store.example/p/bottle')
  assert.equal(p.title, 'Steel Water Bottle 1L')
  assert.equal(p.price_current, 1249)
  assert.deepEqual(p.images, ['https://store.example/images/bottle.jpg'])
})

test('detects bot-challenge pages instead of parsing them as products', () => {
  assert.equal(looksLikeBotChallenge('<script>function triggerInterstitialChallenge(){} bm-verify</script>'), true)
  assert.equal(looksLikeBotChallenge('<title>Robot Check</title> Enter the characters you see below'), true)
  assert.equal(looksLikeBotChallenge(fixture('product-jsonld.html')), false)
})

test('maps the junglee Amazon actor output (price objects, high-res images)', () => {
  const p = mapAmazonItem({
    title: 'boAt Airdopes 141', brand: 'boAt',
    price: { value: 1099, currency: '₹' }, listPrice: { value: 4490, currency: '₹' },
    stars: 4.1, reviewsCount: 412345,
    thumbnailImage: 'https://m.media-amazon.com/images/I/thumb.jpg',
    highResolutionImages: ['https://m.media-amazon.com/images/I/big1.jpg', 'https://m.media-amazon.com/images/I/big2.jpg'],
    seller: { name: 'Appario Retail' }, returnPolicy: '7 days Replacement', delivery: 'FREE delivery Monday',
  }, 'https://www.amazon.in/dp/B0TEST')
  assert.equal(p.title, 'boAt Airdopes 141')
  assert.equal(p.price_current, 1099)
  assert.equal(p.price_mrp, 4490)
  assert.equal(p.currency, 'INR')
  assert.equal(p.images[0], 'https://m.media-amazon.com/images/I/big1.jpg')
  assert.equal(p.images.length, 3)
  assert.equal(p.rating_avg, 4.1)
  assert.equal(p.rating_count, 412345)
  assert.equal(p.seller.name, 'Appario Retail')
  assert.equal(p.seller.age_days, null)
  assert.equal(p.source_site, 'amazon.in')
  assert.equal(p.in_stock, null) // actor didn't say
})

test('records out-of-stock Amazon listings (price is null, not missing data)', () => {
  const p = mapAmazonItem({
    title: 'boAt Rockerz 110', price: null, listPrice: null, stars: 4, reviewsCount: 4048,
    inStock: false, inStockText: 'Currently unavailable.        Currently unavailable.',
    thumbnailImage: 'https://m.media-amazon.com/images/I/t.jpg',
  }, 'https://www.amazon.in/dp/B0CKJ8JL1Y')
  assert.equal(p.price_current, null)
  assert.equal(p.in_stock, false)
  assert.equal(p.availability, 'Currently unavailable.')
})

test('reads schema.org availability from JSON-LD offers', () => {
  const html = fixture('product-jsonld.html').replace('"priceCurrency": "INR",', '"priceCurrency": "INR", "availability": "https://schema.org/OutOfStock",')
  assert.equal(parseProductHtml(html, 'https://www.flipkart.com/x/p/itm1').in_stock, false)
  const inStock = fixture('product-jsonld.html').replace('"priceCurrency": "INR",', '"priceCurrency": "INR", "availability": "https://schema.org/InStock",')
  assert.equal(parseProductHtml(inStock, 'https://www.flipkart.com/x/p/itm1').in_stock, true)
})

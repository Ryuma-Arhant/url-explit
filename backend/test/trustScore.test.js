import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeTrustScore } from '../src/services/trustScore.js'

const product = { price_current: 1000, price_mrp: 1200, rating_avg: 4.3, rating_count: 500, return_policy_text: '7 Days Replacement' }

test('unknown seller age is not treated as a brand-new seller', () => {
  const unknown = computeTrustScore(product, [], { name: 'Appario', age_days: null }, [])
  const brandNew = computeTrustScore(product, [], { name: 'Fly-by-night', age_days: 5 }, [])
  assert.equal(unknown.sellerData.age_days, null)
  assert.ok(unknown.signals.sellerTrust > brandNew.signals.sellerTrust,
    `unknown age (${unknown.signals.sellerTrust}) should score above a 5-day-old seller (${brandNew.signals.sellerTrust})`)
  assert.ok(unknown.signals.sellerTrust >= 14, 'unknown age should only carry a small "unverified" deduction')
})

test('trust score equals the sum of its signals', () => {
  const r = computeTrustScore(product, [], { age_days: 400, rating: 4.5 }, [])
  const sum = Object.values(r.signals).reduce((a, b) => a + b, 0)
  assert.equal(r.trustScore, sum)
})

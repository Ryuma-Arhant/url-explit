import { test } from 'node:test'
import assert from 'node:assert/strict'
import { comparisonFlags } from '../src/services/minimax.js'

const listing = (o) => ({ site: 'X', price_current: null, price_mrp: null, trust_score: 70, in_stock: true, ...o })

test('a big discount alone is not a fake discount (nothing to cross-check against)', () => {
  const flags = comparisonFlags(
    listing({ site: 'Flipkart', price_current: 999, price_mrp: 2490, trust_score: 82 }),
    [listing({ site: 'Amazon', in_stock: false, trust_score: 64 })]
  )
  assert.equal(flags.fake_discount_detected, false)
  assert.deepEqual(flags.suspicious_indices, [], 'out of stock is not suspicious')
})

test('fake anchor: >60% "discount" while other stores sell at the same price', () => {
  const flags = comparisonFlags(
    listing({ site: 'Amazon', price_current: 649, price_mrp: 4999 }),
    [listing({ site: 'Flipkart', price_current: 639, price_mrp: 999 })]
  )
  assert.equal(flags.fake_discount_detected, true)
})

test('suspicious = trust score under 40', () => {
  const flags = comparisonFlags(listing({ trust_score: 82 }), [listing({ trust_score: 35 }), listing({ trust_score: null })])
  assert.deepEqual(flags.suspicious_indices, [1])
})

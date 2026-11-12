import { test } from 'node:test'
import assert from 'node:assert/strict'
import { identifySite, validateProductUrl } from '../src/services/sites.js'

test('identifies supported marketplaces by real hostname, not substring', () => {
  assert.equal(identifySite('https://www.amazon.in/dp/B0TEST')?.key, 'amazon')
  assert.equal(identifySite('https://amzn.in/d/abc')?.key, 'amazon')
  assert.equal(identifySite('https://www.flipkart.com/x/p/itm1')?.key, 'flipkart')
  assert.equal(identifySite('https://dl.flipkart.com/s/abc')?.key, 'flipkart')
  assert.equal(identifySite('https://amazon-deals.evil.example/x'), null)
  assert.equal(identifySite('https://notflipkart.com/x'), null)
})

test('validateProductUrl rejects non-strings, bad schemes and unsupported sites', () => {
  assert.match(validateProductUrl(['https://www.amazon.in/dp/B0']), /url is required/)
  assert.match(validateProductUrl(123), /url is required/)
  assert.match(validateProductUrl(''), /url is required/)
  assert.match(validateProductUrl('notaurl'), /Invalid URL/)
  assert.match(validateProductUrl('ftp://amazon.in/x'), /http/)
  assert.match(validateProductUrl('https://amazon-deals.evil.example/x'), /Unsupported site/)
  assert.equal(validateProductUrl('https://www.flipkart.com/x/p/itm1'), null)
  // demo mode accepts any http(s) URL
  assert.equal(validateProductUrl('https://example.com/x', { demo: true }), null)
})

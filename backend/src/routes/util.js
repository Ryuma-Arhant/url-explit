import { ScrapeError } from '../services/errors.js'

// Express 4 does not catch rejected promises from async handlers — an
// uncaught throw used to kill the whole server. Route errors to next().
export const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}

export function sendScrapeError(res, err, label) {
  if (err instanceof ScrapeError) {
    console.warn(`${label} scrape failed [${err.code}]: ${err.message}`)
    return res.status(err.status).json({ error: err.message, code: err.code })
  }
  console.error(`${label} scrape crashed:`, err)
  return res.status(502).json({ error: 'Scraping failed unexpectedly. Try again.', code: 'SCRAPE_FAILED' })
}

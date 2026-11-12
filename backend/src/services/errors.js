// Errors that are safe to show to the user verbatim.
export class ScrapeError extends Error {
  constructor(message, code = 'SCRAPE_FAILED', status = 502) {
    super(message)
    this.name = 'ScrapeError'
    this.code = code
    this.status = status
  }
}

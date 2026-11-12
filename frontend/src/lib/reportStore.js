// Keeps the current report in sessionStorage so it survives navigating to a
// seller page and back (or a page refresh) within the same tab.
const KEY = 'trustlens:report'

export function loadReport() {
  try { return JSON.parse(sessionStorage.getItem(KEY)) } catch { return null }
}

export function saveReport(report) {
  try { sessionStorage.setItem(KEY, JSON.stringify(report)) } catch { /* storage full/blocked */ }
}

export function clearReport() {
  try { sessionStorage.removeItem(KEY) } catch { /* ignore */ }
}

// Fast audit of the fork Audiobookshelf SQLite DB. This measures the post-cleanup
// fork database, unlike library-cruft-regex.js which reads metadata.json sidecars.
//
//   node evals/audit/fork-db-cruft.js [DB_PATH]
//   default DB_PATH = .fork-data/config/absdatabase.sqlite
const fs = require('fs')
const path = require('path')
const sqlite3 = require('sqlite3')

const DEFAULT_DB = path.join(process.cwd(), '.fork-data', 'config', 'absdatabase.sqlite')
const ISSUE_KEYS = ['titleCruft', 'subtitleDupTitle', 'subtitleCruft', 'narratorIssue', 'mojibake']
const TITLE_CRUFT = /[\[\]{}]|\b(un)?abridged\b|\b\d{2,3}\s?k(bps)?\b|\bmp3\b|\bm4b\b|\bflac\b|\baudiobook\b|\bdramatized\b|\btrack\s*\d+\b|\b\d+\s*of\s*\d+\b/i
const MOJIBAKE = /Ãƒ.|Ã¢â‚¬|Ã‚.|ÃƒÂ¢|Ã¯Â¿Â½|â€™|Ã³|Ã¡|Ã©|Ã¼|Ã±/
const NARR_SEP = /\s&\s|;|\s\/\s|\bfeat\.?\b|\bwith\b|,\s*,|\s{2,}/i

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase()
const pct = (n, total) => (total ? ((100 * n) / total).toFixed(1) : '0.0') + '%'

function parseJsonArray(value) {
  if (Array.isArray(value)) return value
  if (!value) return []
  if (typeof value !== 'string') return [String(value)]
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed
    return parsed ? [parsed] : []
  } catch {
    return [value]
  }
}

function createEmptyAudit() {
  return {
    counted: 0,
    booksWithAny: 0,
    counts: Object.fromEntries(ISSUE_KEYS.map((k) => [k, 0])),
    flags: Object.fromEntries(ISSUE_KEYS.map((k) => [k, []]))
  }
}

function auditBookRows(rows) {
  const audit = createEmptyAudit()

  for (const row of rows) {
    audit.counted++
    const title = row.title || ''
    const subtitle = row.subtitle || ''
    const narrators = parseJsonArray(row.narrators).map((n) => String(n || '')).filter(Boolean)
    const narrStr = narrators.join(', ')
    const rel = row.relPath || row.path || row.libraryItemId || row.id || ''
    let any = false

    const flag = (key, example) => {
      audit.counts[key]++
      if (audit.flags[key].length < 25) audit.flags[key].push(example)
      any = true
    }

    if (TITLE_CRUFT.test(title)) flag('titleCruft', `${title}  [${rel}]`)
    if (subtitle && norm(subtitle) === norm(title)) flag('subtitleDupTitle', `${title}  [${rel}]`)
    else if (subtitle && TITLE_CRUFT.test(subtitle)) flag('subtitleCruft', `sub="${subtitle}"  [${rel}]`)
    if (narrStr && (NARR_SEP.test(narrStr) || new Set(narrators.map(norm)).size !== narrators.length)) flag('narratorIssue', `${narrStr}  [${rel}]`)
    if (MOJIBAKE.test(title) || MOJIBAKE.test(subtitle) || MOJIBAKE.test(narrStr)) flag('mojibake', `${title} | ${subtitle} | ${narrStr}  [${rel}]`)
    if (any) audit.booksWithAny++
  }

  return audit
}

function summarizeSuggestionRows(rows) {
  return {
    total: rows.reduce((sum, row) => sum + Number(row.count || 0), 0),
    rows: rows.map((row) => ({
      status: row.status || '(none)',
      issueType: row.issueType || '(none)',
      origin: row.origin || '(none)',
      count: Number(row.count || 0)
    }))
  }
}

function formatAuditReport(dbPath, audit, suggestionSummary) {
  const lines = []
  lines.push(`db: ${dbPath}`)
  lines.push(`books scanned: ${audit.counted}`)
  lines.push(`books with >=1 obvious issue: ${audit.booksWithAny} (${pct(audit.booksWithAny, audit.counted)})`)
  lines.push('')

  for (const key of ISSUE_KEYS) {
    lines.push(`### ${key} — ${audit.counts[key]} books (${pct(audit.counts[key], audit.counted)})`)
    audit.flags[key].slice(0, 10).forEach((example) => lines.push(`    ${example}`))
    lines.push('')
  }

  lines.push(`### aiSuggestions — ${suggestionSummary.total} rows`)
  if (!suggestionSummary.rows.length) {
    lines.push('    (none)')
  } else {
    suggestionSummary.rows.forEach((row) => lines.push(`    ${row.status} | ${row.issueType} | ${row.origin} | ${row.count}`))
  }
  lines.push('')

  return lines.join('\n')
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows)))
  })
}

async function run(dbPath = DEFAULT_DB) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`)
  }

  const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY)
  try {
    const books = await all(
      db,
      `
        SELECT
          li.id AS libraryItemId,
          li.relPath AS relPath,
          li.path AS path,
          b.title AS title,
          b.subtitle AS subtitle,
          b.narrators AS narrators
        FROM libraryItems li
        JOIN books b ON b.id = li.mediaId
        WHERE li.mediaType = 'book'
        ORDER BY li.relPath COLLATE NOCASE
      `
    )

    const suggestions = await all(
      db,
      `
        SELECT status, issueType, origin, COUNT(*) AS count
        FROM aiMetadataSuggestions
        GROUP BY status, issueType, origin
        ORDER BY status, issueType, origin
      `
    )

    return formatAuditReport(dbPath, auditBookRows(books), summarizeSuggestionRows(suggestions))
  } finally {
    db.close()
  }
}

if (require.main === module) {
  run(process.argv[2] || DEFAULT_DB)
    .then((report) => console.log(report))
    .catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
}

module.exports = {
  DEFAULT_DB,
  auditBookRows,
  summarizeSuggestionRows,
  formatAuditReport,
  run
}

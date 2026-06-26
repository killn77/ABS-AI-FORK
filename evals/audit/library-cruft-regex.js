// Fast, full-coverage audit of a real Audiobookshelf library: flags obvious metadata cruft
// across every metadata.json sidecar — no LLM, runs in seconds.
//
//   node evals/audit/library-cruft-regex.js [LIBRARY_ROOT]
//   (default LIBRARY_ROOT = Q:\Media\Audiobooks)
//
// Reports % of books with >=1 issue + per-category counts and examples. Used to establish that
// ~32% of the library has fixable metadata (dominated by subtitle==title), see STATE.md.
const fs = require('fs')
const path = require('path')
const ROOT = process.argv[2] || 'Q:\\Media\\Audiobooks'

function* walk(dir) {
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (e.name === 'metadata.json') yield p
  }
}

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase()
const TITLE_CRUFT = /[\[\]{}]|\b(un)?abridged\b|\b\d{2,3}\s?k(bps)?\b|\bmp3\b|\bm4b\b|\bflac\b|\baudiobook\b|\bdramatized\b|\btrack\s*\d+\b|\b\d+\s*of\s*\d+\b/i
const MOJIBAKE = /Ã.|â€|Â.|Ã¢|ï¿½/
const NARR_SEP = /\s&\s|;|\s\/\s|\bfeat\.?\b|\bwith\b|,\s*,|\s{2,}/i

const files = [...walk(ROOT)]
const flags = { titleCruft: [], subtitleDupTitle: [], subtitleCruft: [], narratorIssue: [], mojibake: [] }
const counts = { titleCruft: 0, subtitleDupTitle: 0, subtitleCruft: 0, narratorIssue: 0, mojibake: 0 }
let booksWithAny = 0
let counted = 0
let parseError = 0

for (const f of files) {
  let j
  try { j = JSON.parse(fs.readFileSync(f, 'utf8')) } catch { parseError++; continue }
  counted++
  const title = j.title || ''
  const subtitle = j.subtitle || ''
  const narrators = Array.isArray(j.narrators) ? j.narrators : j.narrators ? [j.narrators] : []
  const narrStr = narrators.join(', ')
  const rel = path.relative(ROOT, path.dirname(f))
  let any = false
  const flag = (k, ex) => { counts[k]++; if (flags[k].length < 25) flags[k].push(ex); any = true }

  if (TITLE_CRUFT.test(title)) flag('titleCruft', `${title}  [${rel}]`)
  if (subtitle && norm(subtitle) === norm(title)) flag('subtitleDupTitle', `${title}  [${rel}]`)
  else if (subtitle && TITLE_CRUFT.test(subtitle)) flag('subtitleCruft', `sub="${subtitle}"  [${rel}]`)
  if (narrStr && (NARR_SEP.test(narrStr) || new Set(narrators.map(norm)).size !== narrators.length)) flag('narratorIssue', `${narrStr}  [${rel}]`)
  if (MOJIBAKE.test(title) || MOJIBAKE.test(subtitle) || MOJIBAKE.test(narrStr)) flag('mojibake', `${title} | ${subtitle} | ${narrStr}  [${rel}]`)
  if (any) booksWithAny++
}

const pct = (n) => ((100 * n) / counted).toFixed(1) + '%'
console.log(`root: ${ROOT}`)
console.log(`books scanned: ${counted} (parse errors: ${parseError})`)
console.log(`books with >=1 obvious issue: ${booksWithAny} (${pct(booksWithAny)})\n`)
for (const k of ['titleCruft', 'subtitleDupTitle', 'subtitleCruft', 'narratorIssue', 'mojibake']) {
  console.log(`### ${k} — ${counts[k]} books (${pct(counts[k])})`)
  flags[k].slice(0, 10).forEach((x) => console.log('   ', x))
  console.log('')
}

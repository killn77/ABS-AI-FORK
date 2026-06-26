// LLM audit: run the real OllamaMetadataAdapter on a representative sample of a live library and
// report what it actually proposes (suggestion rate, field breakdown, full dump). Needs Ollama up.
//
//   node evals/audit/library-llm-sample.js [MODEL] [SAMPLE_SIZE] [LIBRARY_ROOT]
//   defaults: MODEL=qwen3:30b-a3b  SAMPLE_SIZE=60  LIBRARY_ROOT=Q:\Media\Audiobooks
//
// Established that ~33% of a sample gets suggestions, dominated by subtitle clears, narrators clean.
const fs = require('fs')
const path = require('path')
const OllamaMetadataAdapter = require('../../server/providers/OllamaMetadataAdapter')

const MODEL = process.argv[2] || 'qwen3:30b-a3b'
const SAMPLE = Number(process.argv[3] || 60)
const ROOT = process.argv[4] || 'Q:\\Media\\Audiobooks'
const BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'

function* walk(dir) {
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (e.name === 'metadata.json') yield p
  }
}

;(async () => {
  const files = [...walk(ROOT)]
  const step = Math.max(1, Math.floor(files.length / SAMPLE))
  const sample = files.filter((_, i) => i % step === 0).slice(0, SAMPLE)
  const adapter = new OllamaMetadataAdapter()
  let withSuggestions = 0
  const fieldCounts = {}
  let clears = 0
  const dump = []

  console.log(`LLM audit: model=${MODEL}  sample=${sample.length}/${files.length}  root=${ROOT}\n${'-'.repeat(70)}`)
  for (const f of sample) {
    let j
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')) } catch { continue }
    const fields = { title: j.title || null, subtitle: j.subtitle || null, narrators: Array.isArray(j.narrators) ? j.narrators : [] }
    let sugg = []
    try { sugg = await adapter.getSuggestions({ baseUrl: BASE_URL, model: MODEL, fields }) } catch (e) { sugg = [{ error: e.message }] }
    if (sugg.length) {
      withSuggestions++
      const rel = path.relative(ROOT, path.dirname(f))
      const lines = sugg.map((s) => {
        if (s.error) return `ERROR ${s.error}`
        fieldCounts[s.fieldName] = (fieldCounts[s.fieldName] || 0) + 1
        if (s.proposedValue === '') clears++
        return `${s.fieldName}: ${JSON.stringify(s.currentValue)} -> ${s.proposedValue === '' ? '[CLEAR]' : JSON.stringify(s.proposedValue)}`
      })
      dump.push(`• ${rel}\n    ${lines.join('\n    ')}`)
    }
  }
  console.log(`books with >=1 suggestion: ${withSuggestions}/${sample.length} (${((100 * withSuggestions) / sample.length).toFixed(0)}%)`)
  console.log(`field breakdown: ${JSON.stringify(fieldCounts)}  | clears: ${clears}\n`)
  console.log('ALL SUGGESTIONS:\n' + dump.join('\n'))
})().catch((e) => { console.error('audit failed:', e); process.exit(1) })

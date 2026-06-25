/**
 * AI metadata-cleanup eval runner.
 *
 * Runs every labeled case in cases.json through the real OllamaMetadataAdapter against a
 * chosen model, scores the suggestions with the pure scorer, and prints + writes a scorecard.
 *
 * Usage (from repo root, with Ollama running on the host):
 *   node evals/run-eval.js                      # defaults to qwen2.5:7b
 *   node evals/run-eval.js llama3.1             # pick a model
 *   OLLAMA_BASE_URL=http://127.0.0.1:11434 node evals/run-eval.js qwen2.5:7b
 *
 * Re-run after a prompt/adapter change to catch regressions; compare models head-to-head.
 */
const path = require('path')
const fs = require('fs')
const OllamaMetadataAdapter = require('../server/providers/OllamaMetadataAdapter')
const { scoreCase, aggregate } = require('./score')

const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
const model = process.argv[2] || process.env.OLLAMA_MODEL || 'qwen2.5:7b'
// OLLAMA_THINK=true|false overrides the adapter's think default (for comparing reasoning on/off)
const think = process.env.OLLAMA_THINK === undefined ? undefined : process.env.OLLAMA_THINK === 'true'
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'))

;(async () => {
  const adapter = new OllamaMetadataAdapter()
  const scored = []
  console.log(`\nEval  model=${model}  baseUrl=${baseUrl}  cases=${cases.length}\n${'-'.repeat(60)}`)

  for (const c of cases) {
    let suggestions = []
    let err = null
    try {
      suggestions = await adapter.getSuggestions({ baseUrl, model, fields: c.input, think })
    } catch (e) {
      err = e.message
    }
    const cs = scoreCase(c.expect, suggestions)
    scored.push({ id: c.id, category: c.category, ...cs, suggestions })
    const mark = cs.verdict === 'PASS' ? 'PASS' : cs.verdict === 'PARTIAL' ? 'PART' : 'FAIL'
    console.log(`[${mark}] ${c.id}  (${cs.passed}/${cs.total})${err ? '  ERROR: ' + err : ''}`)
    for (const r of cs.results) if (!r.pass) console.log(`        ${r.field}/${r.rule}: ${r.detail}`)
  }

  const agg = aggregate(scored)
  console.log(`${'-'.repeat(60)}\nSCORECARD (${model})`)
  console.log(JSON.stringify(agg, null, 2))

  const safeModel = model.replace(/[:\\/]/g, '_')
  const outPath = path.join(__dirname, `results-${safeModel}.json`)
  fs.writeFileSync(outPath, JSON.stringify({ model, baseUrl, aggregate: agg, cases: scored }, null, 2))
  console.log(`\nwrote ${path.relative(process.cwd(), outPath)}`)
})().catch((e) => {
  console.error('Eval failed:', e)
  process.exit(1)
})

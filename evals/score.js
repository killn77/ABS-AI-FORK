/**
 * Pure scoring for the AI metadata-cleanup eval harness. No network, no deps.
 *
 * A case's `expect` is a list of per-field rules describing what a CORRECT set of
 * suggestions looks like. We score the model's ACTUAL suggestions against them:
 *
 *   { field, rule, equals?, shouldContain?: [], mustNotContain?: [] }
 *
 * rule:
 *   'none'  - the model must NOT propose a change to this field (else false positive)
 *   'clear' - the model must propose emptying the field (proposedValue === '' or clear)
 *   'clean' | 'set' | 'normalize' - the model must propose a change, scored by:
 *        equals        -> case-insensitive exact match, OR
 *        shouldContain -> all substrings present (case-insensitive) AND
 *        mustNotContain-> no forbidden substrings present
 */

const FIELDS = ['title', 'subtitle', 'narrators']

function norm(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).join(', ')
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

/**
 * Score one case's expectations against the model's actual suggestions.
 * @param {Array} expectations
 * @param {Array} suggestions - descriptors from OllamaMetadataAdapter (fieldName, proposedValue, clear)
 * @returns {{verdict: string, passed: number, total: number, results: Array}}
 */
function scoreCase(expectations, suggestions) {
  const byField = {}
  for (const s of suggestions || []) byField[s.fieldName] = s

  const results = (expectations || []).map((exp) => {
    const s = byField[exp.field]
    const has = !!s
    let pass = false
    let detail = ''

    if (exp.rule === 'none') {
      pass = !has
      detail = has ? `false positive: proposed ${JSON.stringify(s.proposedValue)}` : 'correctly unchanged'
    } else if (exp.rule === 'clear') {
      if (!has) {
        pass = false
        detail = 'missed: no clear proposed'
      } else {
        pass = s.proposedValue === '' || s.clear === true
        detail = pass ? 'cleared' : `expected clear, got ${JSON.stringify(s.proposedValue)}`
      }
    } else {
      // 'clean' | 'set' | 'normalize'
      if (!has) {
        pass = false
        detail = 'missed: no suggestion'
      } else if (exp.equals !== undefined) {
        pass = norm(s.proposedValue).toLowerCase() === norm(exp.equals).toLowerCase()
        detail = pass ? 'exact match' : `expected ${JSON.stringify(exp.equals)}, got ${JSON.stringify(s.proposedValue)}`
      } else {
        const val = norm(s.proposedValue).toLowerCase()
        const missing = (exp.shouldContain || []).filter((c) => !val.includes(String(c).toLowerCase()))
        const forbidden = (exp.mustNotContain || []).filter((c) => val.includes(String(c).toLowerCase()))
        pass = missing.length === 0 && forbidden.length === 0
        detail = pass ? 'cleaned ok' : `missing ${JSON.stringify(missing)} / forbidden present ${JSON.stringify(forbidden)} in ${JSON.stringify(s.proposedValue)}`
      }
    }

    return { field: exp.field, rule: exp.rule, pass, detail }
  })

  const passed = results.filter((r) => r.pass).length
  const verdict = results.length === 0 ? 'PASS' : passed === results.length ? 'PASS' : passed === 0 ? 'FAIL' : 'PARTIAL'
  return { verdict, passed, total: results.length, results }
}

/**
 * Aggregate metrics across scored cases.
 * @param {Array} caseScores - outputs of scoreCase (each with an optional id)
 */
function aggregate(caseScores) {
  let expTotal = 0
  let expPass = 0
  let casesPass = 0
  let casesPartial = 0
  let casesFail = 0
  let falsePos = 0
  let falsePosTotal = 0
  let miss = 0
  let missTotal = 0

  for (const cs of caseScores) {
    expTotal += cs.total
    expPass += cs.passed
    if (cs.verdict === 'PASS') casesPass++
    else if (cs.verdict === 'PARTIAL') casesPartial++
    else casesFail++

    for (const r of cs.results) {
      if (r.rule === 'none') {
        falsePosTotal++
        if (!r.pass) falsePos++
      } else {
        missTotal++
        if (!r.pass && /missed/.test(r.detail)) miss++
      }
    }
  }

  const round = (n, d) => (d ? Number((n / d).toFixed(3)) : 0)
  return {
    cases: caseScores.length,
    casesPass,
    casesPartial,
    casesFail,
    expectationAccuracy: round(expPass, expTotal),
    falsePositiveRate: round(falsePos, falsePosTotal),
    missRate: round(miss, missTotal)
  }
}

module.exports = { scoreCase, aggregate, FIELDS, norm }

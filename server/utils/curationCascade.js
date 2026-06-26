/**
 * @typedef {Object} CleanResult
 * @property {string} field
 * @property {'accept'|'reject'|'escalate'} verdict
 * @property {'keep'|'rewrite'|'split'|'merge'|'flag'} action
 * @property {string} proposedValue
 * @property {number} confidence
 * @property {string[]} evidence
 * @property {string} stage
 * @property {string|null} model
 */

const DEFAULT_DELTA = 0.2

/**
 * Route a raw confidence into a verdict using the 0.5 +/- delta band.
 * @param {number} confidence
 * @param {number} [delta]
 * @returns {'accept'|'reject'|'escalate'}
 */
function gate(confidence, delta = DEFAULT_DELTA) {
  if (confidence >= 0.5 + delta) return 'accept'
  if (confidence <= 0.5 - delta) return 'reject'
  return 'escalate'
}

/**
 * Run an ordered list of stages over one field context. Each stage returns a
 * CleanResult or null (null = no opinion, continue). Stops at the first stage
 * whose verdict is not 'escalate'.
 * @param {object} ctx
 * @param {Array<(ctx) => (CleanResult|null|Promise<CleanResult|null>)>} stages
 * @returns {Promise<CleanResult|null>}
 */
async function runCascade(ctx, stages) {
  let last = null
  for (const stage of stages) {
    const result = await stage(ctx)
    if (!result) continue
    last = result
    if (result.verdict !== 'escalate') return result
  }
  return last
}

module.exports = { gate, runCascade, DEFAULT_DELTA }

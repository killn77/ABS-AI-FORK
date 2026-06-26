const { getDuplicateSubtitleCandidate, getSubtitleCruftCandidate } = require('./aiCleanupRules')
const { gate } = require('./curationCascade')

const DETERMINISTIC_SUBTITLE_RULES = [getDuplicateSubtitleCandidate, getSubtitleCruftCandidate]

/**
 * Deterministic subtitle stage. Runs the ordered subtitle rules; first hit wins
 * (duplicate-subtitle before subtitle-cruft). Returns an 'accept' CleanResult on a
 * hit, else an 'escalate' result. The raw rule candidate is carried on `.candidate`
 * for the manager's existing persistence path.
 * @param {{libraryItemId, mediaType, title, subtitle}} ctx
 */
function deterministicSubtitleStage(ctx) {
  for (const rule of DETERMINISTIC_SUBTITLE_RULES) {
    const candidate = rule(ctx)
    if (candidate) {
      return {
        field: 'subtitle',
        verdict: 'accept',
        action: 'rewrite',
        proposedValue: candidate.proposedValue,
        confidence: candidate.confidence,
        evidence: [candidate.rationale],
        stage: 'deterministic',
        model: null,
        candidate
      }
    }
  }
  return {
    field: 'subtitle',
    verdict: 'escalate',
    action: 'flag',
    proposedValue: ctx?.subtitle || '',
    confidence: 0.5,
    evidence: ['No deterministic subtitle rule matched'],
    stage: 'deterministic',
    model: null,
    candidate: null
  }
}

/**
 * Map a parsed OllamaMetadataAdapter descriptor into a CleanResult. Pure: feed it a
 * descriptor object (no network). Confidence is gated via the standard band.
 * @param {{fieldName, proposedValue, currentValue, confidence?, rationale?, clear?}} descriptor
 */
function ollamaDescriptorToCleanResult(descriptor) {
  const confidence = typeof descriptor.confidence === 'number' ? descriptor.confidence : 0.5
  return {
    field: descriptor.fieldName,
    verdict: gate(confidence),
    action: 'rewrite',
    proposedValue: descriptor.proposedValue,
    confidence,
    evidence: descriptor.rationale ? [descriptor.rationale] : [],
    stage: 'ollama',
    model: 'ollama'
  }
}

module.exports = { deterministicSubtitleStage, ollamaDescriptorToCleanResult }

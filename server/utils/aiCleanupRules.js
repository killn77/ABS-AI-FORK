const crypto = require('crypto')

function normalizeTextForCleanup(value) {
  if (typeof value !== 'string') return ''
  return value
    .normalize('NFKD')
    .replace(/[\u2018\u2019\u201C\u201D]/g, '')
    .replace(/[:;,.!?()[\]{}"'`]/g, ' ')
    .replace(/[-_/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function buildSourceHash(fields) {
  return crypto.createHash('sha1').update(JSON.stringify(fields || {})).digest('hex')
}

function getDuplicateSubtitleCandidate(input) {
  const title = input?.title
  const subtitle = input?.subtitle
  const normalizedTitle = normalizeTextForCleanup(title)
  const normalizedSubtitle = normalizeTextForCleanup(subtitle)

  if (!normalizedTitle || !normalizedSubtitle || normalizedTitle !== normalizedSubtitle) return null

  const sourceFields = { title, subtitle }

  return {
    libraryItemId: input.libraryItemId,
    mediaType: input.mediaType || 'book',
    issueType: 'duplicate-subtitle',
    origin: 'deterministic-rule',
    fieldName: 'subtitle',
    currentValue: subtitle,
    proposedValue: '',
    source: 'deterministic-rule',
    model: null,
    confidence: 1,
    rationale: 'Subtitle duplicates the title and can be cleared.',
    sourceHash: buildSourceHash(sourceFields),
    canFastApply: true
  }
}

module.exports = {
  normalizeTextForCleanup,
  buildSourceHash,
  getDuplicateSubtitleCandidate
}

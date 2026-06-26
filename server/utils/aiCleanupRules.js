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

const SUBTITLE_CRUFT_REGEX = /[\[\]{}]|\b(un)?abridged\b|\b\d{2,3}\s?k(bps)?\b|\bmp3\b|\bm4b\b|\bflac\b|\baudiobook\b|\bdramatized\b|\btrack\s*\d+\b|\b\d+\s*of\s*\d+\b/i

function stripCruftTokens(value) {
  if (typeof value !== 'string') return ''
  const cruftGlobal = new RegExp(SUBTITLE_CRUFT_REGEX.source, 'gi')
  return value
    .replace(cruftGlobal, ' ')
    .replace(/[\[\]{}():;,.!?"'`\-_/\\|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getSubtitleCruftCandidate(input) {
  const title = input?.title
  const subtitle = input?.subtitle
  if (typeof subtitle !== 'string' || !subtitle.trim()) return null

  // Defer to the duplicate-subtitle rule when the subtitle duplicates the title.
  const normalizedTitle = normalizeTextForCleanup(title)
  const normalizedSubtitle = normalizeTextForCleanup(subtitle)
  if (normalizedTitle && normalizedSubtitle && normalizedTitle === normalizedSubtitle) return null

  // Must contain cruft at all, and be WHOLE cruft (nothing meaningful remains).
  if (!SUBTITLE_CRUFT_REGEX.test(subtitle)) return null
  if (stripCruftTokens(subtitle) !== '') return null

  const sourceFields = { title, subtitle }

  return {
    libraryItemId: input.libraryItemId,
    mediaType: input.mediaType || 'book',
    issueType: 'subtitle-cruft',
    origin: 'deterministic-rule',
    fieldName: 'subtitle',
    currentValue: subtitle,
    proposedValue: '',
    source: 'deterministic-rule',
    model: null,
    confidence: 1,
    rationale: 'Subtitle contains only format or quality cruft and can be cleared.',
    sourceHash: buildSourceHash(sourceFields),
    canFastApply: true
  }
}

module.exports = {
  normalizeTextForCleanup,
  buildSourceHash,
  getDuplicateSubtitleCandidate,
  getSubtitleCruftCandidate,
  stripCruftTokens,
  SUBTITLE_CRUFT_REGEX
}

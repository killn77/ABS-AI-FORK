const Logger = require('../Logger')
const Database = require('../Database')
const { getDuplicateSubtitleCandidate } = require('../utils/aiCleanupRules')

class AiLibraryCleanupManager {
  clampLimit(limit, defaultValue = 100) {
    const n = parseInt(limit, 10)
    if (isNaN(n)) return defaultValue
    return Math.min(Math.max(n, 1), 1000)
  }

  buildSummary(candidates) {
    const groupsByType = {}
    for (const candidate of candidates || []) {
      if (!groupsByType[candidate.issueType]) {
        groupsByType[candidate.issueType] = {
          issueType: candidate.issueType,
          count: 0,
          canFastApply: Boolean(candidate.canFastApply),
          examples: []
        }
      }
      const group = groupsByType[candidate.issueType]
      group.count++
      if (group.examples.length < 10) {
        group.examples.push({
          libraryItemId: candidate.libraryItemId,
          title: candidate.title,
          fieldName: candidate.fieldName,
          currentValue: candidate.currentValue,
          proposedValue: candidate.proposedValue,
          rationale: candidate.rationale
        })
      }
    }

    return {
      total: candidates.length,
      groups: Object.values(groupsByType)
    }
  }

  extractCandidateFromItem(libraryItem) {
    if (!libraryItem?.isBook && libraryItem?.mediaType !== 'book') return null
    const media = libraryItem.media || {}
    const candidate = getDuplicateSubtitleCandidate({
      libraryItemId: libraryItem.id,
      mediaType: libraryItem.mediaType,
      title: media.title,
      subtitle: media.subtitle
    })
    if (!candidate) return null
    candidate.title = media.title || libraryItem.title || ''
    return candidate
  }

  async findCandidatesForLibrary(libraryId, opts = {}) {
    const limit = this.clampLimit(opts.limit, 1000)
    const rows = await Database.libraryItemModel.findAll({
      attributes: ['id'],
      where: { libraryId, mediaType: 'book' },
      order: [['createdAt', 'ASC']],
      limit
    })

    const candidates = []
    for (const row of rows) {
      const item = await Database.libraryItemModel.getExpandedById(row.id)
      const candidate = this.extractCandidateFromItem(item)
      if (candidate) candidates.push(candidate)
    }
    return candidates
  }

  async getCleanupSummary(libraryId, opts = {}) {
    const candidates = await this.findCandidatesForLibrary(libraryId, opts)
    return this.buildSummary(candidates)
  }

  async createSuggestionsForLibrary(libraryId, opts = {}) {
    const candidates = await this.findCandidatesForLibrary(libraryId, opts)
    const rows = []

    for (const candidate of candidates) {
      const existing = await Database.aiMetadataSuggestionModel.findOne({
        where: {
          libraryItemId: candidate.libraryItemId,
          fieldName: candidate.fieldName,
          issueType: candidate.issueType,
          sourceHash: candidate.sourceHash,
          status: 'pending'
        }
      })
      if (existing) continue

      rows.push(
        await Database.aiMetadataSuggestionModel.create({
          libraryItemId: candidate.libraryItemId,
          mediaType: candidate.mediaType,
          fieldName: candidate.fieldName,
          currentValue: candidate.currentValue,
          proposedValue: candidate.proposedValue,
          source: candidate.source,
          model: candidate.model,
          confidence: candidate.confidence,
          rationale: candidate.rationale,
          sourceHash: candidate.sourceHash,
          issueType: candidate.issueType,
          origin: candidate.origin,
          canFastApply: candidate.canFastApply,
          status: 'pending'
        })
      )
    }

    Logger.info(`[AiLibraryCleanupManager] Created ${rows.length} deterministic cleanup suggestion(s)`)
    return { candidates: candidates.length, suggestionsCreated: rows.length, suggestions: rows }
  }
}

module.exports = new AiLibraryCleanupManager()

const Logger = require('../Logger')
const Database = require('../Database')
const SocketAuthority = require('../SocketAuthority')
const { deterministicSubtitleStage } = require('../utils/curationStages')

class AiLibraryCleanupManager {
  clampLimit(limit, defaultValue = 100) {
    const n = parseInt(limit, 10)
    if (isNaN(n)) return defaultValue
    return Math.min(Math.max(n, 1), 1000)
  }

  buildSummary(candidates, stats = null) {
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

    const summary = {
      total: (candidates || []).length,
      groups: Object.values(groupsByType)
    }
    if (stats) summary.stageStats = stats
    return summary
  }

  runSubtitleStage(libraryItem) {
    if (!libraryItem?.isBook && libraryItem?.mediaType !== 'book') return null
    const media = libraryItem.media || {}
    return deterministicSubtitleStage({
      libraryItemId: libraryItem.id,
      mediaType: libraryItem.mediaType,
      title: media.title,
      subtitle: media.subtitle
    })
  }

  extractCandidateFromItem(libraryItem) {
    const result = this.runSubtitleStage(libraryItem)
    if (!result || result.verdict !== 'accept' || !result.candidate) return null
    const candidate = result.candidate
    candidate.title = (libraryItem.media && libraryItem.media.title) || libraryItem.title || ''
    return candidate
  }

  async findCandidatesForLibrary(libraryId, opts = {}) {
    const limit = this.clampLimit(opts.limit, 1000)
    const issueTypes = Array.isArray(opts.issueTypes) ? opts.issueTypes : null
    const rows = await Database.libraryItemModel.findAll({
      attributes: ['id'],
      where: { libraryId, mediaType: 'book' },
      order: [['createdAt', 'ASC']],
      limit
    })

    const candidates = []
    const stats = { evaluated: 0, deterministicResolved: 0, escalated: 0 }
    for (const row of rows) {
      const item = await Database.libraryItemModel.getExpandedById(row.id)
      const result = this.runSubtitleStage(item)
      if (!result) continue
      stats.evaluated++
      if (result.verdict === 'accept') stats.deterministicResolved++
      else if (result.verdict === 'escalate') stats.escalated++

      const candidate = this.extractCandidateFromItem(item)
      if (candidate && (!issueTypes || issueTypes.includes(candidate.issueType))) candidates.push(candidate)
    }
    return { candidates, stats }
  }

  async getCleanupSummary(libraryId, opts = {}) {
    const { candidates, stats } = await this.findCandidatesForLibrary(libraryId, opts)
    return this.buildSummary(candidates, stats)
  }

  async createSuggestionsForLibrary(libraryId, opts = {}) {
    const { candidates } = await this.findCandidatesForLibrary(libraryId, opts)
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

  buildMediaPayload(candidate) {
    return { metadata: { [candidate.fieldName]: candidate.proposedValue } }
  }

  valuesMatch(a, b) {
    if ((a === null || a === undefined || a === '') && (b === null || b === undefined || b === '')) return true
    return a === b
  }

  isCurrentValueStillMatching(libraryItem, candidate) {
    const media = libraryItem?.media || {}
    return this.valuesMatch(media[candidate.fieldName], candidate.currentValue)
  }

  async applyMediaPayload(libraryItem, payload) {
    const hasUpdates = await libraryItem.media.updateFromRequest(payload)
    if (!hasUpdates) return false

    libraryItem.changed('updatedAt', true)
    await libraryItem.save()
    await libraryItem.saveMetadataFile()
    SocketAuthority.libraryItemEmitter('item_updated', libraryItem)
    return true
  }

  async applyCleanupForLibrary(libraryId, userId, opts = {}) {
    if (opts.confirmApply !== true) {
      throw new Error('Bulk cleanup apply requires confirmApply=true')
    }

    const { candidates } = await this.findCandidatesForLibrary(libraryId, opts)
    const result = { candidates: candidates.length, applied: 0, skipped: 0, failed: 0, errors: [] }

    for (const candidate of candidates) {
      if (!candidate.canFastApply) {
        result.skipped++
        continue
      }

      try {
        const item = await Database.libraryItemModel.getExpandedById(candidate.libraryItemId)
        if (!this.isCurrentValueStillMatching(item, candidate)) {
          result.skipped++
          continue
        }

        const suggestion = await Database.aiMetadataSuggestionModel.create({
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
          status: 'accepted'
        })

        const updated = await this.applyMediaPayload(item, this.buildMediaPayload(candidate))
        if (!updated) {
          result.skipped++
          continue
        }

        await Database.aiMetadataReviewDecisionModel.create({
          suggestionId: suggestion.id,
          userId: userId || null,
          decision: 'accept',
          comment: 'Bulk applied deterministic cleanup.'
        })
        result.applied++
      } catch (error) {
        result.failed++
        result.errors.push({ libraryItemId: candidate.libraryItemId, error: error.message })
      }
    }

    Logger.info(`[AiLibraryCleanupManager] Bulk cleanup applied ${result.applied}/${result.candidates}`)
    return result
  }

  async revertSuggestion(suggestionId, userId) {
    const suggestion = await Database.aiMetadataSuggestionModel.findByPk(suggestionId)
    if (!suggestion) return null
    if (suggestion.status !== 'accepted') throw new Error('Only accepted suggestions can be reverted')

    const item = await Database.libraryItemModel.getExpandedById(suggestion.libraryItemId)
    if (!item) return null

    const media = item.media || {}
    if (!this.valuesMatch(media[suggestion.fieldName], suggestion.proposedValue)) {
      throw new Error('Suggestion is stale and cannot be reverted safely')
    }

    await this.applyMediaPayload(item, { metadata: { [suggestion.fieldName]: suggestion.currentValue } })
    suggestion.status = 'reverted'
    await suggestion.save()

    await Database.aiMetadataReviewDecisionModel.create({
      suggestionId,
      userId: userId || null,
      decision: 'revert',
      comment: 'Reverted deterministic cleanup.'
    })

    return suggestion
  }
}

module.exports = new AiLibraryCleanupManager()

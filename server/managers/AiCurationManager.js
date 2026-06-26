const crypto = require('crypto')
const { Op } = require('sequelize')
const Logger = require('../Logger')
const Database = require('../Database')
const OllamaMetadataAdapter = require('../providers/OllamaMetadataAdapter')
const { deterministicSubtitleStage } = require('../utils/curationStages')
const { planLlmFields, dropResolvedDescriptors, hasCuratableField, tagLlmDescriptor } = require('../utils/cascadeBatch')

/**
 * Manager for the review-first AI metadata curation feature (fork M0).
 *
 * Generates per-field metadata suggestions for a library item and persists them as
 * 'pending' rows. It NEVER writes to the library item itself — acceptance is applied by the
 * client via the existing, already-reviewed PATCH /api/items/:id/media path. This manager
 * only records the human decision and the suggestion's resolved status.
 */
class AiCurationManager {
  constructor() {
    this.adapter = new OllamaMetadataAdapter()
  }

  get validSuggestionStatuses() {
    return ['pending', 'accepted', 'rejected', 'reverted']
  }

  get settings() {
    return Database.serverSettings
  }

  /**
   * Extract the fields we curate from a (book) library item.
   * @param {import('../models/LibraryItem').LibraryItem} libraryItem
   * @returns {{ title: any, subtitle: any, narrators: any }}
   */
  extractFields(libraryItem) {
    const media = libraryItem.media || {}
    return {
      title: media.title ?? null,
      subtitle: media.subtitle ?? null,
      narrators: Array.isArray(media.narrators) ? media.narrators : []
    }
  }

  /**
   * Decide, synchronously, what the deterministic stage resolves for an item and which fields
   * remain for the LLM. Pure of DB/network so it is unit-testable.
   * @param {import('../models/LibraryItem').LibraryItem} libraryItem
   * @returns {{ detCandidate: object|null, llmFields: object, resolved: Set<string>, allFields: object }}
   */
  planItemCascade(libraryItem) {
    const media = libraryItem.media || {}
    const allFields = this.extractFields(libraryItem)
    const detResult = deterministicSubtitleStage({
      libraryItemId: libraryItem.id,
      mediaType: libraryItem.mediaType,
      title: media.title,
      subtitle: media.subtitle
    })
    const resolved = new Set()
    let detCandidate = null
    if (detResult && detResult.verdict === 'accept' && detResult.candidate) {
      detCandidate = detResult.candidate
      resolved.add(detCandidate.fieldName)
    }
    const llmFields = planLlmFields(allFields, resolved)
    return { detCandidate, llmFields, resolved, allFields }
  }

  /**
   * Stable hash of the source fields, for staleness detection.
   * @param {Object} fields
   * @returns {string}
   */
  hashFields(fields) {
    return crypto.createHash('sha1').update(JSON.stringify(fields)).digest('hex')
  }

  /**
   * Generate suggestions for a library item and persist them as pending rows.
   * Replaces any existing pending suggestions for the item so the inbox doesn't accumulate dupes.
   *
   * @param {import('../models/LibraryItem').LibraryItem} libraryItem
   * @returns {Promise<Array>} the created suggestion rows
   */
  async generateSuggestionsForItem(libraryItem) {
    if (!this.settings?.aiCurationEnabled) {
      throw new Error('AI curation is disabled')
    }
    if (!libraryItem?.isBook) {
      throw new Error('AI curation currently only supports book library items')
    }

    const fields = this.extractFields(libraryItem)
    const sourceHash = this.hashFields(fields)
    const model = this.settings.aiOllamaModel

    Logger.info(`[AiCurationManager] Generating suggestions for "${libraryItem.media?.title}" (${libraryItem.id})`)

    const descriptors = await this.adapter.getSuggestions({
      baseUrl: this.settings.aiOllamaBaseUrl,
      model,
      fields
    })

    // Clear previous pending suggestions for this item
    await Database.aiMetadataSuggestionModel.destroy({
      where: { libraryItemId: libraryItem.id, status: 'pending' }
    })

    if (!descriptors.length) {
      Logger.info(`[AiCurationManager] No suggestions for "${libraryItem.media?.title}"`)
      return []
    }

    const rows = await Database.aiMetadataSuggestionModel.bulkCreate(
      descriptors.map((d) => ({
        libraryItemId: libraryItem.id,
        mediaType: libraryItem.mediaType,
        sourceHash,
        rationale: d.rationale ?? null,
        status: 'pending',
        ...tagLlmDescriptor(d, model)
      }))
    )

    Logger.info(`[AiCurationManager] Created ${rows.length} suggestion(s) for "${libraryItem.media?.title}"`)
    return rows
  }

  /**
   * Run the deterministic->LLM cascade for one book item and persist pending rows.
   * Clears the item's existing pending rows once, then writes deterministic + tagged LLM rows.
   * @param {import('../models/LibraryItem').LibraryItem} libraryItem
   * @returns {Promise<{ suggestionsCreated: number, deterministicResolved: boolean, llmCalled: boolean, rows: Array }>}
   */
  async generateCascadeForItem(libraryItem) {
    const model = this.settings.aiOllamaModel
    const { detCandidate, llmFields, resolved, allFields } = this.planItemCascade(libraryItem)
    const sourceHash = this.hashFields(allFields)

    let descriptors = []
    let llmCalled = false
    if (hasCuratableField(llmFields)) {
      llmCalled = true
      try {
        const raw = await this.adapter.getSuggestions({ baseUrl: this.settings.aiOllamaBaseUrl, model, fields: llmFields })
        descriptors = dropResolvedDescriptors(raw, resolved)
      } catch (error) {
        Logger.error(`[AiCurationManager] Ollama failed for "${libraryItem.id}"`, error.message)
        descriptors = []
      }
    }

    await Database.aiMetadataSuggestionModel.destroy({
      where: { libraryItemId: libraryItem.id, status: 'pending' }
    })

    const rows = []
    if (detCandidate) {
      rows.push(
        await Database.aiMetadataSuggestionModel.create({
          libraryItemId: libraryItem.id,
          mediaType: detCandidate.mediaType,
          fieldName: detCandidate.fieldName,
          currentValue: detCandidate.currentValue,
          proposedValue: detCandidate.proposedValue,
          source: detCandidate.source,
          model: detCandidate.model,
          confidence: detCandidate.confidence,
          rationale: detCandidate.rationale,
          sourceHash: detCandidate.sourceHash,
          issueType: detCandidate.issueType,
          origin: detCandidate.origin,
          canFastApply: detCandidate.canFastApply,
          status: 'pending'
        })
      )
    }
    for (const d of descriptors) {
      rows.push(
        await Database.aiMetadataSuggestionModel.create({
          libraryItemId: libraryItem.id,
          mediaType: libraryItem.mediaType,
          sourceHash,
          rationale: d.rationale ?? null,
          status: 'pending',
          ...tagLlmDescriptor(d, model)
        })
      )
    }

    return { suggestionsCreated: rows.length, deterministicResolved: Boolean(detCandidate), llmCalled, rows }
  }

  /**
   * Get all suggestions for a library item (most recent first).
   * @param {string} libraryItemId
   * @returns {Promise<Array>}
   */
  async getSuggestionsForItem(libraryItemId) {
    return Database.aiMetadataSuggestionModel.findAll({
      where: { libraryItemId },
      order: [['createdAt', 'DESC']]
    })
  }

  /**
   * Normalize library inbox filters while preserving the historical pending-only default.
   * @param {Object} query
   * @returns {{ status: string, issueType: string|null, origin: string|null }}
   */
  normalizeSuggestionFilters(query = {}) {
    const rawStatus = typeof query.status === 'string' ? query.status.trim().toLowerCase() : 'pending'
    const status = rawStatus === 'all' || this.validSuggestionStatuses.includes(rawStatus) ? rawStatus : 'pending'
    const issueType = typeof query.issueType === 'string' && query.issueType.trim() ? query.issueType.trim() : null
    const origin = typeof query.origin === 'string' && query.origin.trim() ? query.origin.trim() : null
    return { status, issueType, origin }
  }

  /**
   * Convert normalized filters into a Sequelize where clause.
   * @param {{ status: string, issueType: string|null, origin: string|null }} filters
   * @returns {Object}
   */
  buildSuggestionWhere(filters) {
    const where = {}
    if (filters.status !== 'all') where.status = filters.status
    if (filters.issueType) where.issueType = filters.issueType
    if (filters.origin) where.origin = filters.origin
    return where
  }

  /**
   * Build compact counts for the inbox header.
   * @param {Array} rows
   * @returns {{ total: number, byStatus: Object, byIssueType: Object, byOrigin: Object, legacy: number, deterministic: number }}
   */
  buildSuggestionSummary(rows) {
    const summary = {
      total: rows.length,
      byStatus: {},
      byIssueType: {},
      byOrigin: {},
      legacy: 0,
      deterministic: 0
    }

    for (const row of rows) {
      const status = row.status || 'pending'
      const issueType = row.issueType || 'legacy'
      const origin = row.origin || 'legacy'
      summary.byStatus[status] = (summary.byStatus[status] || 0) + 1
      summary.byIssueType[issueType] = (summary.byIssueType[issueType] || 0) + 1
      summary.byOrigin[origin] = (summary.byOrigin[origin] || 0) + 1
      if (!row.issueType && !row.origin) summary.legacy++
      if (row.origin === 'deterministic-rule') summary.deterministic++
    }

    return summary
  }

  /**
   * The bulk curation inbox: filtered suggestions across one library, newest first,
   * each joined to its library item (id/title/mediaType) for display. Fast DB-only read.
   * @param {string} libraryId
   * @param {Object} [query]
   * @returns {Promise<Array>}
   */
  async getSuggestionsForLibrary(libraryId, query = {}) {
    const filters = this.normalizeSuggestionFilters(query)
    return Database.aiMetadataSuggestionModel.findAll({
      where: this.buildSuggestionWhere(filters),
      include: [
        {
          model: Database.libraryItemModel,
          where: { libraryId },
          required: true,
          attributes: ['id', 'title', 'mediaType']
        }
      ],
      order: [['createdAt', 'DESC']]
    })
  }

  /**
   * Historical pending-only library inbox helper.
   * @param {string} libraryId
   * @returns {Promise<Array>}
   */
  async getPendingSuggestionsForLibrary(libraryId) {
    return this.getSuggestionsForLibrary(libraryId, { status: 'pending' })
  }

  /**
   * Summarize all AI suggestion rows that belong to one library.
   * @param {string} libraryId
   * @returns {Promise<Object>}
   */
  async getSuggestionSummaryForLibrary(libraryId) {
    const rows = await Database.aiMetadataSuggestionModel.findAll({
      include: [
        {
          model: Database.libraryItemModel,
          where: { libraryId },
          required: true,
          attributes: []
        }
      ],
      order: [['createdAt', 'DESC']]
    })
    return this.buildSuggestionSummary(rows)
  }

  /**
   * Clamp a requested batch size to a safe range. Bounded because each item is a slow
   * Ollama call and the whole batch runs inside one request.
   * @param {any} limit
   * @returns {number}
   */
  clampBatchLimit(limit) {
    const n = parseInt(limit, 10)
    if (isNaN(n)) return 5
    return Math.min(Math.max(n, 1), 25)
  }

  /**
   * Generate suggestions for a bounded batch of book items in a library that don't yet have
   * pending suggestions. Sequential (Ollama is slow); intended to be called repeatedly to make
   * progress without a long-lived request. A background job is the M2 upgrade.
   *
   * @param {import('../models/Library').Library} library
   * @param {any} [limit]
   * @returns {Promise<{ processed: number, suggestionsCreated: number, remaining: number }>}
   */
  async generateForLibraryBatch(library, limit) {
    if (!this.settings?.aiCurationEnabled) {
      throw new Error('AI curation is disabled')
    }
    const batchSize = this.clampBatchLimit(limit)

    // Library items that already have a pending suggestion — skip them.
    const pending = await Database.aiMetadataSuggestionModel.findAll({
      attributes: ['libraryItemId'],
      where: { status: 'pending' },
      include: [{ model: Database.libraryItemModel, where: { libraryId: library.id }, required: true, attributes: [] }]
    })
    const skipIds = [...new Set(pending.map((p) => p.libraryItemId))]

    const where = { libraryId: library.id, mediaType: 'book' }
    if (skipIds.length) where.id = { [Op.notIn]: skipIds }

    const candidates = await Database.libraryItemModel.findAll({
      attributes: ['id'],
      where,
      order: [['createdAt', 'ASC']],
      limit: batchSize
    })

    let processed = 0
    let suggestionsCreated = 0
    let deterministicResolved = 0
    let llmItemsCalled = 0
    for (const row of candidates) {
      const item = await Database.libraryItemModel.getExpandedById(row.id)
      if (!item?.isBook) continue
      try {
        const r = await this.generateCascadeForItem(item)
        suggestionsCreated += r.suggestionsCreated
        if (r.deterministicResolved) deterministicResolved++
        if (r.llmCalled) llmItemsCalled++
        processed++
      } catch (error) {
        Logger.error(`[AiCurationManager] Batch item "${row.id}" failed`, error.message)
      }
    }

    const remaining = await Database.libraryItemModel.count({ where: { libraryId: library.id, mediaType: 'book' } })
    Logger.info(`[AiCurationManager] Library batch: processed ${processed}, deterministic ${deterministicResolved}, llm ${llmItemsCalled}, created ${suggestionsCreated} suggestion(s)`)
    return { processed, deterministicResolved, llmItemsCalled, suggestionsCreated, remaining }
  }

  /**
   * Record a human decision on a suggestion and resolve its status.
   * Field write-back (on accept) is performed by the client via PATCH /api/items/:id/media;
   * this only audits the decision.
   *
   * @param {string} suggestionId
   * @param {string} userId
   * @param {'accept'|'reject'|'edit'} decision
   * @param {string} [comment]
   * @returns {Promise<Object|null>} the updated suggestion, or null if not found
   */
  async submitDecision(suggestionId, userId, decision, comment) {
    const validDecisions = ['accept', 'reject', 'edit']
    if (!validDecisions.includes(decision)) {
      throw new Error(`Invalid decision "${decision}"`)
    }

    const suggestion = await Database.aiMetadataSuggestionModel.findByPk(suggestionId)
    if (!suggestion) return null

    await Database.aiMetadataReviewDecisionModel.create({
      suggestionId,
      userId: userId || null,
      decision,
      comment: comment || null
    })

    suggestion.status = decision === 'reject' ? 'rejected' : 'accepted'
    await suggestion.save()

    return suggestion
  }
}

module.exports = new AiCurationManager()

const crypto = require('crypto')
const Logger = require('../Logger')
const Database = require('../Database')
const OllamaMetadataAdapter = require('../providers/OllamaMetadataAdapter')

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
        fieldName: d.fieldName,
        currentValue: d.currentValue,
        proposedValue: d.proposedValue,
        source: d.source,
        model,
        confidence: d.confidence ?? null,
        rationale: d.rationale ?? null,
        sourceHash,
        status: 'pending'
      }))
    )

    Logger.info(`[AiCurationManager] Created ${rows.length} suggestion(s) for "${libraryItem.media?.title}"`)
    return rows
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

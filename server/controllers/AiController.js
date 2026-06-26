const Logger = require('../Logger')
const AiCurationManager = require('../managers/AiCurationManager')
const AiLibraryCleanupManager = require('../managers/AiLibraryCleanupManager')

/**
 * @typedef {import('express').Request & { user: import('../models/User'), libraryItem: import('../models/LibraryItem') }} RequestWithUser
 */

/**
 * Controller for the review-first AI metadata curation feature (fork M0).
 */
class AiController {
  constructor() {}

  /**
   * POST /api/items/:id/ai-suggestions
   * Generate (and persist as pending) AI metadata suggestions for a library item.
   * Access + canUpdate are enforced by LibraryItemController.middleware.
   *
   * @param {RequestWithUser} req
   * @param {import('express').Response} res
   */
  async generateSuggestions(req, res) {
    try {
      const suggestions = await AiCurationManager.generateSuggestionsForItem(req.libraryItem)
      res.json({ suggestions })
    } catch (error) {
      Logger.error(`[AiController] Failed to generate suggestions for "${req.params.id}"`, error.message)
      if (error.message === 'AI curation is disabled') return res.status(403).send(error.message)
      if (error.message?.startsWith('AI curation currently only supports')) return res.status(400).send(error.message)
      res.status(500).send('Failed to generate AI suggestions')
    }
  }

  /**
   * GET /api/items/:id/ai-suggestions
   * List persisted suggestions for a library item.
   * Access is enforced by LibraryItemController.middleware.
   *
   * @param {RequestWithUser} req
   * @param {import('express').Response} res
   */
  async getSuggestions(req, res) {
    try {
      const suggestions = await AiCurationManager.getSuggestionsForItem(req.libraryItem.id)
      res.json({ suggestions })
    } catch (error) {
      Logger.error(`[AiController] Failed to get suggestions for "${req.params.id}"`, error.message)
      res.status(500).send('Failed to get AI suggestions')
    }
  }

  /**
   * GET /api/libraries/:id/ai-suggestions
   * The bulk curation inbox: all pending suggestions across a library.
   * Access is enforced by LibraryController.middleware.
   *
   * @param {RequestWithUser} req
   * @param {import('express').Response} res
   */
  async getLibrarySuggestions(req, res) {
    try {
      const suggestions = await AiCurationManager.getSuggestionsForLibrary(req.library.id, req.query || {})
      res.json({ suggestions })
    } catch (error) {
      Logger.error(`[AiController] Failed to get library suggestions for "${req.params.id}"`, error.message)
      res.status(500).send('Failed to get library AI suggestions')
    }
  }

  /**
   * GET /api/libraries/:id/ai-suggestions/summary
   * Compact counts for the bulk curation inbox.
   * Access is enforced by LibraryController.middleware.
   *
   * @param {RequestWithUser} req
   * @param {import('express').Response} res
   */
  async getLibrarySuggestionSummary(req, res) {
    try {
      const summary = await AiCurationManager.getSuggestionSummaryForLibrary(req.library.id)
      res.json(summary)
    } catch (error) {
      Logger.error(`[AiController] Failed to get library suggestion summary for "${req.params.id}"`, error.message)
      res.status(500).send('Failed to get library AI suggestion summary')
    }
  }

  /**
   * POST /api/libraries/:id/ai-suggestions/generate
   * Generate suggestions for a bounded batch of book items lacking pending suggestions.
   * Body: { limit?: number }. Call repeatedly to make progress.
   *
   * @param {RequestWithUser} req
   * @param {import('express').Response} res
   */
  async generateLibrarySuggestions(req, res) {
    if (!req.user.canUpdate) {
      Logger.warn(`[AiController] User "${req.user.username}" attempted library batch generation without permission`)
      return res.sendStatus(403)
    }
    try {
      const summary = await AiCurationManager.generateForLibraryBatch(req.library, req.body?.limit)
      res.json(summary)
    } catch (error) {
      Logger.error(`[AiController] Failed to generate library suggestions for "${req.params.id}"`, error.message)
      if (error.message === 'AI curation is disabled') return res.status(403).send(error.message)
      res.status(500).send('Failed to generate library AI suggestions')
    }
  }

  /**
   * GET /api/libraries/:id/ai-cleanup/summary
   * Summarize deterministic cleanup candidates across a library.
   * Access is enforced by LibraryController.middleware.
   *
   * @param {RequestWithUser} req
   * @param {import('express').Response} res
   */
  async getCleanupSummary(req, res) {
    try {
      const summary = await AiLibraryCleanupManager.getCleanupSummary(req.library.id, req.query || {})
      res.json(summary)
    } catch (error) {
      Logger.error(`[AiController] Failed to get cleanup summary for "${req.params.id}"`, error.message)
      res.status(500).send('Failed to get AI cleanup summary')
    }
  }

  /**
   * POST /api/libraries/:id/ai-cleanup/suggestions
   * Convert deterministic cleanup candidates into reviewable suggestions.
   * Access is enforced by LibraryController.middleware; canUpdate is checked here.
   *
   * @param {RequestWithUser} req
   * @param {import('express').Response} res
   */
  async createCleanupSuggestions(req, res) {
    if (!req.user.canUpdate) {
      Logger.warn(`[AiController] User "${req.user.username}" attempted cleanup suggestion creation without permission`)
      return res.sendStatus(403)
    }
    try {
      const result = await AiLibraryCleanupManager.createSuggestionsForLibrary(req.library.id, req.body || {})
      res.json(result)
    } catch (error) {
      Logger.error(`[AiController] Failed to create cleanup suggestions for "${req.params.id}"`, error.message)
      res.status(500).send('Failed to create AI cleanup suggestions')
    }
  }

  /**
   * POST /api/libraries/:id/ai-cleanup/apply
   * Apply deterministic cleanup candidates after explicit confirmation.
   * Access is enforced by LibraryController.middleware; canUpdate is checked here.
   *
   * @param {RequestWithUser} req
   * @param {import('express').Response} res
   */
  async applyCleanup(req, res) {
    if (!req.user.canUpdate) {
      Logger.warn(`[AiController] User "${req.user.username}" attempted cleanup apply without permission`)
      return res.sendStatus(403)
    }
    try {
      const result = await AiLibraryCleanupManager.applyCleanupForLibrary(req.library.id, req.user.id, req.body || {})
      res.json(result)
    } catch (error) {
      Logger.error(`[AiController] Failed to apply cleanup for "${req.params.id}"`, error.message)
      if (error.message?.includes('confirmApply')) return res.status(400).send(error.message)
      res.status(500).send('Failed to apply AI cleanup')
    }
  }

  /**
   * POST /api/ai-suggestions/:suggestionId/revert
   * Revert an accepted suggestion when the current value still matches its proposed value.
   *
   * @param {RequestWithUser} req
   * @param {import('express').Response} res
   */
  async revertSuggestion(req, res) {
    if (!req.user.canUpdate) {
      Logger.warn(`[AiController] User "${req.user.username}" attempted suggestion revert without permission`)
      return res.sendStatus(403)
    }
    try {
      const suggestion = await AiLibraryCleanupManager.revertSuggestion(req.params.suggestionId, req.user.id)
      if (!suggestion) return res.sendStatus(404)
      res.json({ suggestion })
    } catch (error) {
      Logger.error(`[AiController] Failed to revert suggestion "${req.params.suggestionId}"`, error.message)
      if (error.message?.includes('stale') || error.message?.includes('Only accepted')) return res.status(400).send(error.message)
      res.status(500).send('Failed to revert AI suggestion')
    }
  }

  /**
   * POST /api/ai-suggestions/:suggestionId/decision
   * Record a human accept/reject/edit decision. Field write-back on accept is done by the
   * client via PATCH /api/items/:id/media; this only audits the decision + resolves status.
   *
   * @param {RequestWithUser} req
   * @param {import('express').Response} res
   */
  async submitDecision(req, res) {
    if (!req.user.canUpdate) {
      Logger.warn(`[AiController] User "${req.user.username}" attempted a review decision without permission`)
      return res.sendStatus(403)
    }

    const { decision, comment } = req.body || {}
    try {
      const suggestion = await AiCurationManager.submitDecision(req.params.suggestionId, req.user.id, decision, comment)
      if (!suggestion) return res.sendStatus(404)
      res.json({ suggestion })
    } catch (error) {
      Logger.error(`[AiController] Failed to submit decision for "${req.params.suggestionId}"`, error.message)
      if (error.message?.startsWith('Invalid decision')) return res.status(400).send(error.message)
      res.status(500).send('Failed to submit review decision')
    }
  }
}

module.exports = new AiController()

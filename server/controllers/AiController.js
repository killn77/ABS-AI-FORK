const Logger = require('../Logger')
const AiCurationManager = require('../managers/AiCurationManager')

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
      const suggestions = await AiCurationManager.getPendingSuggestionsForLibrary(req.library.id)
      res.json({ suggestions })
    } catch (error) {
      Logger.error(`[AiController] Failed to get library suggestions for "${req.params.id}"`, error.message)
      res.status(500).send('Failed to get library AI suggestions')
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

# AI Cleanup Harvest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 1 of the AI library cleanup roadmap: deterministic `subtitle == title` cleanup with both reviewable suggestions and confirmed fast apply.

**Architecture:** Add a deterministic cleanup rules module and a focused `AiLibraryCleanupManager` beside the existing `AiCurationManager`. Reuse `aiMetadataSuggestions` and `aiMetadataReviewDecisions`, adding metadata columns so deterministic candidates can be grouped, fast-applied, audited, and reverted safely. The UI extends the existing library AI Inbox rather than introducing a second cleanup surface.

**Tech Stack:** Node 20, Express, Sequelize, SQLite, Mocha/Chai, Nuxt 2/Vue, existing Audiobookshelf metadata update path.

---

## File Map

- Create `server/utils/aiCleanupRules.js`
  - Pure deterministic cleanup rules and helpers. No DB, no network, no Logger dependency.
- Create `test/server/utils/aiCleanupRules.test.js`
  - Unit tests for normalization, duplicate-subtitle detection, and source hashes.
- Create `server/migrations/v2.36.1-add-ai-suggestion-cleanup-columns.js`
  - Adds `issueType`, `origin`, and `canFastApply` to `aiMetadataSuggestions`.
- Modify `server/models/AiMetadataSuggestion.js`
  - Defines the new columns for fresh installs.
- Create `server/managers/AiLibraryCleanupManager.js`
  - Scans libraries, summarizes duplicate-subtitle candidates, creates deterministic suggestions, fast-applies candidates, and reverts accepted suggestions.
- Create `test/server/managers/AiLibraryCleanupManager.test.js`
  - Manager-level tests using stubs for DB/model calls where possible.
- Modify `server/controllers/AiController.js`
  - Adds cleanup summary, suggestion creation, fast apply, and revert handlers.
- Modify `server/routers/ApiRouter.js`
  - Adds cleanup routes under existing AI route families.
- Modify `client/pages/library/_library/ai-inbox.vue`
  - Adds deterministic cleanup summary, "Review first", and "Apply all" controls.
- Modify `client/strings/en-us.json`
  - Adds user-facing strings for the cleanup harvest UI.

## Task 1: Deterministic Cleanup Rules

**Files:**
- Create: `server/utils/aiCleanupRules.js`
- Test: `test/server/utils/aiCleanupRules.test.js`

- [ ] **Step 1: Write failing tests for normalization and duplicate-subtitle candidates**

Create `test/server/utils/aiCleanupRules.test.js`:

```js
const { expect } = require('chai')
const { normalizeTextForCleanup, buildSourceHash, getDuplicateSubtitleCandidate } = require('../../../server/utils/aiCleanupRules')

describe('aiCleanupRules', () => {
  describe('normalizeTextForCleanup', () => {
    it('normalizes case, punctuation spacing, and smart quotes for comparison', () => {
      expect(normalizeTextForCleanup('  The “Name”: A Novel  ')).to.equal('the name a novel')
      expect(normalizeTextForCleanup('The Name - A Novel')).to.equal('the name a novel')
    })

    it('returns an empty string for non-string values', () => {
      expect(normalizeTextForCleanup(null)).to.equal('')
      expect(normalizeTextForCleanup(undefined)).to.equal('')
      expect(normalizeTextForCleanup(42)).to.equal('')
    })
  })

  describe('buildSourceHash', () => {
    it('is stable for equivalent JSON-compatible values', () => {
      const a = buildSourceHash({ title: 'Dune', subtitle: 'Dune' })
      const b = buildSourceHash({ title: 'Dune', subtitle: 'Dune' })
      const c = buildSourceHash({ title: 'Dune', subtitle: 'Different' })

      expect(a).to.equal(b)
      expect(a).to.not.equal(c)
    })
  })

  describe('getDuplicateSubtitleCandidate', () => {
    it('returns a fast-applicable candidate when subtitle equals title', () => {
      const candidate = getDuplicateSubtitleCandidate({
        libraryItemId: 'item-1',
        mediaType: 'book',
        title: 'Project Hail Mary',
        subtitle: 'Project Hail Mary'
      })

      expect(candidate).to.deep.include({
        libraryItemId: 'item-1',
        mediaType: 'book',
        issueType: 'duplicate-subtitle',
        origin: 'deterministic-rule',
        fieldName: 'subtitle',
        currentValue: 'Project Hail Mary',
        proposedValue: null,
        confidence: 1,
        canFastApply: true
      })
      expect(candidate.rationale).to.equal('Subtitle duplicates the title and can be cleared.')
      expect(candidate.sourceHash).to.be.a('string').with.length(40)
    })

    it('detects duplicates after normalization', () => {
      const candidate = getDuplicateSubtitleCandidate({
        libraryItemId: 'item-1',
        mediaType: 'book',
        title: 'The Name: A Novel',
        subtitle: 'the name - a novel'
      })

      expect(candidate).to.not.equal(null)
      expect(candidate.proposedValue).to.equal(null)
    })

    it('returns null when subtitle is empty or informative', () => {
      expect(getDuplicateSubtitleCandidate({ title: 'Dune', subtitle: '' })).to.equal(null)
      expect(getDuplicateSubtitleCandidate({ title: 'Dune', subtitle: 'Book One' })).to.equal(null)
      expect(getDuplicateSubtitleCandidate({ title: '', subtitle: 'Dune' })).to.equal(null)
    })
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npx mocha test/server/utils/aiCleanupRules.test.js
```

Expected: fail because `server/utils/aiCleanupRules.js` does not exist.

- [ ] **Step 3: Implement the pure rules module**

Create `server/utils/aiCleanupRules.js`:

```js
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
    proposedValue: null,
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
```

- [ ] **Step 4: Run the rule tests and verify they pass**

Run:

```bash
npx mocha test/server/utils/aiCleanupRules.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/utils/aiCleanupRules.js test/server/utils/aiCleanupRules.test.js
git commit -m "Add deterministic AI cleanup rules"
```

## Task 2: Suggestion Metadata Columns

**Files:**
- Create: `server/migrations/v2.36.1-add-ai-suggestion-cleanup-columns.js`
- Modify: `server/models/AiMetadataSuggestion.js`

- [ ] **Step 1: Update the model for fresh installs**

Modify `server/models/AiMetadataSuggestion.js` by adding constructor fields after `sourceHash`:

```js
    /** @type {string} cleanup grouping key, e.g. 'duplicate-subtitle' */
    this.issueType
    /** @type {string} 'llm' | 'deterministic-rule' */
    this.origin
    /** @type {boolean} true when safe for confirmed bulk apply */
    this.canFastApply
```

Add columns in `static init`, after `sourceHash: DataTypes.STRING,`:

```js
        issueType: DataTypes.STRING,
        origin: DataTypes.STRING,
        canFastApply: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false
        },
```

- [ ] **Step 2: Add the migration for upgrades**

Create `server/migrations/v2.36.1-add-ai-suggestion-cleanup-columns.js`:

```js
const migrationVersion = '2.36.1'
const migrationName = `${migrationVersion}-add-ai-suggestion-cleanup-columns`
const loggerPrefix = `[${migrationVersion} migration]`

async function addColumnIfMissing(queryInterface, tableDescription, tableName, columnName, definition, logger) {
  if (tableDescription[columnName]) {
    logger.info(`${loggerPrefix} column "${tableName}.${columnName}" already exists`)
    return
  }
  logger.info(`${loggerPrefix} adding column "${tableName}.${columnName}"`)
  await queryInterface.addColumn(tableName, columnName, definition)
}

async function removeColumnIfExists(queryInterface, tableDescription, tableName, columnName, logger) {
  if (!tableDescription[columnName]) {
    logger.info(`${loggerPrefix} column "${tableName}.${columnName}" does not exist`)
    return
  }
  logger.info(`${loggerPrefix} removing column "${tableName}.${columnName}"`)
  await queryInterface.removeColumn(tableName, columnName)
}

async function up({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} UPGRADE BEGIN: ${migrationName}`)

  if (!(await queryInterface.tableExists('aiMetadataSuggestions'))) {
    logger.info(`${loggerPrefix} table "aiMetadataSuggestions" does not exist; fresh installs get columns from model sync`)
    logger.info(`${loggerPrefix} UPGRADE END: ${migrationName}`)
    return
  }

  const DataTypes = queryInterface.sequelize.Sequelize.DataTypes
  const table = await queryInterface.describeTable('aiMetadataSuggestions')

  await addColumnIfMissing(queryInterface, table, 'aiMetadataSuggestions', 'issueType', DataTypes.STRING, logger)
  await addColumnIfMissing(queryInterface, table, 'aiMetadataSuggestions', 'origin', DataTypes.STRING, logger)
  await addColumnIfMissing(
    queryInterface,
    table,
    'aiMetadataSuggestions',
    'canFastApply',
    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    logger
  )

  logger.info(`${loggerPrefix} UPGRADE END: ${migrationName}`)
}

async function down({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} DOWNGRADE BEGIN: ${migrationName}`)

  if (!(await queryInterface.tableExists('aiMetadataSuggestions'))) {
    logger.info(`${loggerPrefix} table "aiMetadataSuggestions" does not exist`)
    logger.info(`${loggerPrefix} DOWNGRADE END: ${migrationName}`)
    return
  }

  const table = await queryInterface.describeTable('aiMetadataSuggestions')
  await removeColumnIfExists(queryInterface, table, 'aiMetadataSuggestions', 'canFastApply', logger)
  await removeColumnIfExists(queryInterface, table, 'aiMetadataSuggestions', 'origin', logger)
  await removeColumnIfExists(queryInterface, table, 'aiMetadataSuggestions', 'issueType', logger)

  logger.info(`${loggerPrefix} DOWNGRADE END: ${migrationName}`)
}

module.exports = { up, down }
```

- [ ] **Step 3: Run the existing server tests**

Run:

```bash
npx mocha test/server/managers/AiCurationManager.test.js test/server/providers/OllamaMetadataAdapter.test.js
```

Expected: all tests pass, confirming the old AI flow tolerates the extra model fields.

- [ ] **Step 4: Commit**

```bash
git add server/models/AiMetadataSuggestion.js server/migrations/v2.36.1-add-ai-suggestion-cleanup-columns.js
git commit -m "Add cleanup metadata to AI suggestions"
```

## Task 3: Cleanup Manager Summary And Suggestions

**Files:**
- Create: `server/managers/AiLibraryCleanupManager.js`
- Test: `test/server/managers/AiLibraryCleanupManager.test.js`

- [ ] **Step 1: Write failing manager tests for pure manager helpers**

Create `test/server/managers/AiLibraryCleanupManager.test.js`:

```js
const { expect } = require('chai')
const AiLibraryCleanupManager = require('../../../server/managers/AiLibraryCleanupManager')

describe('AiLibraryCleanupManager', () => {
  describe('clampLimit', () => {
    it('defaults and clamps to a safe range', () => {
      expect(AiLibraryCleanupManager.clampLimit(undefined, 100)).to.equal(100)
      expect(AiLibraryCleanupManager.clampLimit('abc', 100)).to.equal(100)
      expect(AiLibraryCleanupManager.clampLimit(0, 100)).to.equal(1)
      expect(AiLibraryCleanupManager.clampLimit(5000, 100)).to.equal(1000)
      expect(AiLibraryCleanupManager.clampLimit('25', 100)).to.equal(25)
    })
  })

  describe('buildSummary', () => {
    it('groups duplicate-subtitle candidates with count and examples', () => {
      const summary = AiLibraryCleanupManager.buildSummary([
        { libraryItemId: '1', title: 'A', issueType: 'duplicate-subtitle', fieldName: 'subtitle', currentValue: 'A', proposedValue: null },
        { libraryItemId: '2', title: 'B', issueType: 'duplicate-subtitle', fieldName: 'subtitle', currentValue: 'B', proposedValue: null }
      ])

      expect(summary.total).to.equal(2)
      expect(summary.groups).to.have.length(1)
      expect(summary.groups[0]).to.deep.include({
        issueType: 'duplicate-subtitle',
        count: 2,
        canFastApply: true
      })
      expect(summary.groups[0].examples).to.have.length(2)
    })
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npx mocha test/server/managers/AiLibraryCleanupManager.test.js
```

Expected: fail because the manager file does not exist.

- [ ] **Step 3: Implement summary helpers and DB-backed scan methods**

Create `server/managers/AiLibraryCleanupManager.js`:

```js
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
```

- [ ] **Step 4: Run manager helper tests**

Run:

```bash
npx mocha test/server/managers/AiLibraryCleanupManager.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/managers/AiLibraryCleanupManager.js test/server/managers/AiLibraryCleanupManager.test.js
git commit -m "Add deterministic cleanup manager"
```

## Task 4: Cleanup Routes

**Files:**
- Modify: `server/controllers/AiController.js`
- Modify: `server/routers/ApiRouter.js`

- [ ] **Step 1: Add controller dependency**

At the top of `server/controllers/AiController.js`, add:

```js
const AiLibraryCleanupManager = require('../managers/AiLibraryCleanupManager')
```

- [ ] **Step 2: Add cleanup controller methods**

Inside `class AiController`, before `submitDecision`, add:

```js
  async getCleanupSummary(req, res) {
    try {
      const summary = await AiLibraryCleanupManager.getCleanupSummary(req.library.id, req.query || {})
      res.json(summary)
    } catch (error) {
      Logger.error(`[AiController] Failed to get cleanup summary for "${req.params.id}"`, error.message)
      res.status(500).send('Failed to get AI cleanup summary')
    }
  }

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
```

- [ ] **Step 3: Add routes**

In `server/routers/ApiRouter.js`, immediately after the existing library AI suggestion routes, add:

```js
    this.router.get('/libraries/:id/ai-cleanup/summary', LibraryController.middleware.bind(this), AiController.getCleanupSummary.bind(this))
    this.router.post('/libraries/:id/ai-cleanup/suggestions', LibraryController.middleware.bind(this), AiController.createCleanupSuggestions.bind(this))
```

- [ ] **Step 4: Run targeted tests**

Run:

```bash
npx mocha test/server/managers/AiCurationManager.test.js test/server/managers/AiLibraryCleanupManager.test.js
```

Expected: all tests pass and controller files load without syntax errors in the full suite later.

- [ ] **Step 5: Commit**

```bash
git add server/controllers/AiController.js server/routers/ApiRouter.js
git commit -m "Add AI cleanup summary routes"
```

## Task 5: Fast Apply And Revert

**Files:**
- Modify: `server/managers/AiLibraryCleanupManager.js`
- Modify: `server/controllers/AiController.js`
- Modify: `server/routers/ApiRouter.js`

- [ ] **Step 1: Add manager methods for media payload and stale checks**

In `server/managers/AiLibraryCleanupManager.js`, add these methods before `createSuggestionsForLibrary`:

```js
  buildMediaPayload(candidate) {
    return { metadata: { [candidate.fieldName]: candidate.proposedValue } }
  }

  isCurrentValueStillMatching(libraryItem, candidate) {
    const media = libraryItem?.media || {}
    return media[candidate.fieldName] === candidate.currentValue
  }
```

- [ ] **Step 2: Add fast apply implementation**

In `server/managers/AiLibraryCleanupManager.js`, add after `createSuggestionsForLibrary`:

```js
  async applyCleanupForLibrary(libraryId, userId, opts = {}) {
    if (opts.confirmApply !== true) {
      throw new Error('Bulk cleanup apply requires confirmApply=true')
    }

    const candidates = await this.findCandidatesForLibrary(libraryId, opts)
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

        await item.updateMedia(this.buildMediaPayload(candidate))
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
```

- [ ] **Step 3: Add revert implementation**

In `server/managers/AiLibraryCleanupManager.js`, add after `applyCleanupForLibrary`:

```js
  async revertSuggestion(suggestionId, userId) {
    const suggestion = await Database.aiMetadataSuggestionModel.findByPk(suggestionId)
    if (!suggestion) return null
    if (suggestion.status !== 'accepted') throw new Error('Only accepted suggestions can be reverted')

    const item = await Database.libraryItemModel.getExpandedById(suggestion.libraryItemId)
    if (!item) return null

    const media = item.media || {}
    if (media[suggestion.fieldName] !== suggestion.proposedValue) {
      throw new Error('Suggestion is stale and cannot be reverted safely')
    }

    await item.updateMedia({ metadata: { [suggestion.fieldName]: suggestion.currentValue } })
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
```

- [ ] **Step 4: Extend status and decision constants**

In `server/models/AiMetadataSuggestion.js`, add `REVERTED: 'reverted'` to `STATUS`.

In `server/models/AiMetadataReviewDecision.js`, add `REVERT: 'revert'` to `DECISION`.

- [ ] **Step 5: Add controller methods**

In `server/controllers/AiController.js`, add before `submitDecision`:

```js
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
```

- [ ] **Step 6: Add routes**

In `server/routers/ApiRouter.js`, add:

```js
    this.router.post('/libraries/:id/ai-cleanup/apply', LibraryController.middleware.bind(this), AiController.applyCleanup.bind(this))
```

near the other library AI cleanup routes.

Add:

```js
    this.router.post('/ai-suggestions/:suggestionId/revert', AiController.revertSuggestion.bind(this))
```

near the existing AI suggestion decision route.

- [ ] **Step 7: Run targeted tests**

Run:

```bash
npx mocha test/server/utils/aiCleanupRules.test.js test/server/managers/AiLibraryCleanupManager.test.js test/server/managers/AiCurationManager.test.js
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add server/managers/AiLibraryCleanupManager.js server/controllers/AiController.js server/routers/ApiRouter.js server/models/AiMetadataSuggestion.js server/models/AiMetadataReviewDecision.js
git commit -m "Add fast apply and revert for AI cleanup"
```

## Task 6: Inbox UI For Cleanup Harvest

**Files:**
- Modify: `client/pages/library/_library/ai-inbox.vue`
- Modify: `client/strings/en-us.json`

- [ ] **Step 1: Add strings**

Add these keys to `client/strings/en-us.json` near existing AI curation strings:

```json
"HeaderAiCleanupHarvest": "Cleanup harvest",
"MessageAiCleanupHarvestEmpty": "No deterministic cleanup candidates found.",
"LabelAiCleanupDuplicateSubtitle": "Duplicate subtitle",
"ButtonAiCleanupReviewFirst": "Review first",
"ButtonAiCleanupApplyAll": "Apply all",
"ConfirmAiCleanupApplyAll": "Apply all deterministic cleanup changes? This will clear duplicate subtitles after rechecking each item.",
"ToastAiCleanupSuggestionsCreated": "Created cleanup suggestions",
"ToastAiCleanupApplyComplete": "Cleanup applied"
```

- [ ] **Step 2: Add cleanup state**

In `client/pages/library/_library/ai-inbox.vue`, extend `data()`:

```js
      cleanupSummary: null,
      loadingCleanup: false,
      creatingCleanupSuggestions: false,
      applyingCleanup: false,
```

- [ ] **Step 3: Add computed duplicate subtitle group**

Add to `computed`:

```js
    duplicateSubtitleGroup() {
      return this.cleanupSummary?.groups?.find((g) => g.issueType === 'duplicate-subtitle') || null
    }
```

- [ ] **Step 4: Add cleanup methods**

Add to `methods`:

```js
    async loadCleanupSummary() {
      if (!this.currentLibraryId) return
      this.loadingCleanup = true
      const data = await this.$axios.$get(`/api/libraries/${this.currentLibraryId}/ai-cleanup/summary`).catch((error) => {
        console.error('Failed to load cleanup summary', error)
        return null
      })
      this.cleanupSummary = data
      this.loadingCleanup = false
    },
    async createCleanupSuggestions() {
      if (!this.currentLibraryId || !this.duplicateSubtitleGroup) return
      this.creatingCleanupSuggestions = true
      const res = await this.$axios.$post(`/api/libraries/${this.currentLibraryId}/ai-cleanup/suggestions`, {
        issueTypes: ['duplicate-subtitle']
      }).catch((error) => {
        const msg = error.response?.data || this.$strings.ToastAiSuggestionsFailed
        this.$toast.error(msg)
        return null
      })
      if (res) {
        this.$toast.success(`${this.$strings.ToastAiCleanupSuggestionsCreated}: ${res.suggestionsCreated}`)
        await this.loadInbox()
        await this.loadCleanupSummary()
      }
      this.creatingCleanupSuggestions = false
    },
    async applyCleanup() {
      if (!this.currentLibraryId || !this.duplicateSubtitleGroup) return
      if (!confirm(this.$strings.ConfirmAiCleanupApplyAll)) return
      this.applyingCleanup = true
      const res = await this.$axios.$post(`/api/libraries/${this.currentLibraryId}/ai-cleanup/apply`, {
        issueTypes: ['duplicate-subtitle'],
        confirmApply: true
      }).catch((error) => {
        const msg = error.response?.data || this.$strings.ToastFailedToUpdate
        this.$toast.error(msg)
        return null
      })
      if (res) {
        this.$toast.success(`${this.$strings.ToastAiCleanupApplyComplete}: ${res.applied} applied, ${res.skipped} skipped, ${res.failed} failed`)
        await this.loadInbox()
        await this.loadCleanupSummary()
      }
      this.applyingCleanup = false
    },
```

- [ ] **Step 5: Load cleanup summary with inbox**

In the watcher for `currentLibraryId`, change:

```js
      if (newVal) this.loadInbox()
```

to:

```js
      if (newVal) {
        this.loadInbox()
        this.loadCleanupSummary()
      }
```

In `mounted()`, change:

```js
    this.loadInbox()
```

to:

```js
    this.loadInbox()
    this.loadCleanupSummary()
```

- [ ] **Step 6: Add cleanup harvest panel to the template**

In `client/pages/library/_library/ai-inbox.vue`, insert this block after the header row and before the loading state:

```vue
        <div class="mb-6 bg-primary/40 rounded p-4 border border-white/10">
          <div class="flex items-center flex-wrap gap-2">
            <h2 class="text-lg font-semibold">{{ $strings.HeaderAiCleanupHarvest }}</h2>
            <div class="grow" />
            <span v-if="duplicateSubtitleGroup" class="text-sm text-gray-300">
              {{ $strings.LabelAiCleanupDuplicateSubtitle }}: {{ duplicateSubtitleGroup.count }}
            </span>
          </div>

          <div v-if="loadingCleanup" class="text-sm text-gray-400 mt-3">...</div>
          <div v-else-if="!duplicateSubtitleGroup" class="text-sm text-gray-400 mt-3">
            {{ $strings.MessageAiCleanupHarvestEmpty }}
          </div>
          <div v-else class="mt-3">
            <div class="space-y-1 mb-3">
              <p v-for="example in duplicateSubtitleGroup.examples.slice(0, 3)" :key="example.libraryItemId" class="text-xs text-gray-400 truncate">
                {{ example.title }} · {{ displayValue(example.currentValue) }} -> {{ displayValue(example.proposedValue) }}
              </p>
            </div>
            <div class="flex justify-end gap-2">
              <ui-btn small :loading="creatingCleanupSuggestions" :disabled="applyingCleanup" @click="createCleanupSuggestions">{{ $strings.ButtonAiCleanupReviewFirst }}</ui-btn>
              <ui-btn small color="success" :loading="applyingCleanup" :disabled="creatingCleanupSuggestions" @click="applyCleanup">{{ $strings.ButtonAiCleanupApplyAll }}</ui-btn>
            </div>
          </div>
        </div>
```

- [ ] **Step 7: Run syntax/build checks**

Run:

```bash
node -e "JSON.parse(require('fs').readFileSync('client/strings/en-us.json','utf8')); console.log('strings ok')"
npm run client
```

Expected: JSON parse succeeds and client build completes.

- [ ] **Step 8: Commit**

```bash
git add client/pages/library/_library/ai-inbox.vue client/strings/en-us.json
git commit -m "Add cleanup harvest controls to AI inbox"
```

## Task 7: Full Verification

**Files:**
- No code changes expected unless verification exposes a bug.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npx mocha test/server/utils/aiCleanupRules.test.js test/server/managers/AiLibraryCleanupManager.test.js test/server/managers/AiCurationManager.test.js test/server/providers/OllamaMetadataAdapter.test.js
```

Expected: all tests pass.

- [ ] **Step 2: Run full server suite**

Run:

```bash
npx mocha
```

Expected: all server and eval tests pass.

- [ ] **Step 3: Run client build**

Run:

```bash
npm run client
```

Expected: Nuxt client build completes.

- [ ] **Step 4: Inspect git state**

Run:

```bash
git status --short
```

Expected: clean working tree.

## Self-Review

Spec coverage:

- Fast Apply Mode is covered by Task 5 and Task 6.
- Review Queue Mode is covered by Task 3, Task 4, and Task 6.
- Deterministic duplicate-subtitle scanning is covered by Task 1 and Task 3.
- Schema dual-write is covered by Task 2.
- Revert support is covered by Task 5.
- AI/model-backed cleanup remains out of scope for Phase 1.

Placeholder scan:

- No plan step uses "TBD", "TODO", "implement later", or unconstrained "add error handling" language.

Type consistency:

- Candidate fields are consistent across `aiCleanupRules`, `AiLibraryCleanupManager`, model columns, API responses, and UI grouping: `issueType`, `origin`, `canFastApply`, `fieldName`, `currentValue`, `proposedValue`, `sourceHash`.

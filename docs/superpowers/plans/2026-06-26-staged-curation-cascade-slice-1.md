# Staged Curation Cascade — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the `CleanResult` cascade contract and run `subtitle-cruft` as the first deterministic stage, dry-run into the Curation Inbox, instrumented to measure how many fields the deterministic tier resolves vs. escalates.

**Architecture:** A pure, stage-agnostic cascade runner (`runCascade`) walks an ordered list of stages over one field and stops at the first non-`escalate` verdict. Stage adapters wrap the existing deterministic rules. `AiLibraryCleanupManager` runs the deterministic subtitle stage during its library walk, emits pending suggestions through the existing persistence path, and accumulates stage stats surfaced in the cleanup summary. No new write path; no live cloud calls; the Ollama stage adapter is built and unit-tested but not yet wired into the live walk.

**Tech Stack:** Node.js (CommonJS), Sequelize models via `server/Database`, Mocha + Chai tests (`npx mocha`), Nuxt 2 client (`npm run client`), Docker (`docker-compose.fork.yml`).

## Global Constraints

- Pure rule/cascade logic lives in `server/utils/*` with no `require` of `Database`, network, or sockets — so it is unit-testable without a DB.
- Suggestions are written ONLY through the existing `Database.aiMetadataSuggestionModel.create(...)` path used by `AiLibraryCleanupManager`. Do not add a third write path.
- New deterministic rule fires for WHOLE-cruft subtitles only (nothing meaningful remains after stripping cruft tokens); partial-cruft is skipped.
- The `duplicate-subtitle` rule takes precedence over `subtitle-cruft` for the same field (one issue per field).
- `issueType` for the new rule is exactly `subtitle-cruft`; `origin` is exactly `deterministic-rule`; `source` is exactly `deterministic-rule`; `confidence` is `1`; `canFastApply` is `true`.
- Match existing code style: 2-space indent, no semicolons omitted/added beyond the file's convention (the codebase omits semicolons), single quotes.
- Run the focused test suite after each task: `npx mocha test/server/utils/aiCleanupRules.test.js test/server/utils/curationCascade.test.js test/server/utils/curationStages.test.js test/server/managers/AiLibraryCleanupManager.test.js`

---

### Task 1: `subtitle-cruft` deterministic rule

**Files:**
- Modify: `server/utils/aiCleanupRules.js`
- Test: `test/server/utils/aiCleanupRules.test.js`

**Interfaces:**
- Consumes: existing `normalizeTextForCleanup`, `buildSourceHash` from the same module.
- Produces:
  - `SUBTITLE_CRUFT_REGEX: RegExp` — the cruft token pattern.
  - `stripCruftTokens(value: string): string` — value with cruft tokens + separators removed, whitespace collapsed; `''` for non-strings.
  - `getSubtitleCruftCandidate(input: {libraryItemId, mediaType, title, subtitle}): candidate | null` — same candidate shape as `getDuplicateSubtitleCandidate` but `issueType: 'subtitle-cruft'`, `rationale: 'Subtitle contains only format or quality cruft and can be cleared.'`.

- [ ] **Step 1: Write the failing tests**

Append to `test/server/utils/aiCleanupRules.test.js` (add the new exports to the top `require`):

```js
const { normalizeTextForCleanup, buildSourceHash, getDuplicateSubtitleCandidate, getSubtitleCruftCandidate, stripCruftTokens, SUBTITLE_CRUFT_REGEX } = require('../../../server/utils/aiCleanupRules')
```

```js
  describe('stripCruftTokens', () => {
    it('removes cruft tokens, brackets, and collapses whitespace', () => {
      expect(stripCruftTokens('Unabridged')).to.equal('')
      expect(stripCruftTokens('MP3 128kbps')).to.equal('')
      expect(stripCruftTokens('[Dramatized]')).to.equal('')
      expect(stripCruftTokens('A Novel [Unabridged]')).to.equal('A Novel')
    })

    it('returns an empty string for non-string values', () => {
      expect(stripCruftTokens(null)).to.equal('')
      expect(stripCruftTokens(42)).to.equal('')
    })
  })

  describe('getSubtitleCruftCandidate', () => {
    it('fires a fast-applicable clear for whole-cruft subtitles', () => {
      const candidate = getSubtitleCruftCandidate({
        libraryItemId: 'item-1',
        mediaType: 'book',
        title: 'Project Hail Mary',
        subtitle: 'Unabridged'
      })

      expect(candidate).to.deep.include({
        libraryItemId: 'item-1',
        mediaType: 'book',
        issueType: 'subtitle-cruft',
        origin: 'deterministic-rule',
        fieldName: 'subtitle',
        currentValue: 'Unabridged',
        proposedValue: '',
        confidence: 1,
        canFastApply: true
      })
      expect(candidate.rationale).to.equal('Subtitle contains only format or quality cruft and can be cleared.')
      expect(candidate.sourceHash).to.be.a('string').with.length(40)
    })

    it('fires for bitrate and bracketed format cruft', () => {
      expect(getSubtitleCruftCandidate({ title: 'Dune', subtitle: 'MP3 128kbps' })).to.not.equal(null)
      expect(getSubtitleCruftCandidate({ title: 'Dune', subtitle: '[Dramatized]' })).to.not.equal(null)
    })

    it('skips partial-cruft subtitles that retain real information', () => {
      expect(getSubtitleCruftCandidate({ title: 'Dune', subtitle: 'A Novel [Unabridged]' })).to.equal(null)
    })

    it('defers to duplicate-subtitle when the subtitle duplicates the title', () => {
      expect(getSubtitleCruftCandidate({ title: 'Unabridged', subtitle: 'Unabridged' })).to.equal(null)
    })

    it('skips clean, empty, and non-cruft subtitles', () => {
      expect(getSubtitleCruftCandidate({ title: 'Dune', subtitle: 'Book One' })).to.equal(null)
      expect(getSubtitleCruftCandidate({ title: 'Dune', subtitle: '' })).to.equal(null)
      expect(getSubtitleCruftCandidate({ title: 'Dune', subtitle: '   ' })).to.equal(null)
    })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx mocha test/server/utils/aiCleanupRules.test.js`
Expected: FAIL — `getSubtitleCruftCandidate`/`stripCruftTokens` are `undefined` (TypeError: not a function).

- [ ] **Step 3: Implement the rule**

In `server/utils/aiCleanupRules.js`, after `getDuplicateSubtitleCandidate` and before `module.exports`, add:

```js
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
```

Update `module.exports` to add the three new exports:

```js
module.exports = {
  normalizeTextForCleanup,
  buildSourceHash,
  getDuplicateSubtitleCandidate,
  getSubtitleCruftCandidate,
  stripCruftTokens,
  SUBTITLE_CRUFT_REGEX
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx mocha test/server/utils/aiCleanupRules.test.js`
Expected: PASS (all existing + new cases green).

- [ ] **Step 5: Commit**

```bash
git add server/utils/aiCleanupRules.js test/server/utils/aiCleanupRules.test.js
git commit -m "Add subtitle-cruft deterministic cleanup rule"
```

---

### Task 2: `CleanResult` cascade runner

**Files:**
- Create: `server/utils/curationCascade.js`
- Test: `test/server/utils/curationCascade.test.js`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `DEFAULT_DELTA: number` (`0.2`).
  - `gate(confidence: number, delta?: number): 'accept'|'reject'|'escalate'` — `>= 0.5+delta` → accept, `<= 0.5-delta` → reject, else escalate.
  - `runCascade(ctx: object, stages: Array<(ctx) => CleanResult|null|Promise<CleanResult|null>>): Promise<CleanResult|null>` — runs stages in order, returns the first result whose `verdict !== 'escalate'`, else the last non-null result, else `null`.
  - `CleanResult` shape: `{ field, verdict, action, proposedValue, confidence, evidence, stage, model }` (documented via JSDoc).

- [ ] **Step 1: Write the failing tests**

Create `test/server/utils/curationCascade.test.js`:

```js
const { expect } = require('chai')
const { gate, runCascade, DEFAULT_DELTA } = require('../../../server/utils/curationCascade')

describe('curationCascade', () => {
  describe('gate', () => {
    it('routes confidence into accept/reject/escalate around the 0.5 +/- delta band', () => {
      expect(gate(0.9)).to.equal('accept')
      expect(gate(0.1)).to.equal('reject')
      expect(gate(0.5)).to.equal('escalate')
      expect(gate(0.5 + DEFAULT_DELTA)).to.equal('accept')
      expect(gate(0.5 - DEFAULT_DELTA)).to.equal('reject')
    })

    it('honors a custom delta', () => {
      expect(gate(0.6, 0.05)).to.equal('accept')
      expect(gate(0.6, 0.2)).to.equal('escalate')
    })
  })

  describe('runCascade', () => {
    const accept = (field) => ({ field, verdict: 'accept', action: 'rewrite', proposedValue: 'x', confidence: 1, evidence: [], stage: 'a', model: null })
    const escalate = (field) => ({ field, verdict: 'escalate', action: 'flag', proposedValue: '', confidence: 0.5, evidence: [], stage: 'b', model: null })

    it('stops at the first non-escalate verdict', async () => {
      const calls = []
      const result = await runCascade({ field: 'subtitle' }, [
        (ctx) => { calls.push('s1'); return accept(ctx.field) },
        (ctx) => { calls.push('s2'); return accept(ctx.field) }
      ])
      expect(calls).to.deep.equal(['s1'])
      expect(result.verdict).to.equal('accept')
    })

    it('falls through escalate stages and returns the last result', async () => {
      const result = await runCascade({ field: 'subtitle' }, [
        (ctx) => escalate(ctx.field),
        (ctx) => escalate(ctx.field)
      ])
      expect(result.verdict).to.equal('escalate')
      expect(result.stage).to.equal('b')
    })

    it('skips stages that return null and returns null when no stage produces a result', async () => {
      const result = await runCascade({ field: 'subtitle' }, [() => null, () => null])
      expect(result).to.equal(null)
    })

    it('awaits async stages', async () => {
      const result = await runCascade({ field: 'subtitle' }, [async (ctx) => accept(ctx.field)])
      expect(result.verdict).to.equal('accept')
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx mocha test/server/utils/curationCascade.test.js`
Expected: FAIL — cannot find module `server/utils/curationCascade`.

- [ ] **Step 3: Implement the runner**

Create `server/utils/curationCascade.js`:

```js
/**
 * @typedef {Object} CleanResult
 * @property {string} field
 * @property {'accept'|'reject'|'escalate'} verdict
 * @property {'keep'|'rewrite'|'split'|'merge'|'flag'} action
 * @property {string} proposedValue
 * @property {number} confidence
 * @property {string[]} evidence
 * @property {string} stage
 * @property {string|null} model
 */

const DEFAULT_DELTA = 0.2

/**
 * Route a raw confidence into a verdict using the 0.5 +/- delta band.
 * @param {number} confidence
 * @param {number} [delta]
 * @returns {'accept'|'reject'|'escalate'}
 */
function gate(confidence, delta = DEFAULT_DELTA) {
  if (confidence >= 0.5 + delta) return 'accept'
  if (confidence <= 0.5 - delta) return 'reject'
  return 'escalate'
}

/**
 * Run an ordered list of stages over one field context. Each stage returns a
 * CleanResult or null (null = no opinion, continue). Stops at the first stage
 * whose verdict is not 'escalate'.
 * @param {object} ctx
 * @param {Array<(ctx) => (CleanResult|null|Promise<CleanResult|null>)>} stages
 * @returns {Promise<CleanResult|null>}
 */
async function runCascade(ctx, stages) {
  let last = null
  for (const stage of stages) {
    const result = await stage(ctx)
    if (!result) continue
    last = result
    if (result.verdict !== 'escalate') return result
  }
  return last
}

module.exports = { gate, runCascade, DEFAULT_DELTA }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx mocha test/server/utils/curationCascade.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/utils/curationCascade.js test/server/utils/curationCascade.test.js
git commit -m "Add CleanResult cascade runner"
```

---

### Task 3: Deterministic + Ollama stage adapters

**Files:**
- Create: `server/utils/curationStages.js`
- Test: `test/server/utils/curationStages.test.js`

**Interfaces:**
- Consumes: `getDuplicateSubtitleCandidate`, `getSubtitleCruftCandidate` from `./aiCleanupRules`; the `CleanResult` shape from Task 2.
- Produces:
  - `deterministicSubtitleStage(ctx: {libraryItemId, mediaType, title, subtitle}): CleanResult` — runs `duplicate-subtitle` then `subtitle-cruft`; on a hit returns `verdict: 'accept'`, `confidence: 1`, and a non-standard `candidate` property carrying the raw rule candidate for persistence; on no hit returns `verdict: 'escalate'`, `candidate: null`.
  - `ollamaDescriptorToCleanResult(descriptor: {fieldName, proposedValue, currentValue, confidence?, rationale?, clear?}): CleanResult` — maps a parsed `OllamaMetadataAdapter` descriptor into a `CleanResult` with `stage: 'ollama'`, `model: 'ollama'`, gating its confidence via `gate()` (default confidence `0.5` when the descriptor omits it).

- [ ] **Step 1: Write the failing tests**

Create `test/server/utils/curationStages.test.js`:

```js
const { expect } = require('chai')
const { deterministicSubtitleStage, ollamaDescriptorToCleanResult } = require('../../../server/utils/curationStages')

describe('curationStages', () => {
  describe('deterministicSubtitleStage', () => {
    it('accepts a duplicate-subtitle hit and carries the candidate', () => {
      const result = deterministicSubtitleStage({ libraryItemId: '1', mediaType: 'book', title: 'Dune', subtitle: 'Dune' })
      expect(result.verdict).to.equal('accept')
      expect(result.stage).to.equal('deterministic')
      expect(result.candidate.issueType).to.equal('duplicate-subtitle')
      expect(result.proposedValue).to.equal('')
    })

    it('accepts a subtitle-cruft hit when not a duplicate', () => {
      const result = deterministicSubtitleStage({ libraryItemId: '1', mediaType: 'book', title: 'Dune', subtitle: 'Unabridged' })
      expect(result.verdict).to.equal('accept')
      expect(result.candidate.issueType).to.equal('subtitle-cruft')
    })

    it('escalates when no deterministic rule matches', () => {
      const result = deterministicSubtitleStage({ libraryItemId: '1', mediaType: 'book', title: 'Dune', subtitle: 'A Novel [Unabridged]' })
      expect(result.verdict).to.equal('escalate')
      expect(result.candidate).to.equal(null)
    })
  })

  describe('ollamaDescriptorToCleanResult', () => {
    it('maps a confident clear descriptor into an accept CleanResult', () => {
      const result = ollamaDescriptorToCleanResult({ fieldName: 'subtitle', proposedValue: '', currentValue: 'Unabridged', confidence: 0.95, clear: true, rationale: 'cruft' })
      expect(result).to.deep.include({ field: 'subtitle', verdict: 'accept', proposedValue: '', stage: 'ollama', model: 'ollama' })
      expect(result.evidence).to.deep.equal(['cruft'])
    })

    it('escalates a low-confidence descriptor and defaults missing confidence to escalate', () => {
      expect(ollamaDescriptorToCleanResult({ fieldName: 'subtitle', proposedValue: 'A Novel', currentValue: 'x' }).verdict).to.equal('escalate')
      expect(ollamaDescriptorToCleanResult({ fieldName: 'subtitle', proposedValue: 'A Novel', currentValue: 'x', confidence: 0.55 }).verdict).to.equal('escalate')
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx mocha test/server/utils/curationStages.test.js`
Expected: FAIL — cannot find module `server/utils/curationStages`.

- [ ] **Step 3: Implement the stage adapters**

Create `server/utils/curationStages.js`:

```js
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
    action: descriptor.clear ? 'rewrite' : 'rewrite',
    proposedValue: descriptor.proposedValue,
    confidence,
    evidence: descriptor.rationale ? [descriptor.rationale] : [],
    stage: 'ollama',
    model: 'ollama'
  }
}

module.exports = { deterministicSubtitleStage, ollamaDescriptorToCleanResult }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx mocha test/server/utils/curationStages.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/utils/curationStages.js test/server/utils/curationStages.test.js
git commit -m "Add deterministic and ollama curation stage adapters"
```

---

### Task 4: Wire the deterministic stage + escalation stats into the manager

**Files:**
- Modify: `server/managers/AiLibraryCleanupManager.js`
- Test: `test/server/managers/AiLibraryCleanupManager.test.js`

**Interfaces:**
- Consumes: `deterministicSubtitleStage` from `../utils/curationStages`.
- Produces:
  - `runSubtitleStage(libraryItem): CleanResult|null` — returns the deterministic stage result for a book item, or `null` for non-books.
  - `buildSummary(candidates, stats?)` — unchanged grouping plus an optional `stats` object merged onto the returned summary under `stageStats`.
  - `findCandidatesForLibrary` now returns `{ candidates: [...], stats: { evaluated, deterministicResolved, escalated } }` (previously returned the array). Internal callers updated.

**Note:** `findCandidatesForLibrary`'s return shape changes from `Array` to `{candidates, stats}`. The three internal callers (`getCleanupSummary`, `createSuggestionsForLibrary`, `applyCleanupForLibrary`) are updated in this same task so the change is self-contained.

- [ ] **Step 1: Write the failing tests**

Append to `test/server/managers/AiLibraryCleanupManager.test.js`:

```js
  describe('runSubtitleStage', () => {
    it('returns a subtitle-cruft accept for a whole-cruft subtitle book item', () => {
      const result = AiLibraryCleanupManager.runSubtitleStage({ id: '1', mediaType: 'book', isBook: true, media: { title: 'Dune', subtitle: 'Unabridged' } })
      expect(result.verdict).to.equal('accept')
      expect(result.candidate.issueType).to.equal('subtitle-cruft')
    })

    it('escalates a partial-cruft subtitle book item', () => {
      const result = AiLibraryCleanupManager.runSubtitleStage({ id: '1', mediaType: 'book', isBook: true, media: { title: 'Dune', subtitle: 'A Novel [Unabridged]' } })
      expect(result.verdict).to.equal('escalate')
    })

    it('returns null for non-book items', () => {
      expect(AiLibraryCleanupManager.runSubtitleStage({ id: '1', mediaType: 'podcast', media: {} })).to.equal(null)
    })
  })

  describe('buildSummary with stageStats', () => {
    it('merges stage stats onto the summary when provided', () => {
      const summary = AiLibraryCleanupManager.buildSummary([], { evaluated: 8, deterministicResolved: 2, escalated: 6 })
      expect(summary.stageStats).to.deep.equal({ evaluated: 8, deterministicResolved: 2, escalated: 6 })
    })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx mocha test/server/managers/AiLibraryCleanupManager.test.js`
Expected: FAIL — `runSubtitleStage` is not a function; `buildSummary` ignores the second arg.

- [ ] **Step 3: Implement the wiring**

In `server/managers/AiLibraryCleanupManager.js`:

Replace the top require line:

```js
const { getDuplicateSubtitleCandidate } = require('../utils/aiCleanupRules')
```

with:

```js
const { deterministicSubtitleStage } = require('../utils/curationStages')
```

Replace `buildSummary(candidates)` signature/return to accept stats:

```js
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
```

Replace `extractCandidateFromItem` with `runSubtitleStage` + a thin candidate extractor:

```js
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
```

Replace `findCandidatesForLibrary` to also accumulate stats:

```js
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
```

Update the three callers to destructure the new shape:

`getCleanupSummary`:

```js
  async getCleanupSummary(libraryId, opts = {}) {
    const { candidates, stats } = await this.findCandidatesForLibrary(libraryId, opts)
    return this.buildSummary(candidates, stats)
  }
```

`createSuggestionsForLibrary` — change the first line:

```js
  async createSuggestionsForLibrary(libraryId, opts = {}) {
    const { candidates } = await this.findCandidatesForLibrary(libraryId, opts)
    const rows = []
```

`applyCleanupForLibrary` — change the candidates line:

```js
    const { candidates } = await this.findCandidatesForLibrary(libraryId, opts)
    const result = { candidates: candidates.length, applied: 0, skipped: 0, failed: 0, errors: [] }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx mocha test/server/managers/AiLibraryCleanupManager.test.js test/server/utils/aiCleanupRules.test.js test/server/utils/curationCascade.test.js test/server/utils/curationStages.test.js`
Expected: PASS (all suites).

- [ ] **Step 5: Run the full AI test set to confirm no regressions**

Run: `npx mocha test/server/managers/AiCurationManager.test.js test/server/managers/AiLibraryCleanupManager.test.js test/server/utils/aiCleanupRules.test.js test/server/utils/curationCascade.test.js test/server/utils/curationStages.test.js`
Expected: PASS (all suites green; previously 21 passing plus the new cases).

- [ ] **Step 6: Commit**

```bash
git add server/managers/AiLibraryCleanupManager.js test/server/managers/AiLibraryCleanupManager.test.js
git commit -m "Run subtitle cascade stage and stage stats in cleanup manager"
```

---

### Task 5: Surface `subtitle-cruft` label and stage stats in the AI Inbox

**Files:**
- Modify: `client/strings/en-us.json`
- Modify: `client/pages/library/_library/ai-inbox.vue`
- Test: build verification (`npm run client`) + Docker browser check.

**Interfaces:**
- Consumes: the `stageStats` object now present on the cleanup summary response (Task 4) and the `issueType: 'subtitle-cruft'` rows.
- Produces: a human label for the new issue type and a small "deterministic vs escalated" stat line in the cleanup harvest panel. No new endpoint.

**Note:** This task is UI glue; verify via build + browser, not unit tests. If the AI Inbox already renders `issueType` generically (badge shows the raw string), the only required change is the label string and the stat line; confirm by reading the cleanup-panel section of `ai-inbox.vue` before editing.

- [ ] **Step 1: Add the label string**

In `client/strings/en-us.json`, add a key near the other AI cleanup labels (search for an existing `"duplicate-subtitle"` or `LabelAi`-prefixed key to match the established naming; if issue types are rendered raw, add a `LabelAiIssueSubtitleCruft` key and a matching lookup, otherwise add the raw-string label):

```json
"LabelAiIssueSubtitleCruft": "Subtitle cruft",
```

- [ ] **Step 2: Read the cleanup panel markup**

Run: open `client/pages/library/_library/ai-inbox.vue` and locate (a) where the cleanup harvest summary (`groups` / duplicate-subtitle count) is rendered and (b) the response object holding the summary. Confirm whether `issueType` badges render raw or via a label map.

- [ ] **Step 3: Render the stage-stats line**

In the cleanup harvest panel section of `ai-inbox.vue`, where the summary is shown, add a read-only stat line bound to `summary.stageStats` (guard with `v-if`):

```html
<div v-if="cleanupSummary && cleanupSummary.stageStats" class="text-xs text-gray-300 mt-1">
  Deterministic resolved {{ cleanupSummary.stageStats.deterministicResolved }} /
  escalated {{ cleanupSummary.stageStats.escalated }} of
  {{ cleanupSummary.stageStats.evaluated }} evaluated
</div>
```

(Adjust the binding name `cleanupSummary` to whatever the component already stores the summary in — confirm in Step 2.)

- [ ] **Step 4: Build the client**

Run: `npm run client`
Expected: Nuxt generates successfully. Pre-existing warnings (npm audit, deprecated packages, asset-size, `fs.existsSync` deprecation) remain; no new errors referencing `ai-inbox.vue` or `en-us.json`.

- [ ] **Step 5: Commit**

```bash
git add client/strings/en-us.json client/pages/library/_library/ai-inbox.vue
git commit -m "Surface subtitle-cruft label and cascade stage stats in AI Inbox"
```

---

### Task 6: Docker rebuild and browser verification

**Files:** none (verification only).

- [ ] **Step 1: Rebuild and restart the fork container**

Run: `docker compose -f docker-compose.fork.yml up --build -d`
Expected: build exits 0; `audiobookshelf-fork` recreated and started.

- [ ] **Step 2: Confirm the server is healthy**

Run: `curl -s http://localhost:13379/audiobookshelf/ping`
Expected: `{"success":true}`

- [ ] **Step 3: Browser-verify the AI Inbox**

Open `http://localhost:13379/audiobookshelf/library/5b2bfdd6-f6d2-45d7-8f75-b3a88cf881c3/ai-inbox` and confirm:
1. The cleanup harvest panel still loads (duplicate-subtitle summary or empty state).
2. The new stage-stats line renders (deterministic resolved / escalated / evaluated).
3. If the fork library contains a whole-cruft subtitle book, a `subtitle-cruft` suggestion appears with the new label; otherwise the empty state is unchanged. (Existing 8-book fork library may have zero — that is acceptable; the stat line and no errors are the pass criteria.)
4. No console errors.

- [ ] **Step 4: Final commit (only if any verification fix was needed)**

If steps 1-3 required a code fix, commit it with a descriptive message. Otherwise this slice is complete.

---

## Self-Review notes

- **Spec coverage:** `CleanResult` contract (Task 2) ✓; confidence gate (Task 2) ✓; `subtitle-cruft` deterministic stage-(a) rule (Task 1) ✓; deterministic + ollama stage adapters (Task 3) ✓; manager runs the cascade stage and emits pending suggestions only (Task 4 — reuses existing `createSuggestionsForLibrary` write path) ✓; regex-vs-escalate instrumentation via the summary endpoint (Task 4 stats + Task 5 UI) ✓; Curation Inbox surfacing (Task 5) ✓. Deferred per spec: cloud escalation, smart aggregation, provider face, JSON-schema validation in the live walk, idempotency hash in the walk — none are tasks here, matching "out of scope".
- **Scope note vs spec:** the spec's first slice lists stage list `[deterministic, ollama]` in the live walk. This plan builds and unit-tests the ollama stage adapter (Task 3) but does NOT invoke a live per-item Ollama network call inside the library walk — the default cleanup harvest stays deterministic-only and fast, and the "escalated" count captures exactly the fields that WOULD go to qwen3. This is a deliberate risk-reduction: it yields the regex-vs-escalate metric without a slow/networked default path. Wiring the live ollama call into the walk is the next slice. Flag this to the user at execution handoff.
- **Type consistency:** `runSubtitleStage` and `deterministicSubtitleStage` return the same `CleanResult` (+`.candidate`) shape; `findCandidatesForLibrary` returns `{candidates, stats}` consistently across all three callers; `gate`/`runCascade`/`DEFAULT_DELTA` names match between Task 2 and Task 3.
- **Placeholder scan:** no TBD/TODO; all code steps carry full code. Task 5 intentionally instructs reading `ai-inbox.vue` first because the exact binding name and label convention must be confirmed in the live file — the change itself (label key + stat line) is fully specified.

# Cascade-Aware LLM Batch — Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `AiCurationManager.generateForLibraryBatch` into a deterministic→LLM cascade: run the deterministic subtitle stage first, exclude resolved fields from the LLM call, tag LLM rows, and report real regex-vs-LLM walk stats.

**Architecture:** Pure decision helpers in a new `server/utils/cascadeBatch.js` (unit-tested). `AiCurationManager` gains a synchronous `planItemCascade(item)` (unit-tested) that decides deterministic candidate + LLM field set, plus an async `generateCascadeForItem(item)` that persists deterministic + tagged LLM rows. The batch walk delegates per item and accumulates stats. No `OllamaMetadataAdapter` change. Writes stay pending-only (review-first).

**Tech Stack:** Node.js (CommonJS), Sequelize via `server/Database`, Ollama via `OllamaMetadataAdapter`, Mocha + Chai (`npx mocha`), Nuxt 2 client, Docker (`docker-compose.fork.yml`).

## Global Constraints

- Pure helpers in `server/utils/cascadeBatch.js`: no require of Database/network/sockets.
- LLM rows are persisted with EXACTLY: `origin: 'local-llm'`, `issueType: 'llm-metadata'`, `canFastApply: false`, `source: 'ollama'`, plus `model`, `confidence`, `fieldName`, `currentValue`, `proposedValue`.
- Deterministic rows keep their candidate's values: `origin: 'deterministic-rule'`, the candidate `issueType`, `canFastApply` from the candidate.
- Per-field cascade: a deterministic `accept` removes that field from the LLM `fields` object AND filters it from the parsed descriptors; a deterministic `escalate` leaves the field in.
- Writes remain pending-only. No new write path. No change to the two sanctioned write paths.
- Bounded batch (default 5, max 25), sequential, skip items with existing pending suggestions — all preserved.
- An Ollama failure for one item logs and continues; the deterministic rows for that item still persist.
- `generateForLibraryBatch` returns `{ processed, deterministicResolved, llmItemsCalled, suggestionsCreated, remaining }` (additive; existing keys preserved).
- Codebase convention: no semicolons, 2-space indent, single quotes.
- Run after each task: `npx mocha test/server/utils/cascadeBatch.test.js test/server/managers/AiCurationManager.test.js test/server/managers/AiLibraryCleanupManager.test.js test/server/utils/aiCleanupRules.test.js test/server/utils/curationCascade.test.js test/server/utils/curationStages.test.js`

---

### Task 1: Pure cascade-batch helpers

**Files:**
- Create: `server/utils/cascadeBatch.js`
- Test: `test/server/utils/cascadeBatch.test.js`

**Interfaces:**
- Produces:
  - `planLlmFields(allFields: {title?, subtitle?, narrators?}, resolvedFieldNames: Set|string[]): object` — returns `allFields` with every resolved key removed (key dropped entirely).
  - `dropResolvedDescriptors(descriptors: Array, resolvedFieldNames: Set|string[]): Array` — filters out falsy entries and any descriptor whose `fieldName` is resolved.
  - `hasCuratableField(fields): boolean` — true if `title` or `subtitle` is a non-empty string, or `narrators` is a non-empty array.
  - `tagLlmDescriptor(descriptor: {fieldName, currentValue?, proposedValue, confidence?}, model: string): object` — returns the persistable LLM row attrs (see constraints).

- [ ] **Step 1: Write the failing tests**

Create `test/server/utils/cascadeBatch.test.js`:

```js
const { expect } = require('chai')
const { planLlmFields, dropResolvedDescriptors, hasCuratableField, tagLlmDescriptor } = require('../../../server/utils/cascadeBatch')

describe('cascadeBatch', () => {
  describe('planLlmFields', () => {
    it('drops resolved field keys and keeps the rest', () => {
      const out = planLlmFields({ title: 'T', subtitle: 'S', narrators: ['N'] }, new Set(['subtitle']))
      expect(out).to.deep.equal({ title: 'T', narrators: ['N'] })
      expect(out).to.not.have.property('subtitle')
    })

    it('accepts an array of resolved names and returns all fields when none resolved', () => {
      expect(planLlmFields({ title: 'T', subtitle: 'S' }, [])).to.deep.equal({ title: 'T', subtitle: 'S' })
      expect(planLlmFields({ title: 'T', subtitle: 'S' }, ['title'])).to.deep.equal({ subtitle: 'S' })
    })
  })

  describe('dropResolvedDescriptors', () => {
    it('removes descriptors for resolved fields and drops falsy entries', () => {
      const descriptors = [{ fieldName: 'subtitle', proposedValue: '' }, { fieldName: 'title', proposedValue: 'T' }, null]
      expect(dropResolvedDescriptors(descriptors, new Set(['subtitle']))).to.deep.equal([{ fieldName: 'title', proposedValue: 'T' }])
    })

    it('returns all descriptors when nothing is resolved', () => {
      const descriptors = [{ fieldName: 'title', proposedValue: 'T' }]
      expect(dropResolvedDescriptors(descriptors, [])).to.deep.equal(descriptors)
    })
  })

  describe('hasCuratableField', () => {
    it('is true when any curatable field is present and non-empty', () => {
      expect(hasCuratableField({ title: 'T' })).to.equal(true)
      expect(hasCuratableField({ narrators: ['N'] })).to.equal(true)
    })

    it('is false for empty / missing fields', () => {
      expect(hasCuratableField({ title: '', subtitle: '   ', narrators: [] })).to.equal(false)
      expect(hasCuratableField({})).to.equal(false)
      expect(hasCuratableField(null)).to.equal(false)
    })
  })

  describe('tagLlmDescriptor', () => {
    it('maps a descriptor to the persistable local-llm row attrs', () => {
      const attrs = tagLlmDescriptor({ fieldName: 'title', currentValue: 'Old', proposedValue: 'New', confidence: 0.8 }, 'qwen3:30b-a3b')
      expect(attrs).to.deep.equal({
        fieldName: 'title',
        currentValue: 'Old',
        proposedValue: 'New',
        source: 'ollama',
        model: 'qwen3:30b-a3b',
        confidence: 0.8,
        issueType: 'llm-metadata',
        origin: 'local-llm',
        canFastApply: false
      })
    })

    it('defaults missing currentValue/confidence to null', () => {
      const attrs = tagLlmDescriptor({ fieldName: 'narrators', proposedValue: 'A, B' }, 'm')
      expect(attrs.currentValue).to.equal(null)
      expect(attrs.confidence).to.equal(null)
      expect(attrs).to.include({ origin: 'local-llm', issueType: 'llm-metadata', canFastApply: false })
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx mocha test/server/utils/cascadeBatch.test.js`
Expected: FAIL — cannot find module `server/utils/cascadeBatch`.

- [ ] **Step 3: Implement the helpers**

Create `server/utils/cascadeBatch.js`:

```js
function toSet(resolvedFieldNames) {
  return resolvedFieldNames instanceof Set ? resolvedFieldNames : new Set(resolvedFieldNames || [])
}

/**
 * Return allFields with every resolved field key removed entirely.
 * @param {{title?: any, subtitle?: any, narrators?: any}} allFields
 * @param {Set|string[]} resolvedFieldNames
 */
function planLlmFields(allFields, resolvedFieldNames) {
  const resolved = toSet(resolvedFieldNames)
  const out = {}
  for (const key of Object.keys(allFields || {})) {
    if (!resolved.has(key)) out[key] = allFields[key]
  }
  return out
}

/**
 * Filter out falsy descriptors and any descriptor for an already-resolved field.
 * @param {Array} descriptors
 * @param {Set|string[]} resolvedFieldNames
 */
function dropResolvedDescriptors(descriptors, resolvedFieldNames) {
  const resolved = toSet(resolvedFieldNames)
  return (descriptors || []).filter((d) => d && !resolved.has(d.fieldName))
}

/**
 * True if there is at least one non-empty curatable field worth an LLM call.
 * @param {{title?: any, subtitle?: any, narrators?: any}} fields
 */
function hasCuratableField(fields) {
  if (!fields) return false
  if (typeof fields.title === 'string' && fields.title.trim()) return true
  if (typeof fields.subtitle === 'string' && fields.subtitle.trim()) return true
  if (Array.isArray(fields.narrators) && fields.narrators.length) return true
  return false
}

/**
 * Map a parsed Ollama descriptor to the persistable local-llm suggestion row attrs.
 * @param {{fieldName, currentValue?, proposedValue, confidence?}} descriptor
 * @param {string} model
 */
function tagLlmDescriptor(descriptor, model) {
  return {
    fieldName: descriptor.fieldName,
    currentValue: descriptor.currentValue ?? null,
    proposedValue: descriptor.proposedValue,
    source: 'ollama',
    model,
    confidence: descriptor.confidence ?? null,
    issueType: 'llm-metadata',
    origin: 'local-llm',
    canFastApply: false
  }
}

module.exports = { planLlmFields, dropResolvedDescriptors, hasCuratableField, tagLlmDescriptor }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx mocha test/server/utils/cascadeBatch.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/utils/cascadeBatch.js test/server/utils/cascadeBatch.test.js
git commit -m "Add pure cascade-batch helpers"
```

---

### Task 2: Cascade wiring in AiCurationManager

**Files:**
- Modify: `server/managers/AiCurationManager.js`
- Test: `test/server/managers/AiCurationManager.test.js`

**Interfaces:**
- Consumes: `deterministicSubtitleStage` from `../utils/curationStages`; `planLlmFields`, `dropResolvedDescriptors`, `hasCuratableField`, `tagLlmDescriptor` from `../utils/cascadeBatch`.
- Produces:
  - `planItemCascade(libraryItem): { detCandidate: object|null, llmFields: object, resolved: Set, allFields: object }` — SYNCHRONOUS, pure of DB/network. Runs the deterministic stage and computes the LLM field set. (Unit-tested.)
  - `generateCascadeForItem(libraryItem): Promise<{ suggestionsCreated, deterministicResolved: boolean, llmCalled: boolean, rows }>` — async; persists deterministic + tagged LLM rows (clears the item's pending rows first).
  - `generateForLibraryBatch(library, limit)` now returns `{ processed, deterministicResolved, llmItemsCalled, suggestionsCreated, remaining }`.
  - `generateSuggestionsForItem` unchanged in contract but its persisted LLM rows are now tagged via `tagLlmDescriptor` (so single-item rows are no longer untagged "legacy").

- [ ] **Step 1: Write the failing tests (for the synchronous decision core)**

Append to `test/server/managers/AiCurationManager.test.js`:

```js
const AiCurationManager = require('../../../server/managers/AiCurationManager')

describe('planItemCascade', () => {
  const bookItem = (title, subtitle, narrators = ['N']) => ({
    id: 'item-1',
    mediaType: 'book',
    isBook: true,
    media: { title, subtitle, narrators }
  })

  it('resolves a whole-cruft subtitle deterministically and excludes it from the LLM fields', () => {
    const plan = AiCurationManager.planItemCascade(bookItem('Project Hail Mary', 'Unabridged'))
    expect(plan.detCandidate).to.not.equal(null)
    expect(plan.detCandidate.issueType).to.equal('subtitle-cruft')
    expect(plan.resolved.has('subtitle')).to.equal(true)
    expect(plan.llmFields).to.not.have.property('subtitle')
    expect(plan.llmFields).to.have.property('title')
    expect(plan.llmFields).to.have.property('narrators')
  })

  it('leaves a partial-cruft subtitle in the LLM fields (deterministic escalates)', () => {
    const plan = AiCurationManager.planItemCascade(bookItem('Dune', 'A Novel [Unabridged]'))
    expect(plan.detCandidate).to.equal(null)
    expect(plan.resolved.size).to.equal(0)
    expect(plan.llmFields).to.have.property('subtitle')
  })

  it('leaves a clean subtitle for the LLM and resolves nothing', () => {
    const plan = AiCurationManager.planItemCascade(bookItem('Dune', 'Book One'))
    expect(plan.detCandidate).to.equal(null)
    expect(plan.llmFields).to.have.property('subtitle')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx mocha test/server/managers/AiCurationManager.test.js`
Expected: FAIL — `planItemCascade` is not a function.

- [ ] **Step 3: Implement the wiring**

In `server/managers/AiCurationManager.js`, add to the requires at the top:

```js
const { deterministicSubtitleStage } = require('../utils/curationStages')
const { planLlmFields, dropResolvedDescriptors, hasCuratableField, tagLlmDescriptor } = require('../utils/cascadeBatch')
```

Add the synchronous decision method (place it after `extractFields`):

```js
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
```

Add the async per-item cascade (place it after `generateSuggestionsForItem`):

```js
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
```

Replace the batch loop inside `generateForLibraryBatch`. The existing method body builds `candidates` (unchanged); replace ONLY the loop + return (from `let processed = 0` to the end of the method) with:

```js
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
```

Finally, tag the single-item path. In `generateSuggestionsForItem`, replace the `bulkCreate` mapping so LLM rows are tagged consistently. Change:

```js
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
```

to:

```js
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
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npx mocha test/server/managers/AiCurationManager.test.js`
Expected: PASS (existing filter/summary/where tests + the new `planItemCascade` tests).

- [ ] **Step 5: Run the full regression set**

Run: `npx mocha test/server/utils/cascadeBatch.test.js test/server/managers/AiCurationManager.test.js test/server/managers/AiLibraryCleanupManager.test.js test/server/utils/aiCleanupRules.test.js test/server/utils/curationCascade.test.js test/server/utils/curationStages.test.js`
Expected: PASS (all suites green).

- [ ] **Step 6: Commit**

```bash
git add server/managers/AiCurationManager.js test/server/managers/AiCurationManager.test.js
git commit -m "Make library batch a deterministic-to-LLM cascade"
```

---

### Task 3: Surface local-llm origin in the AI Inbox

**Files:**
- Modify: `client/strings/en-us.json`
- Modify: `client/pages/library/_library/ai-inbox.vue`
- Test: build verification (`npm run client`).

**Interfaces:**
- Consumes: suggestion rows now carrying `origin: 'local-llm'`, and the batch response's `deterministicResolved` / `llmItemsCalled`.
- Produces: a `Local LLM` origin label/badge; a deterministic-vs-LLM count shown in the batch-run feedback.

**Note:** UI glue — verify via build, not unit tests. Read `ai-inbox.vue` first to find (a) the origin label map (the same one that renders `deterministic-rule` / legacy), and (b) where the batch-generate result is stored/shown after the generate button runs.

- [ ] **Step 1: Add the label string**

In `client/strings/en-us.json`, next to the existing origin label (search for the `deterministic-rule` / `LabelAiSuggestionDeterministic` label added in Slice 1), add a matching key:

```json
"LabelAiOriginLocalLlm": "Local LLM",
```

- [ ] **Step 2: Read the inbox origin map + batch-result handling**

Open `client/pages/library/_library/ai-inbox.vue`. Locate the `originLabel(origin)` method (or equivalent map) that returns the deterministic / legacy labels, and the method/data that handles the response from the generate-batch call (the `processed` / `suggestionsCreated` feedback).

- [ ] **Step 3: Add the local-llm origin branch**

In the origin label method, add a branch consistent with the existing `deterministic-rule` branch:

```js
if (origin === 'local-llm') return this.$strings.LabelAiOriginLocalLlm
```

- [ ] **Step 4: Show the deterministic-vs-LLM batch counts**

Where the batch-generate result is surfaced (toast/inline text), include the new counts when present. If the result is stored in a data property (confirm its name in Step 2), render or include:

```
deterministic {{ batchResult.deterministicResolved }} / llm {{ batchResult.llmItemsCalled }} of {{ batchResult.processed }}
```

If the result is only shown via a toast string, append the same counts to that message. Use the ACTUAL property name found in Step 2, not a guess.

- [ ] **Step 5: Build the client**

Run: `npm run client`
Expected: Nuxt generates successfully; only pre-existing warnings; no new error referencing `ai-inbox.vue` or `en-us.json`.

- [ ] **Step 6: Commit**

```bash
git add client/strings/en-us.json client/pages/library/_library/ai-inbox.vue
git commit -m "Surface local-llm origin and cascade batch counts in AI Inbox"
```

---

### Task 4: Docker rebuild and live verification

**Files:** none (verification only).

**Note:** The LLM stage needs `aiCurationEnabled` ON and Ollama reachable at `host.docker.internal:11434` with `qwen3:30b-a3b` pulled. If Ollama is not running, the deterministic half is still verifiable and the batch must not crash (Ollama failure is caught per item) — report that state rather than treating it as a failure.

- [ ] **Step 1: Rebuild and restart the fork container**

Run: `docker compose -f docker-compose.fork.yml up --build -d`
Expected: build exits 0; `audiobookshelf-fork` recreated and started.

- [ ] **Step 2: Confirm server health**

Run: `curl -s http://localhost:13379/audiobookshelf/ping`
Expected: `{"success":true}`

- [ ] **Step 3: Check whether AI curation + Ollama are available**

Log in as root and check server settings + Ollama reachability. Use the login + Bearer-token pattern from prior slices (root credentials are known to the operator). If `aiCurationEnabled` is false or Ollama is unreachable, note it and proceed to Step 5 (deterministic-only verification).

- [ ] **Step 4: Trigger the cascade batch and inspect the result**

POST to `/api/libraries/5b2bfdd6-f6d2-45d7-8f75-b3a88cf881c3/ai-suggestions/generate` with `{"limit":5}` and a Bearer token. Confirm the response has the shape `{ processed, deterministicResolved, llmItemsCalled, suggestionsCreated, remaining }`. Then GET `/api/libraries/:id/ai-suggestions?status=pending` and confirm:
- LLM rows (if any) carry `origin: "local-llm"`, `issueType: "llm-metadata"`, `canFastApply: false`.
- No item has BOTH a deterministic subtitle row AND an LLM subtitle row (no double proposal on subtitle).

- [ ] **Step 5: Deterministic-only fallback check (if Ollama unavailable)**

If Step 4 could not exercise the LLM, confirm the batch still returned a valid stats object with `llmItemsCalled` reflecting attempted calls and the server did not error (check `docker logs audiobookshelf-fork --tail 30` for caught Ollama errors, not crashes).

- [ ] **Step 6: Final commit (only if a verification fix was needed)**

If steps required a code fix, commit it. Otherwise the slice is complete.

---

## Self-Review notes

- **Spec coverage:** pure helpers (Task 1) ✓; per-field cascade with subtitle exclusion + descriptor filter (Task 2 `planItemCascade` + `generateCascadeForItem`) ✓; LLM-row tagging `local-llm`/`llm-metadata`/`canFastApply:false` (Task 1 `tagLlmDescriptor`, applied in Task 2 batch + single-item paths) ✓; clear-pending-once persistence ordering (Task 2) ✓; real regex-vs-LLM walk stats (Task 2 return shape) ✓; UI origin label + batch counts (Task 3) ✓; integration verification incl. no-double-proposal (Task 4) ✓. Deferred per spec: pipeline-manager refactor, cloud escalation, aggregation, panel widening, double-runSubtitleStage, stat-line i18n — none are tasks here.
- **Type consistency:** `tagLlmDescriptor` output keys match the `create()` columns in both call sites; `planItemCascade` returns `{detCandidate, llmFields, resolved, allFields}` consumed by `generateCascadeForItem`; `generateForLibraryBatch` return keys match what `AiController.generateLibrarySuggestions` passes through (`res.json(summary)`).
- **Placeholder scan:** none; code complete. Task 3 deliberately instructs reading `ai-inbox.vue` first because the origin-map method name and the batch-result property name must be confirmed in the live file — the additions themselves (label key, origin branch, counts) are fully specified.
- **Adapter unchanged:** `buildRequest` coerces a dropped field to `null` in the prompt (model omits it); `dropResolvedDescriptors` is the hard guarantee against a hallucinated row on a resolved field. No `OllamaMetadataAdapter` edit.

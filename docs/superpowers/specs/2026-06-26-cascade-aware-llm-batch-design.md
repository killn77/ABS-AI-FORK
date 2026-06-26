# Cascade-Aware LLM Batch — Design (Slice 2)

## Status

Validated design (brainstorming complete; user approved async before going AFK, including the two
specifics: LLM rows get `issueType: 'llm-metadata'` and `canFastApply: false`). Builds directly on
Slice 1 (`docs/superpowers/specs/2026-06-26-staged-curation-pipeline-design.md`,
commits 8334e652..510bee14). User spec-review gate deferred (async) — owner reviews on return.

## Problem

After Slice 1 the fork has two managers that walk the library **independently** and both write to
`aiMetadataSuggestionModel`:

- `AiCurationManager.generateForLibraryBatch` — the LLM path. Bounded batch (default 5, max 25,
  sequential), calls Ollama per item over `{title, subtitle, narrators}`, persists pending rows.
  LLM rows currently carry **no `issueType`/`origin`** (they display as "legacy"), and **no
  `canFastApply`**.
- `AiLibraryCleanupManager` — the deterministic path (the Slice-1 cascade stage + subtitle rules).

They are parallel, not a cascade: both can propose on the **same field** (`subtitle`), producing
duplicate/conflicting suggestions, and the LLM is spent on fields the cheap deterministic tier
already resolved. This slice makes the LLM batch a true deterministic→LLM cascade.

## Decision

Per the approved design, the cascade lives in **`AiCurationManager.generateForLibraryBatch`**
(not a new pipeline manager, and not the deterministic cleanup manager). The standalone
`CurationPipelineManager` refactor remains the longer-term target but is out of scope here.

## Architecture

### Per-item cascade (inside the existing bounded batch walk)

For each book item in the batch:

1. Run `deterministicSubtitleStage(ctx)` (the pure Slice-1 stage from `server/utils/curationStages.js`).
2. **If verdict is `accept`** → the deterministic candidate (carried on `result.candidate`) is
   persisted as a pending suggestion with `origin: 'deterministic-rule'`, its `issueType`,
   `canFastApply` per the candidate, and `sourceHash`. The field it resolves (`subtitle`) is added
   to a per-item `resolvedFieldNames` set. If verdict is `escalate`, nothing is resolved — `subtitle`
   stays open for the LLM (e.g. partial-cruft `"A Novel [Unabridged]"`).
3. Build `llmFields` = `extractFields(item)` with every name in `resolvedFieldNames` removed.
4. If `llmFields` still contains a curatable field, call
   `adapter.getSuggestions({ baseUrl, model, fields: llmFields })`, then **drop any descriptor whose
   `fieldName` is in `resolvedFieldNames`** (belt-and-suspenders against a hallucinated proposal on
   an already-settled field). Persist the surviving descriptors as pending rows tagged
   `origin: 'local-llm'`, `issueType: 'llm-metadata'`, `canFastApply: false`, `source: 'ollama'`,
   `model`, `confidence` from the descriptor, `sourceHash` of the full source fields.
5. Accumulate per-walk stats.

### Persistence ordering

Clear an item's previous **pending** rows **once** at the start of its cascade, then create the
deterministic row(s) and the LLM rows. (The current `generateSuggestionsForItem` clears-then-creates
for the LLM only; the cascade restructures so the deterministic row isn't wiped by the LLM step.)

### Pure, unit-testable helpers (extracted)

The network+DB walk stays integration-tested, but the decision logic is extracted into pure
functions on the manager (or a small `server/utils/cascadeBatch.js`):

- `planLlmFields(allFields: {title, subtitle, narrators}, resolvedFieldNames: Set|string[]) → fields subset`
  — returns `allFields` minus resolved names (keys dropped entirely so they never reach the prompt).
- `dropResolvedDescriptors(descriptors: Array, resolvedFieldNames) → Array` — filters out descriptors
  for resolved fields.
- `tagLlmDescriptor(descriptor, model) → rowAttrs` — maps a parsed descriptor to the persisted row
  attributes: `{ origin: 'local-llm', issueType: 'llm-metadata', canFastApply: false, source: 'ollama',
  model, confidence, proposedValue, currentValue, fieldName }`.

### Stats / metric refinement

`generateForLibraryBatch` returns
`{ processed, deterministicResolved, llmItemsCalled, suggestionsCreated, remaining }`.
`deterministicResolved` (items where the deterministic stage accepted) vs `llmItemsCalled` (items
where an Ollama call was actually made) is the **real** regex-vs-LLM workload on the walk — this
addresses the Slice-1 final-review Minor 4 (the deterministic-only summary counted clean/empty
subtitles as "escalated", overstating LLM workload). The over-counting summary stat on
`AiLibraryCleanupManager` is left as-is for now; the real signal lives on the batch result.

### UI

- Add a `local-llm` origin label + badge so LLM rows stop rendering as "legacy":
  `client/strings/en-us.json` (`LabelAiOriginLocalLlm: "Local LLM"`) and the inbox's origin label
  map in `client/pages/library/_library/ai-inbox.vue`.
- Surface the batch result's `deterministicResolved` / `llmItemsCalled` counts wherever the batch
  is triggered/reported in the inbox (the existing batch-run feedback path).

## Components & boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `cascadeBatch.js` (new, pure) | `planLlmFields`, `dropResolvedDescriptors`, `tagLlmDescriptor` | nothing (pure) |
| `AiCurationManager` (modified) | per-item cascade walk, persistence, stats | `deterministicSubtitleStage`, `OllamaMetadataAdapter`, `cascadeBatch`, Database |
| `OllamaMetadataAdapter` | unchanged (already accepts a `fields` object and ignores absent keys) | — |
| AI Inbox UI | `local-llm` label/badge + batch counts | en-us.json, summary/batch response |

## Error handling

- `deterministicSubtitleStage` is pure and never throws.
- An Ollama failure for one item is logged and the walk continues (existing batch behavior).
- `aiCurationEnabled` guard unchanged; bounded batch + skip-items-with-pending behavior preserved.
- Schema validation: the adapter's existing `parseSuggestions` validation + the descriptor filter
  are the gate; no unvalidated value reaches a write path (writes remain pending-only / review-first).

## Testing

- **Unit (pure):** `planLlmFields` (drops resolved keys, keeps the rest, handles empty/all-resolved),
  `dropResolvedDescriptors` (filters resolved fields, passes others), `tagLlmDescriptor` (exact row
  attrs incl. `origin: 'local-llm'`, `issueType: 'llm-metadata'`, `canFastApply: false`).
- **Regression:** existing AI suites stay green (`AiCurationManager`, `AiLibraryCleanupManager`,
  `aiCleanupRules`, `curationCascade`, `curationStages`).
- **Integration:** Docker rebuild; trigger `generateForLibraryBatch` via its endpoint with
  `aiCurationEnabled` on; confirm (a) deterministic `subtitle-cruft`/`duplicate-subtitle` rows where
  applicable, (b) `local-llm` rows for title/narrators with `canFastApply:false`, (c) no double
  proposal on a deterministically-resolved subtitle, (d) the batch stats shape.

## Out of scope (deferred)

Standalone `CurationPipelineManager` refactor; field-level LLM prompting beyond key-exclusion; cloud
escalation; smart aggregation; widening the deterministic cleanup-harvest panel (Slice-1 Minor 3);
collapsing the double `runSubtitleStage` per item (Slice-1 Minor 1); i18n of the Slice-1 stat-line
prose (Slice-1 Minor 2). These are tracked in the progress ledger and project memory.

## Decisions log

- Cascade hosted in `AiCurationManager.generateForLibraryBatch` (approved). Rejected: new pipeline
  manager (bigger refactor this slice) and extending the deterministic manager (would put slow
  network calls on a fast synchronous path).
- LLM rows: `origin: 'local-llm'`, `issueType: 'llm-metadata'`, `canFastApply: false` (approved).
- Per-field cascade: deterministic `accept` removes the field from the LLM call; deterministic
  `escalate` leaves it in.

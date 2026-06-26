# AI Library Cleanup Roadmap Design

## Purpose

Build the AI fork into a library cleanup system that can safely handle both high-volume deterministic metadata fixes and review-first AI suggestions. The first implementation target is Phase 1, "Cleanup Harvest", because the existing audit found the largest measured win there: duplicate `subtitle == title` values across the library.

The design keeps two operating modes:

- Fast Apply Mode for deterministic fixes that are mechanically safe and reversible.
- Review Queue Mode for AI, ambiguous, or user-taste-dependent suggestions.

## Existing Baseline

The fork already has:

- `AiCurationManager`, `OllamaMetadataAdapter`, and AI suggestion routes for title, subtitle, and narrator cleanup.
- `aiMetadataSuggestions` and `aiMetadataReviewDecisions` tables with `currentValue`, `proposedValue`, `sourceHash`, status, rationale, confidence, and review decisions.
- Item-level AI Suggestions UI and a basic library AI Inbox.
- Settings for local Ollama-backed AI curation.
- An eval harness and audit scripts under `evals/`.
- Measured model choice: `qwen3:30b-a3b` as the current quality default.

The next work should extend this baseline instead of introducing a separate cleanup subsystem.

## Product Phases

### Phase 1: Cleanup Harvest

Add deterministic cleanup harvesting for the known dominant issue: duplicate subtitles.

Capabilities:

- Scan one library for deterministic cleanup candidates.
- Identify `subtitle == title` using normalized comparison.
- Show dry-run counts and representative examples before applying anything.
- Let the user choose:
  - create reviewable suggestions for each candidate, or
  - apply all deterministic candidates after one confirmation.
- Apply bulk changes through the same metadata update path used by existing review flows.
- Record audit data so changes can be reviewed and reverted.

Phase 1 deliberately excludes AI title-cruft expansion, series auditing, duplicates, covers, and filesystem rename actions. Those depend on the same inbox and audit foundation.

### Phase 2: Curation Inbox 2.0

Upgrade the current AI Inbox from a flat list into a cleanup command center.

Capabilities:

- Group by issue type: duplicate subtitle, AI title cleanup, mojibake, series issue, duplicate edition, cover issue.
- Show counts per group.
- Filter by deterministic versus AI-generated candidates.
- Support bulk actions only for deterministic candidates by default.
- Keep AI-generated suggestions review-first unless the user explicitly selects a subset.

### Phase 3: Rule Engine

Extract strict cleanup rules into a reusable server module.

Initial rule set:

- Duplicate subtitle: clear subtitle when normalized subtitle equals normalized title.
- Title cruft: flag known low-risk artifacts such as unabridged markers, bitrate tags, and file format suffixes.
- Subtitle cruft: flag the same artifacts when they appear in subtitle.
- Mojibake detector: flag likely encoding corruption without auto-fixing it.

Each rule returns a candidate with:

- `issueType`
- `fieldName`
- `currentValue`
- `proposedValue`
- `confidence`
- `rationale`
- `isDeterministic`
- `canFastApply`

### Phase 4: Expanded Auditors

Add higher-level library auditors after the inbox and rule engine are stable.

Auditors:

- Series Integrity Auditor: missing sequence numbers, inconsistent series names, title-derived sequence hints.
- Duplicate / Edition Detector: likely duplicate books, different editions, part splits, abridged versus unabridged variants.
- Cover Review Queue: missing covers, low-resolution covers, likely placeholder covers, probable title/cover mismatch.
- Folder/File Safety Assistant: propose rename or move plans, but never execute automatically in the initial version.

### Phase 5: Learning And Evals

Turn user decisions into quality feedback.

Capabilities:

- Convert accepted deterministic and AI suggestions into positive eval cases where appropriate.
- Convert rejected AI suggestions into regression guard cases.
- Track false-positive risk separately from missed-fix risk.
- Keep model and prompt changes gated by the existing eval harness.

## Phase 1 Architecture

### Server Components

Add a deterministic cleanup service beside the existing AI curation manager:

- `server/managers/AiLibraryCleanupManager.js`
  - owns library scan, dry-run summaries, suggestion creation, and fast apply orchestration.
- `server/utils/aiCleanupRules.js`
  - pure deterministic rules with unit tests.
- Existing `AiCurationManager`
  - remains responsible for model-backed suggestions.
- Existing `AiController`
  - gains library cleanup endpoints, or delegates to a small cleanup controller if the file becomes too broad.

The manager should not call the LLM for Phase 1 duplicate-subtitle detection. It should use direct metadata inspection and strict normalization.

### API Surface

Add endpoints under the existing library AI route family:

- `GET /api/libraries/:id/ai-cleanup/summary`
  - returns deterministic candidate counts and examples.
- `POST /api/libraries/:id/ai-cleanup/suggestions`
  - creates reviewable suggestion rows for deterministic candidates.
- `POST /api/libraries/:id/ai-cleanup/apply`
  - applies deterministic candidates after explicit confirmation.
- `POST /api/ai-suggestions/:suggestionId/revert`
  - reverts an accepted suggestion when `currentValue` is still usable.

Request bodies should include `issueTypes`, `limit`, and `dryRun` where relevant. Bulk apply must require an explicit confirmation token or boolean such as `confirmApply: true`.

### Data Model

Reuse `aiMetadataSuggestions` and `aiMetadataReviewDecisions` where possible.

Needed additions:

- Add or encode `issueType`, such as `duplicate-subtitle`.
- Add or encode `origin`, such as `deterministic-rule` or `llm`.
- Add or encode `canFastApply`.
- Preserve `currentValue`, `proposedValue`, and `sourceHash` for stale detection and revert safety.

If adding columns is cleaner than overloading `source` or `rationale`, add them in both:

- `Database.buildModels()`
- a new versioned migration

Fresh installs and upgrades must both get the same schema.

### UI Flow

In the library AI Inbox:

1. User opens the inbox.
2. The page loads cleanup summary counts.
3. Duplicate subtitle group shows count, examples, and two actions:
   - Review first
   - Apply all
4. Review first creates pending suggestions and displays them in the inbox.
5. Apply all opens a confirmation modal showing affected count and sample changes.
6. After apply, the UI shows applied count, skipped stale count, and errors.
7. Each applied item can be inspected and reverted from its suggestion decision history.

The UI should make deterministic and AI-generated suggestions visually distinct without making a separate app surface.

## Data Flow

### Review Queue Mode

1. Scan library items.
2. Run deterministic rule.
3. Persist pending `aiMetadataSuggestions`.
4. User accepts, rejects, or edits.
5. Existing metadata patch path writes accepted changes.
6. Decision row records the outcome.

### Fast Apply Mode

1. Scan library items.
2. Run deterministic rule.
3. Show dry-run summary.
4. User confirms bulk apply.
5. Re-check each item against `sourceHash` or current field values.
6. Apply change through the same metadata update logic used by review accept.
7. Persist suggestion row and accepted decision row for each applied change.
8. Report applied, skipped, and failed counts.

## Safety Rules

- AI suggestions never fast-apply by default.
- Deterministic suggestions can fast-apply only when `canFastApply` is true.
- Bulk apply must re-check the current value immediately before writing.
- If a value changed since scan, skip it as stale.
- All writes must preserve enough `currentValue` data to support revert.
- Filesystem rename and move actions are recommendation-only until a later design.

## Error Handling

- Disabled AI curation should not block deterministic cleanup summaries.
- Library permission checks must match the existing AI suggestion routes.
- Bulk operations return partial success with counts and per-item failures.
- Stale candidates are skipped, not force-applied.
- Duplicate suggestion creation should be idempotent for the same item, field, issue type, and source hash.
- Revert should fail safely if the current value no longer matches the suggestion's proposed value.

## Testing

Phase 1 tests:

- Unit tests for normalization and duplicate-subtitle rule.
- Unit tests for rule idempotency and stale detection.
- Manager tests for dry-run, suggestion creation, fast apply, partial failures, and revert.
- Controller tests for permissions and request validation.
- Existing full server test suite must remain green.
- Add eval/audit regression fixtures only if behavior affects model-backed suggestions.

Later phases add component or end-to-end coverage for the upgraded inbox once the UI design stabilizes.

## Implementation Order

1. Add pure deterministic cleanup rules and tests.
2. Add cleanup manager dry-run summary.
3. Add suggestion creation for deterministic candidates.
4. Add fast apply with stale checks and decision recording.
5. Add revert support.
6. Upgrade the AI Inbox UI for duplicate-subtitle group actions.
7. Run the full server suite and targeted client build checks.

## Out Of Scope For Phase 1

- Multi-provider routing.
- New vector storage.
- MCP tools.
- Windows packaging.
- Automated title rewrites from AI.
- Series, duplicate edition, cover, or filesystem action execution.

These are retained in the roadmap but should not enter the first implementation plan.

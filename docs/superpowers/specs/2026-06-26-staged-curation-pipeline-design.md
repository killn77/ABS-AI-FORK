# Staged Curation Pipeline — Design

## Status

Validated design (brainstorming complete). Architecture decision: **Hybrid (C)**. First
implementation slice scoped below. Informed by a multi-agent research sweep
(`docs/superpowers/research/` summary embedded here) of jeeftor/audiobook-organizer,
austinsr1/ab_mover, Vito0912's ABS Toolbox + abs-agg/AudiMeta, the wider ABS provider
ecosystem, LLM provider/structured-output options, and staged-cleaning architecture literature.

## Problem

The fork currently cleans library metadata with a small set of deterministic rules
(`duplicate-subtitle`) plus an Ollama LLM path, surfaced through the Curation Inbox. Adding
each new behavior ad hoc does not scale, gives no principled way to decide *when* the LLM is
worth invoking, and produces no measurement of how much work the cheap deterministic tier
actually resolves. We want a flexible, staged pipeline that walks the library field-by-field,
resolves what it can deterministically, escalates only genuinely ambiguous cases to a local
LLM (and, later, optionally to a cloud LLM), and routes residual uncertainty to human review.

## Key research findings

- **The ecosystem gap is reconciliation + judgment.** Every ABS companion tool surveyed
  (audnexus, AudiMeta, abs-agg, abs-tract, ABS Toolbox, tagger-web) is deterministic and
  single-source or whole-record. None reconciles across sources or makes per-field judgment
  calls. That is this fork's headline differentiator.
- **Review-first / dry-run is the dominant safe pattern.** ab_mover emits a reviewable plan and
  never mutates; ABS Toolbox makes `dryRun` a first-class field (default `true`). The fork's
  Curation Inbox already embodies this; the pipeline must preserve it.
- **Constrained decoding guarantees shape, not correctness.** Ollama `format` / OpenAI strict /
  Gemini `responseSchema` / Claude tool `input_schema` all force schema-valid output, but a
  model can emit a confidently-wrong value that still validates. Semantic checks stay separate
  from schema validation; humans stay on the loop for low-confidence.
- **The fork already has the right primitives.** `utils/aiCleanupRules` + `AiLibraryCleanupManager`
  (deterministic stage), `OllamaMetadataAdapter.getSuggestions`/`parseSuggestions` (local-LLM
  stage, schema-validated), the Curation Inbox + `aiMetadataSuggestionModel` (review queue), and
  two sanctioned write paths (PATCH `/api/items/:id/media` for review; `media.updateFromRequest`
  for fast-apply). The pipeline orchestrates these — it does not replace them.

## Target architecture (Hybrid C)

Build a **standalone staged pipeline manager** as the curation engine. It owns all writes and
goes only through the two existing sanctioned paths. Later — once stage (f) reconciliation
exists — expose *only* the reconciliation layer as a thin, **read-only** native ABS provider
face for drop-in interop. The pipeline owns writes; the provider face is read-only.

### The uniform stage contract

Every stage implements the same function shape so stages are reorderable and independently
testable. The pipeline walks each book field-by-field and stops at the first non-`escalate`
verdict.

```
CleanResult = {
  field: string,                                  // e.g. "subtitle"
  verdict: "accept" | "reject" | "escalate",
  action: "keep" | "rewrite" | "split" | "merge" | "flag",
  proposedValue: string,                          // "" means clear
  confidence: number,                             // 0..1
  evidence: string[],                             // why
  stage: string,                                  // e.g. "deterministic" | "ollama"
  model: string | null                            // null for deterministic
}
```

A per-field uncertainty band (`0.5 ± δ`) is the single escalation knob: above the band →
`accept`, below → `reject`, inside → `escalate` to the next stage. `δ` is tuned per field
(titles tolerant, author/series strict).

### The stages

| Stage | Consumes | Emits | Implementation |
|---|---|---|---|
| (a) deterministic regex/normalization | raw field + filename/folder + `metadata.json` | high-confidence `accept` for known junk | extend `utils/aiCleanupRules` + `AiLibraryCleanupManager` (new `issueType` rules, not a new engine) |
| (b) confidence gate | stage-(a) confidence | routes accept/reject/escalate via `0.5 ± δ` | pure orchestration loop |
| (c) local-LLM judgment | fields the regex tier left ambiguous, regex hits as hints | per-field descriptor | existing `OllamaMetadataAdapter`; expand `ALLOWED_FIELDS` over time |
| (d) optional cloud escalation | only fields qwen3 leaves in-band | same `CleanResult` shape | **deferred** — thin OpenAI-compatible adapter, `baseUrl`-swappable; batch the ambiguous subset to a 50%-off Batch API |
| (e) JSON-schema validation | any LLM output | validated object or one repair retry → else escalate/queue | Ajv/Zod against one canonical flat schema |
| (f) smart aggregation | multiple provider values + LLM signal | one fused record + confidence | **deferred** — entity resolution: normalize→block→per-field score→weighted vote; ASIN/ISBN agreement short-circuits the LLM; reuse `BookFinder.calculateMatchConfidence` |
| (g) human review queue | residual uncertainty | persisted pending suggestions; auto-apply only above a high threshold | existing Curation Inbox + `aiMetadataSuggestionModel` |

### Cross-cutting principles

- **One canonical flat JSON Schema**, designed to the strictest consumer (OpenAI strict:
  `additionalProperties:false`, all fields `required`, optionals as `["string","null"]`).
  Keep it flat — nested schemas are fragile on local models. Decisions modeled as a closed
  enum (the `action` field), never free text.
- **Local-first, cloud-escalation-only.** Routine extraction stays on `qwen3:30b-a3b` for
  privacy, zero marginal cost, and real constrained decoding. Cloud is reserved for genuine
  disambiguation and full-library backfills.
- **Idempotency.** Key each decision by `sha1(bookId, field, sourceValue, modelId+version,
  rulesetVersion)`; persist sidecar; skip unchanged fields on re-run; append-only JSONL audit
  log → resumable, diffable, explainable. (`hashFields()` already does the staleness half.)
- **Dry-run by default.** The pipeline emits pending suggestions; it never auto-mutates except
  through the explicit fast-apply path above a high confidence threshold.

## First implementation slice

**One field, full cascade, dry-run only — prove the seam, not the scale.**

Implement the `CleanResult` contract and the confidence-gate loop over a single ordered stage
list `[deterministic, ollama]` (stages a, b, c, e, g; cloud and aggregation deferred). The
first stage-(a) rule is **`subtitle-cruft`** — a subtitle that is entirely format/quality cruft
(e.g. `"Unabridged"`, `"MP3 128kbps"`, `"[Dramatized]"`) and not a title duplicate, proposed
to be cleared to `""`. (Whole-cruft only, fast-applicable; partial-cruft like `"A Novel
[Unabridged]"` is skipped — that is the LLM tier's job later.)

### In scope

- A `CleanResult` type + a small cascade runner (the confidence-gate loop) that takes an ordered
  stage list and stops at the first non-`escalate` verdict.
- `getSubtitleCruftCandidate` in `server/utils/aiCleanupRules.js`, exported alongside a testable
  `stripCruftTokens` helper and the cruft regex (the audit's `TITLE_CRUFT`: brackets,
  `(un)abridged`, bitrate, `mp3/m4b/flac`, `audiobook`, `dramatized`, `track N`, `N of M`).
- Wiring in `AiLibraryCleanupManager` so the deterministic stage runs `duplicate-subtitle` then
  `subtitle-cruft` (dup wins; one issue per field) and emits `CleanResult`s.
- The Ollama stage adapted to emit `CleanResult` for fields the deterministic stage escalated,
  validated against the canonical flat schema with one repair retry.
- Emit results **only** as pending rows in `aiMetadataSuggestionModel` (no writes), carrying
  `confidence`, `evidence`, `stage`, `model`, and the idempotency hash. Surfaced in the existing
  Curation Inbox via the existing `issueType` badge path; likely just an `en-us.json` label.
- **Instrumentation**: count, per run, what fraction of fields the deterministic tier resolved
  vs. escalated to qwen3 — the metric the routing literature says to measure first.

### Out of scope (deferred to later slices)

Cloud escalation (stage d), smart aggregation (stage f), the read-only provider face, the
declarative tool/field registry, and any new write path. No changes to the two sanctioned write
paths.

### Verification

- TDD on `aiCleanupRules`: whole-cruft fires (`"Unabridged"`, `"MP3 128kbps"`, `"[Dramatized]"`);
  partial-cruft skips (`"A Novel [Unabridged]"`); dup-subtitle defers; clean/empty subtitle skip.
- Unit test the cascade runner: accept short-circuits, escalate falls through, band routing.
- Existing mocha suites stay green; `npm run client` builds; Docker rebuild + Curation Inbox
  shows the new `subtitle-cruft` suggestions and the regex-vs-escalate counts.

## Borrowable patterns adopted

- **Dry-run / propose-as-data** (ab_mover, ABS Toolbox) — already the Inbox posture; the
  pipeline keeps it as the default.
- **Per-segment path sanitization + `.`/`..`/absolute rejection** (audiobook-organizer) — a guard
  to apply once the LLM is allowed to touch path-like fields.
- **Regex→tag rule DSL + declarative tool/field registry** (ABS Toolbox) — a later slice may
  expose deterministic rules as self-describing, parameterized curation actions.
- **abs-agg's multi-source provider shape** (Vito0912) — reference for stage (f) sources.
  **Licensing caution:** abs-agg is AGPL-3.0; the ABS Toolbox repo declares no license. Borrow
  the patterns, not the code.

## Decisions log

- **Architecture: Hybrid (C).** Standalone pipeline owns writes; read-only reconciliation
  provider face deferred. Rejected (A) pure native provider — `quickMatch` replaces whole records
  and skips ASIN/ISBN items, fighting per-field review-first curation.
- **First slice introduces the `CleanResult` cascade now** (not a plain standalone rule), with
  `subtitle-cruft` as the first stage-(a) rule, dry-run, instrumented.
- **`subtitle-cruft` scope: whole-cruft only, fast-applicable.** Partial-cruft deferred to the
  LLM tier.
- **Local-first; cloud escalation deferred.**

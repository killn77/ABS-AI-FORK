# Curation Pipeline Research Digest

Multi-agent research sweep (7 recon agents + synthesis, plus a re-run of the ABS Toolbox agent)
informing `../specs/2026-06-26-staged-curation-pipeline-design.md`.

## What each project gives us

| Project | One-line | Best borrowable idea |
|---|---|---|
| jeeftor/audiobook-organizer (Go) | Rule/template-driven ABS library reorganizer, no LLM | Per-segment path sanitization + `.`/`..`/absolute rejection — guardrail against an LLM emitting junk into a path |
| austinsr1/ab_mover (Python, 132 lines) | Emits reviewable `mv`/`mkdir` commands, never mutates | "Propose a plan as data, require approval before execution" + `Series #N` parse-and-clean regex |
| ABS companion ecosystem (audnexus, AudiMeta, abs-tract, tagger-web, LLM-rename) | 8 providers behind ABS's native `GET /search` | Nobody reconciles across sources — the fork's headline feature; reuse the `BookMetadata` shape verbatim |
| Provider/LLM survey | Local Ollama vs cloud strict-schema + batch economics | One canonical JSON Schema reused across every provider |
| Staged-cleaning survey (GuardChain, RouteLLM, entity-resolution) | Cascade where each stage returns accept/reject/escalate | Uniform `Classify → {verdict, confidence}` + uncertainty band (`0.5 ± δ`) as the single escalation knob |
| Fork (local code) | Already has an AI suggestion layer mirroring the provider idiom | Two safe write paths already exist — don't invent a third |
| Vito0912 ABS Toolbox + abs-agg/AudiMeta | Browser-only deterministic ABS toolbelt; no AI anywhere | Dry-run as a first-class field; regex→tag rule DSL; declarative tool/field registry; abs-agg's 11-source provider shape |

## Provider / LLM strategy

Local-first, cloud-escalation-only. `qwen3:30b-a3b` for routine extraction (privacy, zero cost,
real GBNF constrained decoding). One canonical flat JSON Schema, designed to the strictest
consumer (OpenAI strict). Decisions as a closed enum. Escalate to cloud only for genuine
disambiguation and full-library backfills (50%-off Batch API). Constrained decoding guarantees
shape, not correctness — keep semantic checks separate; humans on low-confidence. `qwen3:30b-a3b`
has documented guided-decoding quirks (reasoning leakage, malformed JSON when thinking off) — keep
a one-shot repair retry and validate every parse.

## Pipeline (see spec for the full stage table)

Walk field-by-field; uniform `CleanResult` contract; stop at first non-`escalate`; per-field `δ`.
Stages: (a) deterministic regex → (b) confidence gate → (c) local LLM → (d) cloud [deferred] →
(e) schema validation → (f) smart aggregation [deferred] → (g) human review queue. Idempotency via
`sha1(bookId, field, sourceValue, modelId+version, rulesetVersion)` + append-only JSONL audit log.

## Architecture decision

Hybrid (C): standalone staged pipeline owns writes via the two existing sanctioned paths; expose
only the reconciliation layer as a read-only native ABS provider face later. Rejected pure native
provider (A) — `quickMatch` replaces whole records and skips ASIN/ISBN items, fighting per-field
review-first curation.

## ABS Toolbox (Vito0912) — detail

Browser-only Vue 3 + TS PWA, no backend, talks to ABS via `@vito0912/abs-ts-sdk`; token in
`localStorage`; needs a CORS whitelist entry on the ABS server. Entirely deterministic — code
search found zero LLM/AI references. Tools: split-genres, match-audiobook-chapters (Audible
provider + ASIN, tracks-as-fallback), delete-orphaned-authors, force-metadata, migrate-server
(temporary auto-expiring API keys), rename-series, path-tag-genre-updater (`"<regex>:<tag>"` rule
DSL, `dryRun` default true), listen-date/session tools. Each tool is a declarative
`ToolDefinition { id, title, fields: ToolField[], execute() → ToolResult }` rendered by a dynamic
form. Sibling `abs-agg` aggregates 11 metadata sources behind `GET /:provider/search` (AGPL-3.0).

**Licensing caution:** abs-agg is AGPL-3.0 (copyleft); the absToolbox repo declares no license.
Borrow the patterns (dry-run, rule DSL, declarative registry, provider shape), not the code.

## Sources

- github.com/jeeftor/audiobook-organizer
- github.com/austinsr1/ab_mover
- github.com/Vito0912/absToolbox, abs-agg, AudiMeta — https://abstoolbox.vito0912.de
- audnexus, AudiMeta, abs-tract, tagger-web, ABS custom-metadata-provider spec
- GuardChain (arXiv 2512.19011), RouteLLM, entity-resolution/record-linkage literature
- OpenAI Structured Outputs, Ollama structured-outputs, Gemini responseSchema, Anthropic tool-use

## Note

The original ABS Toolbox recon agent returned a placeholder result; this section is from a
re-run agent.

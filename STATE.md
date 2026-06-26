# STATE — parked 2026-06-25

Handoff for resuming the **Audiobookshelf AI metadata-curation fork** cold. Everything below is
committed and pushed; this is a clean pause point, not a half-finished change.

- **Repo:** github.com/killn77/ABS-AI-FORK · branch **`fork-main`** · HEAD **`c6ec5c33`**
- **Remotes:** `origin` = your fork, `upstream` = advplyr/audiobookshelf (merge upstream into `fork-main` periodically; do not rebase a public branch).
- **Status:** all tests green (full suite 378 + scorer 9; `npx mocha`). Runs live in isolated Docker.

## What this is
A fork that adds **review-first AI metadata cleanup** (title/subtitle/narrators) to Audiobookshelf
without a rewrite. Rationale, critique of the original research report, and roadmap:
- `../fork-review-and-start-plan.md` — the red-teamed critique + plan (start here)
- `FORK-M0.md` — feature overview, file inventory, API surface, config
- `FORK-DOCKER.md` — how to run it isolated in Docker
- `evals/README.md` — the eval harness + model scorecard

## Done (milestones; see `git log` for detail)
- **M0** tracer bullet: migration `v2.36.0` + 2 models, `OllamaMetadataAdapter`, `AiCurationManager`,
  `AiController`, review tab, settings — review-first, write-back via existing `PATCH /api/items/:id/media`.
- **M1** settings panel · bulk inbox (backend + `/library/:id/ai-inbox` UI) · adapter hardening
  (placeholder guard, clear-field, clear-intent) · **eval harness** (`evals/`, 53 labeled cases, pure scorer).
- **M1.5–1.8** model selection, deterministic sampling, prompt tuning — all **measured, not guessed**.

## Key decisions (reference `evals/README.md`; don't re-derive)
- **Model: `qwen3:30b-a3b`** (live container default), `qwen3:14b` lighter near-tie. Deterministic eval:
  30b **0.959 acc, 0 false positives**. `qwen3:8b` small-GPU fallback; **llama3.1 retired** (high FP).
- **`temperature:0` + thinking left ON** for qwen3 (think:false measurably *hurt* it: 0.851 vs 0.979).
- **Narrator normalization dropped** — 0 issues in the real library (measured).
- **Edition tags kept** (Dramatized Adaptation / Part X of Y / series); strip only true cruft (Unabridged, bitrate, format).

## The finding that drives "what's next" (not captured elsewhere)
Full-library audit (`evals/audit/library-cruft-regex.js`, all 5,910 books): **32% have fixable metadata.**
- **subtitle == title: 1,713 books (29%)** — the dominant issue (import pipeline copies title→subtitle).
- title cruft (Unabridged/bitrate/format): ~185 · mojibake: 3 · **narrators: 0**.
LLM sample (`evals/audit/library-llm-sample.js`, qwen3:30b): ~33% get suggestions, overwhelmingly subtitle clears.

## Next (M2 "library cleanup harvest" — NOT started)
Recommended if resuming. Harvest the ~1,900 fixes, split by trust level:
1. **Bulk subtitle=title dedup (1,713)** — deterministic (`subtitle == title`), no LLM; "clear all → one confirm" UX.
2. **AI title-cruft inbox (~185)** — per-item review (model occasionally over-strips; human-gate it).
3. Requires a **background job** (current `generateForLibraryBatch` is a bounded stopgap, max 25).
4. Later: Windows packaging (`pkg`→`@yao-pkg/pkg`, bundle ffmpeg, signing) — the chunky deferred part.

**Open product question (unanswered):** do you actually want subtitle=title cleared library-wide?
(Objectively redundant, but it's your library — confirm before bulk-applying.)

## How to resume
```bash
# server deps + client build
cd D:\ABS-FORK-AI\audiobookshelf && npm install && npm run client
npx mocha                              # full test suite

# run it isolated in Docker (port 13379; your real lib mounted read-only)
docker compose -f docker-compose.fork.yml up -d   # needs `ollama pull qwen3:30b-a3b`
# open http://localhost:13379, sign in with the admin account you created,
# Settings -> AI Curation -> enable, then the AI Suggestions tab / AI Inbox

# eval harness (deterministic regression gate)
node evals/run-eval.js qwen3:30b-a3b
OLLAMA_THINK=true|false node evals/run-eval.js <model>   # A/B reasoning

# library audits (reproduce the 32% finding)
node evals/audit/library-cruft-regex.js
node evals/audit/library-llm-sample.js qwen3:30b-a3b 60
```

## Gotchas
- **Dual-write models:** every new AI table must be in BOTH `Database.buildModels()` (fresh installs use
  `sequelize.sync`, which skips migrations) AND a `vX.Y.Z` migration file (upgrades). New columns always need a migration.
- **`pkg` is deprecated** — `build-win` needs `@yao-pkg/pkg` (CI installs it globally; not in devDependencies).
- **Fork-hostile CI:** `docker-build.yml` is guarded to `advplyr/audiobookshelf` (no-ops here); `notify-abs-windows.yml` needs a secret you don't have. Repoint/disable if you want CI.
- **Occasional Ollama "empty response"** throws per-item — the batch path catches and skips it; fine at scale.
- Audit scripts default to `Q:\Media\Audiobooks`; pass a path arg to point elsewhere.

## Suggested skills (for a resuming agent)
- **`superpowers:brainstorming`** — before committing to M2 scope or any new direction.
- **`superpowers:writing-plans`** then **`superpowers:executing-plans`** — if building M2 (background job + bulk-dedup UX).
- **`superpowers:test-driven-development`** — backend changes here are mocha-testable; keep the harness green.
- **`workflow-creator`** — if doing another fan-out (e.g. expanding the eval corpus, multi-author audits).
- Re-read `evals/README.md` before any model/prompt change and re-run `evals/run-eval.js` after — the harness is the regression gate.

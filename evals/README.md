# AI metadata-cleanup eval harness

Turns "the AI suggestions seem fine" into **measured, regression-testable numbers**. Runs a
labeled corpus of realistic messy-metadata cases through the real `OllamaMetadataAdapter`
against any model, scores the suggestions with a pure scorer, and prints a scorecard.

This exists because model/prompt quality must be *measured, not asserted* — the first run already
overturned an eyeballed "qwen > llama" guess (they were within noise, and qwen hallucinated a
co-narrator on a clean book).

## Run it

From the repo root, with Ollama running on the host:

```bash
node evals/run-eval.js                 # defaults to qwen2.5:7b
node evals/run-eval.js llama3.1        # pick a model
OLLAMA_BASE_URL=http://127.0.0.1:11434 node evals/run-eval.js qwen2.5:7b
```

Output: a per-case PASS/PART/FAIL line (with the reason for each failed expectation) and a
scorecard. Results are also written to `evals/results-<model>.json` (gitignored).

## Scorecard metrics

- `expectationAccuracy` — fraction of all per-field expectations satisfied (headline number).
- `falsePositiveRate` — fraction of "leave-it-alone" (`none`) fields the model wrongly changed.
  **The trust metric** — changing correct metadata is worse than missing a fix.
- `missRate` — fraction of should-change fields the model left untouched.

## Case format (`cases.json`)

```json
{
  "id": "title-bitrate-format-tags",
  "category": "file-naming-artifacts",
  "input": { "title": "Project Hail Mary [Unabridged] 128kbps", "subtitle": null, "narrators": ["Ray Porter"] },
  "expect": [
    { "field": "title", "rule": "clean", "shouldContain": ["Project Hail Mary"], "mustNotContain": ["128kbps", "unabridged"] },
    { "field": "subtitle", "rule": "none" },
    { "field": "narrators", "rule": "none" }
  ]
}
```

Rules: `none` (must not change — measures false positives), `clear` (must empty the field),
`clean`/`normalize`/`set` (must change; scored by `shouldContain` + `mustNotContain`, or exact `equals`).
Scoring lives in `score.js` (pure, unit-tested in `test/evals/score.test.js`).

## Workflow when changing the prompt or model

1. Edit the adapter prompt (or pick a model).
2. `node evals/run-eval.js <model>` and compare `expectationAccuracy` + `falsePositiveRate`
   against the previous `results-<model>.json`.
3. A drop in accuracy or a rise in false positives is a regression — investigate before shipping.

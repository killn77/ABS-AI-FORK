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

## Latest sweep (50-case corpus, tuned prompt)

| model | accuracy | false-positives | miss | pass/part/fail |
|---|---|---|---|---|
| **qwen3:30b-a3b** | **0.986** | **0.000** | 0.031 | 48/2/0 |
| qwen3:14b | 0.965 | 0.000 | 0.031 | 45/5/0 |
| qwen2.5:7b (tuned) | 0.872 | 0.046 | 0.125 | 32/18/0 |
| qwen3:8b | 0.823 | 0.000 | 0.250 | 25/25/0 |
| llama3.1 | 0.667 | 0.294 | 0.031 | 14/36/0 |

qwen3:30b-a3b and qwen3:14b are post the clear-intent guard fix; the other rows are pre-fix.

Takeaways: all qwen3 models hit **0 false positives**; within qwen3, size only moves the miss
rate. **qwen3:30b-a3b** is the top scorer and a great fit for ~24 GB GPUs (mixture-of-experts —
30B quality at ~3B speed). **qwen3:14b** is a near-equal lighter pick (~9 GB); **qwen3:8b** is the
safe small-GPU fallback (the shipped default). Re-run after any prompt/model change.

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

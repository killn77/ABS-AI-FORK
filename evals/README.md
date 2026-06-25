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

Deterministic runs (`temperature:0`, natural thinking) over the 50-case corpus:

| model | accuracy | false-positives | miss | pass/part/fail |
|---|---|---|---|---|
| **qwen3:30b-a3b** | **0.979** | **0.000** | 0.063 | 47/3/0 |
| qwen3:14b | 0.972 | 0.000 | 0.031 | 46/4/0 |
| mistral-small3.2:24b | 0.936 | 0.000 | 0.156 | 41/9/0 |
| qwen2.5:7b | 0.901 | 0.037 | 0.063 | 36/14/0 |
| qwen3:8b † | 0.823 | 0.000 | 0.250 | 25/25/0 |
| llama3.1 † | 0.667 | 0.294 | 0.031 | 14/36/0 |

† older non-deterministic baselines, kept for reference.

Takeaways:
- **qwen3:30b-a3b** is the top scorer and a great fit for ~24 GB GPUs (MoE — 30B quality at
  ~3B speed); **qwen3:14b** is a near-tie at half the VRAM (~9 GB, lower miss) — the value pick.
- All qwen3 models + mistral-small3.2 hit **0 false positives** (the trust metric). mistral is a
  solid alternative but misses ~2.5× more than qwen3:30b, mostly narrator normalizations.
- **Keep qwen3 thinking ON.** Disabling it (`think:false`) dropped qwen3:30b to 0.851 (miss 0.375).
- `temperature:0` makes every run reproducible (verified: identical across two runs) — so this
  table is a real regression baseline. Use `OLLAMA_THINK=true|false node evals/run-eval.js <model>`
  to A/B reasoning.

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

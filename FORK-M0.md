# Fork M0 — AI Metadata Curation (tracer bullet)

This fork adds a **review-first AI metadata curation** vertical slice to Audiobookshelf. M0 proves the
end-to-end architecture (orchestration seam → data model → AI output → review UX) with the smallest possible
feature, on the **existing Docker/node path**. Windows packaging, vectors/RAG, multi-provider routing, and MCP
are deliberately **deferred** (see `../fork-review-and-start-plan.md`).

## What it does

For one **book** library item, an admin/editor can generate AI suggestions for `title`, `subtitle`, and
`narrators`. Each suggestion is stored as a **pending** row and shown in an **AI Suggestions** tab in the item
edit modal with the current value, the proposed value, a rationale, and a confidence. Accepting a suggestion
writes the field through the **existing, already-reviewed `PATCH /api/items/:id/media` path** (never the
auto-applying `/match` path). The decision is recorded for audit.

- **Provider:** local **Ollama** via its structured-output API (`POST {baseUrl}/api/chat` with a JSON-schema
  `format`), called with **axios** — no new dependency, same idiom as every other provider in `server/providers/`.
  Swapping to an OpenAI-compatible cloud endpoint later is a base-URL change.
- **Config:** single global `ServerSettings` (the user's chosen scope) — no per-user credential tables.
- **Privacy:** opt-in, **off by default** (`aiCurationEnabled = false`). Local-first means no data leaves the host.

## Configuration

Global settings (in `ServerSettings`, env-overridable):

| Setting | Default | Env override |
|---|---|---|
| `aiCurationEnabled` | `false` | — |
| `aiOllamaBaseUrl` | `http://127.0.0.1:11434` | `OLLAMA_BASE_URL` |
| `aiOllamaModel` | `llama3.1` | `OLLAMA_MODEL` |

The feature returns `403 AI curation is disabled` until `aiCurationEnabled` is set to `true` (via the settings
API/DB; an admin UI toggle is M1).

## API surface

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/items/:id/ai-suggestions` | Generate + persist pending suggestions (canUpdate) |
| `GET`  | `/api/items/:id/ai-suggestions` | List suggestions for an item |
| `POST` | `/api/ai-suggestions/:suggestionId/decision` | Record accept/reject/edit (canUpdate) |

## Files

**New**
- `server/migrations/v2.36.0-create-ai-metadata-tables.js` — `aiMetadataSuggestions` + `aiMetadataReviewDecisions`
- `server/models/AiMetadataSuggestion.js`, `server/models/AiMetadataReviewDecision.js`
- `server/providers/OllamaMetadataAdapter.js` — Ollama call + pure parse/validate
- `server/managers/AiCurationManager.js` — orchestration (singleton)
- `server/controllers/AiController.js`
- `client/components/modals/item/tabs/AiSuggestions.vue` — review tab
- `test/server/providers/OllamaMetadataAdapter.test.js` — 12 unit tests

**Modified**
- `server/Database.js` — register the two models in `buildModels()` + getters
- `server/objects/settings/ServerSettings.js` — 3 AI config fields (default/parse/serialize/env)
- `server/routers/ApiRouter.js` — `AiController` import + 3 routes
- `client/components/modals/item/EditModal.vue` — book-only `ai` tab
- `client/strings/en-us.json` — 8 i18n keys

> Note: every new DB table is registered in **both** `Database.buildModels()` (fresh installs use `sequelize.sync`,
> which skips migrations) **and** the migration file (upgrades). New columns on existing tables would also need a
> migration — `sync` runs with `alter:false`.

## Verification status

**Verified (automated):**
- `npx mocha test/server/providers/OllamaMetadataAdapter.test.js` → **12 passing** (parse/validate/no-op/clamp/dedupe).
- `npx mocha` (full server suite) → **353 passing, 0 failing** — model/router/settings changes load cleanly.
- Migration up/down + idempotency smoke-tested against a real SQLite DB (all columns present, clean rollback).
- `client/strings/en-us.json` parses; `AiSuggestions.vue` `<script>` is valid JS.

**Pending (manual / M1):**
- Live client build (`npm run client`) + browser flow with a running Ollama. The Vue template was not built here.
- A Cypress component test for `AiSuggestions.vue` (M1, per ABS conventions).
- End-to-end run against a real Ollama model (the adapter's network path is exercised only against a live server).

## How to try it locally

1. Install + run [Ollama](https://ollama.com); `ollama pull llama3.1`.
2. Build client + run server: `npm run client && npm start` (or Docker).
3. Enable AI: set `aiCurationEnabled = true` in server settings (DB or settings API), or run with the env override.
4. Open a book → edit modal → **AI Suggestions** → **Generate suggestions** → accept/reject.

## Next (M1)

Bulk curation inbox across a library + a low-confidence queue, an admin settings toggle for the AI config, the
Cypress component test, and the **start of an eval corpus** so provider/model choices are measured, not asserted.

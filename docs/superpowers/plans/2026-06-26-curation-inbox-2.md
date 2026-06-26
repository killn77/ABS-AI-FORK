# Curation Inbox 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a compact AI Inbox review console with suggestion history, filters, counts, badges, and revert access.

**Architecture:** Keep behavior inside the existing AI curation controller/manager and Vue inbox page. Backend filters are additive and default to pending-only behavior for compatibility.

**Tech Stack:** Node.js, Sequelize, Express controllers/routers, Vue/Nuxt, Mocha/Chai.

---

### Task 1: Backend Filters And Summary

**Files:**
- Modify: `server/managers/AiCurationManager.js`
- Modify: `server/controllers/AiController.js`
- Modify: `server/routers/ApiRouter.js`
- Test: `test/server/managers/AiCurationManager.test.js`

- [ ] Add pure helpers on `AiCurationManager`: `normalizeSuggestionFilters(query)`, `buildSuggestionWhere(filters)`, and `buildSuggestionSummary(rows)`.
- [ ] Replace `getPendingSuggestionsForLibrary(libraryId)` with `getSuggestionsForLibrary(libraryId, filters)` while leaving `getPendingSuggestionsForLibrary` as a wrapper for current callers.
- [ ] Add `getSuggestionSummaryForLibrary(libraryId)` that loads suggestion rows joined to the target library and returns counts by status, issue type, and origin.
- [ ] Update `AiController.getLibrarySuggestions` to pass `req.query`.
- [ ] Add `AiController.getLibrarySuggestionSummary`.
- [ ] Register `GET /api/libraries/:id/ai-suggestions/summary` before the dynamic item suggestion routes.
- [ ] Test filter normalization and summary grouping.

### Task 2: Inbox UI Review Console

**Files:**
- Modify: `client/pages/library/_library/ai-inbox.vue`
- Modify: `client/strings/en-us.json`

- [ ] Add state for `suggestionSummary`, `statusFilter`, and `revertingId`.
- [ ] Add status filter buttons/chips using existing button/card styling.
- [ ] Add summary chips for pending, accepted, rejected, reverted, deterministic, and legacy counts.
- [ ] Add badges on each row for status, issue type, origin, legacy, and fast-apply.
- [ ] Hide accept/reject actions when `status !== 'pending'`.
- [ ] Show revert action when `status === 'accepted'`.
- [ ] Reload the active filter and summary after accept, reject, revert, generation, cleanup suggestion creation, and cleanup apply.

### Task 3: Verification And Handoff

**Files:**
- Create: `docs/superpowers/handoffs/2026-06-26-curation-inbox-2.md`

- [ ] Run `npx mocha test/server/managers/AiCurationManager.test.js test/server/managers/AiLibraryCleanupManager.test.js test/server/utils/aiCleanupRules.test.js`.
- [ ] Run `npm run client`.
- [ ] Commit docs and implementation separately if verification passes.
- [ ] Write a handoff with branch, commits, verification, local Docker status, and next recommended slice.

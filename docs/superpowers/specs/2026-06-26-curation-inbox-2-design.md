# Curation Inbox 2.0 Design

## Goal

Upgrade the fork AI Inbox from a pending-only queue into a compact review console that can inspect pending suggestions, accepted/rejected/reverted history, deterministic cleanup rows, and legacy rows created before cleanup metadata existed.

## Scope

- Keep the existing AI Inbox route and cleanup harvest panel.
- Add library suggestion filtering by `status`, `issueType`, and `origin`.
- Add a library suggestion summary endpoint with counts by status, issue type, and origin.
- Add UI filters for `Pending`, `Accepted`, `Rejected`, `Reverted`, and `All`.
- Add badges for status, issue type, origin, legacy rows, and fast-apply eligibility.
- Show `Accept` and `Reject` only for pending suggestions.
- Show `Revert` for accepted suggestions; the existing revert endpoint remains responsible for staleness checks.

## Non-Goals

- Do not add new cleanup rules in this slice.
- Do not change item-level AI suggestions beyond shared backend behavior.
- Do not introduce background jobs or long-running scans.
- Do not automatically mutate any item outside the already-confirmed cleanup apply flow or an explicit user action.

## Architecture

`AiCurationManager` owns library suggestion filtering and summary aggregation. `AiController` exposes those manager methods through existing library routes, preserving the current default of pending-only suggestions. The Vue inbox page owns display state, loads summary plus filtered rows, and routes pending decisions through the existing decision endpoint and accepted reversions through the existing revert endpoint.

## Data Flow

1. AI Inbox loads `GET /api/libraries/:id/ai-suggestions/summary`.
2. AI Inbox loads `GET /api/libraries/:id/ai-suggestions?status=pending` by default.
3. Filter tabs reload suggestions with the selected status query.
4. Accept/reject records a decision, updates summary, and reloads the active filter.
5. Revert calls `POST /api/ai-suggestions/:suggestionId/revert`, updates summary, and reloads the active filter.

## Error Handling

Backend query filters are normalized to allow only known statuses and exact issue/origin strings. Invalid or unknown statuses fall back to `pending` so the existing endpoint remains safe. Revert failures surface the server error text when available, which is important for stale rows.

## Testing

Add unit coverage for filter normalization and summary shaping in `AiCurationManager`. Run targeted manager tests plus existing cleanup manager/rules tests. Run the client build to catch Vue template and string regressions.

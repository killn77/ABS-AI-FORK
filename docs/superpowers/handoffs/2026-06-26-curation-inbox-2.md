# Curation Inbox 2.0 Handoff

## Branch

- Repo: `D:\ABS-FORK-AI\audiobookshelf`
- Branch: `fork-main`
- Ahead of origin before this slice: 12 commits
- New commits in this slice:
  - `2cbb0bc8 Add curation inbox 2 plan`
  - `0f5da516 Add curation inbox review filters`

## What Changed

- Added design spec: `docs/superpowers/specs/2026-06-26-curation-inbox-2-design.md`
- Added implementation plan: `docs/superpowers/plans/2026-06-26-curation-inbox-2.md`
- Added library AI suggestion filters:
  - `status=pending|accepted|rejected|reverted|all`
  - optional `issueType`
  - optional `origin`
- Added `GET /api/libraries/:id/ai-suggestions/summary`.
- Upgraded `client/pages/library/_library/ai-inbox.vue` with:
  - summary chips
  - status filter buttons
  - suggestion status/issue/origin badges
  - legacy and fast-apply badges
  - pending-only accept/reject actions
  - accepted-row revert action

## Verification

Passed:

```powershell
npx mocha test/server/managers/AiCurationManager.test.js test/server/managers/AiLibraryCleanupManager.test.js test/server/utils/aiCleanupRules.test.js
```

Result: `21 passing`

Passed:

```powershell
npm run client
```

Result: Nuxt generated successfully. Existing project warnings remain: npm audit vulnerabilities, deprecated packages, asset-size warnings, and the existing Node `fs.existsSync` deprecation warning.

## Runtime Notes

- The running Docker app on port `13379` was not rebuilt after this slice. Rebuild/restart is needed before browser-testing Curation Inbox 2.0 in the container.
- Existing fork DB audit before this slice reported 8 books scanned, 0 cruft issues, and 7 accepted AI suggestion rows.
- Old accepted rows with `(none)` issue/origin are expected legacy rows from before cleanup metadata columns existed.

## Next Recommended Slice

Rebuild the Docker image/container and browser-test:

1. Open AI Inbox.
2. Confirm summary chips show accepted/legacy/deterministic counts.
3. Click `Accepted`, `Rejected`, `Reverted`, and `All`.
4. Confirm old accepted legacy suggestions show badges and no accept/reject buttons.
5. If an accepted cleanup suggestion still matches current metadata, test `Revert`.

After UI verification, the next code slice should add one more deterministic cleanup rule, probably subtitle cruft, because the sidecar library audit showed only 4 obvious subtitle cruft rows and that is a lower-risk rule than title cruft.

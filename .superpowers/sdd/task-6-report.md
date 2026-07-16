# Task 6 Report: Two-Origin and Official-Container Certification

## Outcome

Implemented all three certification lanes against the exact supported image
`ghcr.io/immich-app/immich-server:v3.0.3` (arm64 digest
`sha256:c716dc20f957aafd89fa9d284a2ec63e25c9e2d8d8e87c6197d540a3dce237db`).
The final combined run exited 0 with `Local synthetic certification completed for: all`.

The local synthetic certification does not replace the brief's external release
gate against a sanitized production-shaped clone.

## Certified lanes

1. `origin-v3.0.3-to-fork`
   - Booted exact official v3.0.3 and created non-empty user, asset, album,
     plugin, method, workflow, and workflow-step data.
   - Booted the fork before and after plugin synchronization and preserved the
     official ledger, workflow schema, row IDs, and row digests.
2. `current-fork-to-official-v3.0.3`
   - Constructed the true legacy 18-migration origin, including the
     `1779400000000-UpdateWorkflowTables` marker.
   - Seeded 256 distinct standards-valid PNG assets and 256 albums.
   - Seeded the existing workflow with the exact official v3.0.3 core WASM
     (SHA-256 `ce2156934a9ce62010b93f551a6963f46668fdcda1aecb14a0b19cc1bdd8afed`)
     and its real `assetFavorite` `AssetV1` method.
   - Interrupted and resumed all seven batch-size-1 backfills and storage
     verification with SIGKILL. Final storage verification covered 256 assets.
   - Aliased only `177940...` to `177861...`, preserved workflow row digests,
     applied later official workflow migrations, disabled maintenance cleanly,
     and booted exact official v3.0.3.
3. `official-v3.0.3-to-fork-return`
   - Waited for official microservices readiness before workflow operations.
   - Logged in, read and executed the pre-handoff workflow, created a second
     workflow, and uploaded, downloaded, and deleted valid media.
   - Re-entered maintenance through authenticated official API
     `POST /api/admin/maintenance` and asserted the database maintenance flag.
   - Reconciled and activated the compatible fork in the final transaction.
     All seven kinds finished with `processed=256`, `remaining=0`, null cursors,
     `reconciliationStatus=complete`, and `verified=true`; both workflows
     remained ordinary upstream rows and no workflow sidecar existed.

## Additional fixes proven during certification

- `AppRepository.sendOneShotAppRestart` now waits for server-side restart
  acknowledgement, rejects failed/non-ok acknowledgements, closes the one-shot
  Socket.IO adapter, and disconnects both Redis clients in `finally`.
- Disposable container smoke: enable-maintenance exit 0 / DB true;
  disable-maintenance exit 0 / DB false, with no teardown stack trace.
- Official startup is gated on both HTTP health and the microservices-ready log,
  preventing workflow execution before its runtime secret and plugin load.

## Fresh verification

- Combined official-container certification: 3 lanes, exit 0.
- Server focused unit suites: 56/56 passed.
- Fork-schema medium suites: 102/102 passed.
- High-risk migration-ledger medium rerun: 7/7 passed.
- AppRepository and migration-provider rerun: 9/9 passed.
- `pnpm --filter immich check`: passed.
- `pnpm --filter immich-e2e check`: passed.
- Focused server/e2e ESLint and `bash -n scripts/test-fork-roundtrip.sh`: passed.

## Review note

The harness treats command output containing `Error:` as failure because some
Nest Commander paths can otherwise return a zero exit code. The maintenance
restart race was fixed in production code rather than tolerated in the harness.

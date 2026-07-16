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

## Independent-review correction closeout

The independent review in `.superpowers/sdd/task-6-review.md` returned
`REQUEST CHANGES` for three gaps: return stopped in maintenance, the saved-plan
data contract was materially under-certified, and CI omitted production
compatibility paths. The correction closes all three:

- `prepare-fork` output is checked strictly, the maintenance worker is stopped,
  maintenance is disabled by a one-shot admin process, the database flag is
  asserted false, and normal fork API plus microservices must become ready
  before final assertions.
- The current-fork fixture now records exact evidence for privacy, albums,
  enrichment, automation, health, storage, and checksum. It includes retained
  non-default rows and deletion targets; return proves official defaults,
  archived orphan evidence, deleted-sidecar absence, seven complete progress
  rows, authenticated normal API, and exact final counts.
- Official v3.0.3 performs real server/timeline/search/edit/album/job/workflow
  operations, restarts on the same database, and repeats workflow operations
  after restart.
- CI paths include app-module, command, repository, storage-service, fork-schema,
  E2E, harness, workflow, and documentation compatibility surfaces.

Certification also exposed and corrected two boundary defects:

- The fork had diverged from the official v3 core-plugin host ABI. It now
  registers `searchAlbums`, `createAlbum`, `addAssetsToAlbum`,
  `addAssetsToAlbums`, and `httpRequest` for both in-process and worker loads,
  while retaining `hideNsfwAssets: true` in synthesized plugin auth. Workflow,
  plugin, method, and step rows are not migrated or sidecarred.
- The follow-up review found that host registration alone did not carry each
  official method's `allowedHosts` into Extism. The official public column is
  now represented in the model, selected with workflow steps, preserved by
  plugin upsert, and passed as call context through both in-process and worker
  execution. Before handoff, repository capability checks keep the legacy
  no-column schema operational and expose an empty allow-list; after the
  unchanged official `1782414436633` migration, repositories use and update
  the upstream column. No workflow migration, workflow sidecar, or workflow
  table rewrite was introduced.
- Smart-album child reconciliation now treats a rule whose public album is
  missing as orphaned even before the parent rule is deleted. A medium
  regression deletes only the public album and proves its rule, match, and
  exclusion are all archived and deleted in the same reconciliation.
- PostgreSQL non-finite numeric evidence is recursively canonicalized to
  explicit string sentinels before both live comparison and JSON persistence,
  preventing `NaN` from collapsing to `null`.

The final ML-disabled container phase aligns system config with the test
runtime by setting only image-description and NSFW detection to disabled via
the authenticated API, preserving all other fields. This lets the deliberate
fork enrichment privacy gate remain intact while still proving both preserved
official workflows execute after normal return.

### Fresh correction verification

- Clean combined official-container certification: all 3 lanes, exit 0,
  `Local synthetic certification completed for: all`.
- Broad workflow/fork-schema unit selection: 126/126 passed.
- Workflow host-ABI/privacy/context regression: 3/3 passed.
- Plugin in-process/worker context boundary regression: 2/2 passed.
- Legacy/official workflow repository schema-stage regressions: 3/3 passed.
- Deleted smart-album parent reconciliation regression: 1/1 passed.
- Broad return/workflow medium selection: 75 passed, 9 expected skips because
  the local optional core-WASM artifact was absent.
- Related workflow medium selection: 16 passed, 9 expected skips because the
  local optional core-WASM artifact was absent; the container run exercised the
  real official WASM in both execution modes.
- Non-finite evidence regression: 1/1 passed.
- Server and E2E TypeScript checks, E2E full lint, focused server lint/Prettier,
  shell syntax, Compose validation, and `git diff --check`: passed.
- GitNexus compare against `fork/main` reported HIGH cumulative risk across the
  complete migration wave (202 files, 905 mapped symbols, 14 processes). The
  exact staged second correction reported LOW risk (11 files, 20 mapped
  symbols, no affected process); focused ABI/schema-stage tests and the real
  official WASM container run cover the changed boundaries.

The external release gate is unchanged: repeat on a sanitized,
production-shaped current-fork clone with interruption/resume evidence for all
backfills and storage verification before release.

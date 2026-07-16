# Corrective Task 2 Report: Rollback-Safe Authority Phases

Baseline: `b2ac71832c256965fac16b225bcda1f3d8f9ab61`

## Outcome

- Added one central authority policy: public/legacy reads are authoritative in `legacy`, `dual-write`, and `ready`; fork reads are authoritative only in `active`.
- Kept exact-copy dual writes enabled through `ready`, including privacy, album metadata, enrichment, config, smart albums, health, scores, and duplicate-frame projections.
- Made `inactive` expose neither fork-only reads nor fork config overlays.
- Made the locked official cutover atomically require `ready`, transition to `inactive`, set `active = false`, disable fork triggers, write the official-cutover audit, and return an inactive checkpoint.
- Prevented generic phase mutation from activating the fork. Only `activateAfterReturnReconciliation()` can perform `inactive -> active`, after verifying every backfill is complete.
- Preserved Task 1 workflow ledger alias and transaction rollback behavior. No official workflow migration file was modified.

## TDD Evidence

RED before production edits:

- `authority.spec.ts`: failed to resolve `src/fork-schema/authority`.
- `authority-cutover.spec.ts`: 4/4 failed because a `ready` smart-album write was absent from the public projection, `ready`/`inactive` still read sidecars, the cutover checkpoint remained `ready`, and reconciliation-only activation did not exist.

GREEN after implementation:

- Targeted unit batch: 8 files, 239/239 passed.
- Targeted PostgreSQL medium batch: 8 files, 99/99 passed.
- Task 1 preservation checks within that batch: ledger cutover 7/7 and workflow ledger alias 5/5.
- Authority-specific checks: pure policy 6/6 and PostgreSQL cutover 4/4.

## GitNexus Impact Evidence

Impact analysis was run before each existing production symbol was edited. Notable blast radius:

- `SmartAlbumRepository`: CRITICAL, 298 transitive symbols and 5 direct dependents. Edits were limited to phase predicates and exact public/sidecar mirroring, with service and medium repository coverage.
- `ForkPrivacyRepository.getPhase`: HIGH, 19 transitive and 2 direct dependents.
- `ForkAlbumMetadataRepository.getPhase`: HIGH, 15 transitive and 2 direct dependents.
- `ForkSchemaMigrationService`: MEDIUM, 11 transitive and 5 direct dependents.
- Derived-result phase helpers and health writes were MEDIUM; remaining repository predicate/write symbols were LOW or MEDIUM.

Compare detection against `fork/main` reported HIGH cumulative branch risk across 123 files, 601 indexed symbols, and 11 execution flows. That result includes the pre-existing branch work before this locked Task 2 baseline. Exact staged detection reported MEDIUM risk across 27 files, 42 indexed symbols, and 5 affected execution flows; all five are expected fork-sidecar backfill flows.

## Verification Commands and Results

- `pnpm --dir server exec vitest --config test/vitest.config.mjs --run ... --pool=forks --maxWorkers=1`: PASS, 8 files and 239 tests.
- `pnpm --dir server exec vitest --config test/vitest.config.medium.mjs --run ... --pool=forks --maxWorkers=1`: PASS, 8 files and 99 tests.
- `pnpm --filter immich check`: PASS.
- `pnpm --dir server lint`: PASS.
- `pnpm --dir server format`: PASS.
- `git diff --check`: PASS.
- Forbidden migration-file check for `177861`, `177980`, and `178241`: no Task 2 diff.

## Residual Concerns

- The compare-level GitNexus result is necessarily cumulative because this branch is already substantially ahead of `fork/main`; the staged result is the authoritative Task 2 scope check.
- A mistakenly broad Vitest invocation caused by misplaced passthrough arguments ran the whole medium suite and is not counted as verification. The required targeted fork-state rerun passed 28/28 immediately afterward.

## Review Corrections

The three Important findings in `task-2-review.md` were corrected regression-first on top of Task 2 commit `e2b0e030b2f2090cbee05322a684f80f79e11923`.

RED evidence before the correction edits:

- Central fork write-policy test: 6 failed and 6 passed because `isForkWriteEnabled` did not exist.
- PostgreSQL fork-state regression: `transitionPhase('inactive', 'active')` returned `true` rather than rejecting activation without return reconciliation.
- Domain no-mutation regressions: 6 failed and 36 passed across privacy/albums, enrichment/config/smart albums, and derived results because ordinary writes still mutated sidecars in `inactive` or `failed`.
- Exact 13-file general-medium reproduction: 13 failed files, 30 failed and 81 passed because the fixtures implicitly expected inactive fork-sidecar reads.

Corrections:

- Added `isForkWriteEnabled`, allowing ordinary fork-sidecar mutation only in `dual-write`, `ready`, and `active`.
- Rejected generic `active` transitions and made generic phase persistence always set `active = false`; only `activateAfterReturnReconciliation()` can activate after complete backfills.
- Applied the central write gate to privacy, album metadata, enrichment, config, smart-album automation, health, best-photo, and duplicate-frame ordinary mutation paths. Explicit reconciliation/backfill writers remain separate.
- Added inactive/failed snapshot assertions proving ordinary writes and cleanup leave every covered sidecar unchanged.
- Added `getActiveForkKyselyDB()` and adopted it only in the 13 general-medium fixtures whose assertions explicitly exercise active fork authority. Production inactive reads remain disabled.

Review-correction verification:

- Final targeted unit batch: PASS, 8 files and 245 tests.
- Final targeted PostgreSQL medium batch: PASS, 8 files and 103 tests, including Task 1 ledger and workflow-alias preservation.
- Exact 13-file general-medium command: PASS, 13 files and 111 tests.
- Focused post-cleanup fork-state rerun: PASS, 1 file and 28 tests.
- `pnpm --filter immich check`: PASS.
- `pnpm --dir server lint`: PASS.
- `pnpm --dir server format`: PASS.
- `git diff --check`: PASS.
- Forbidden migration-file check for `177861`, `177980`, and `178241`: no correction diff.

Additional pre-edit GitNexus impact warnings were reported before correction edits: `transitionPhase` was HIGH (9 transitive, 5 direct), `ForkPrivacyRepository.mirrorManyFromLegacy` was HIGH (14 transitive, 4 direct), and `ForkAlbumMetadataRepository.mirrorFromLegacy` was HIGH (13 transitive, 3 direct). The central derived-results write helper was MEDIUM; the remaining corrected mutation symbols were LOW or MEDIUM. Final compare detection against `fork/main` reports HIGH cumulative branch risk across 140 files, 609 indexed symbols, and 11 execution flows. Exact staged detection reports LOW risk across 28 files, 30 indexed symbols, and no affected execution flows.

## Re-review Corrections

The two Important findings in the appended re-review were corrected regression-first on top of `625cd6fc2b9ec8a66667e339a48f71958e6f549c`.

Asset cleanup RED evidence:

- A seeded PostgreSQL regression covered `AssetRepository.remove()` and `deleteAll()` in both `inactive` and `failed`.
- Before the production correction, all four combinations failed because deletion emptied health candidates, health rows, scores, duplicate frames, storage reservations, checksums, physical mappings, and orphan physical files.
- The same test proved both single and owner-wide deletion already cleaned all eight categories in `ready`.

Asset cleanup correction and GREEN evidence:

- `deleteForkDerivedResults()` now reads the locked transaction's phase and delegates the decision to central `isForkWriteEnabled` policy. Ordinary inactive/failed asset deletion still removes public assets but leaves all seeded fork rows byte-for-byte unchanged.
- The focused checksum/storage suite passes 24/24, including the four inactive/failed no-mutation cases and both ready cleanup cases.
- Pre-edit GitNexus impacts were LOW: `AssetRepository.remove` affected 5 symbols (4 direct), `deleteAll` affected 5 (4 direct), and `deleteForkDerivedResults` affected 10 (2 direct), with no indexed execution flows.

Complete medium authority audit:

- Initial JSON run: 73 files, 514 passed, 19 failed, and 12 skipped. Sixteen failures were repeatable privacy/score authority fixtures; three were EXIF failures caused by absent media assets.
- Converted the remaining explicit fork-authority fixtures in best photos, workflow eligibility, asset, duplicate, tag, album sync, album-asset sync, album-to-asset sync, asset-metadata sync, and partner-asset sync to `getActiveForkKyselyDB`. No inactive reads were restored.
- The repaired 10-file fixture selection passes 109/109.
- Final serialized JSON run: 73 files; 71 passed and 2 failed; 530 tests passed, 3 failed, and 12 skipped. Every privacy, score, Task 1 ledger, and Task 2 authority test is green.
- The only failures are unchanged environment failures in `exif-date-time.spec.ts` (2) and `exif-tags.spec.ts` (1). The referenced checkout assets `date-priority-test.jpg`, `gps-datetime.jpg`, `metadata/tags/tag.jpg`, and `gps-position/empty_gps.jpg` are absent. The tests were not changed or masked.
- A concurrent full run briefly produced two migration-ledger failures with `driver has already been destroyed`; the focused ledger rerun passed 3/3 and the serialized full run passed all ledger tests.

Final re-review gates:

- Targeted unit batch: PASS, 8 files and 245 tests.
- Targeted Task 2/Task 1 PostgreSQL batch: PASS, 8 files and 109 tests.
- Exact 13-file general-medium batch: PASS, 13 files and 111 tests.
- `pnpm --filter immich check`: PASS.
- `pnpm --dir server lint`: PASS.
- `pnpm --dir server format`: PASS.
- `git diff --check`: PASS.
- Forbidden migration-file check for `177861`, `177980`, and `178241`: no re-review correction diff.
- Compare detection against `fork/main`: HIGH cumulative branch risk across 149 files, 607 indexed symbols, and 11 execution flows.
- Exact staged detection: LOW risk across 13 files, 5 indexed symbols, and no affected execution flows.

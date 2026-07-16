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
- A mistakenly broad Vitest invocation was interrupted and is not counted as verification. It exposed older general medium fixtures that insert NSFW enrichment rows while relying on the former `ready`-reads-sidecar behavior; the required authority and feature suites now encode the corrected phase contract explicitly.

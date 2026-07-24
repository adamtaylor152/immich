# Corrective Task 3 Report

## Outcome

Cutover preflight now requires complete, exact evidence for the classified installation. Catalog comparison is fail-closed across the full public and `immich_fork` schema, fork migration and backfill sets are exact, checksum and path mapping coverage use counts plus deterministic digests, every manifest table is digested, and apply-time locks derive from every table in the classified manifest.

The official workflow migrations `177861`, `177980`, and `178241` were not edited, imported, or invoked by this task.

## TDD Evidence

- Pure catalog tests first failed because `src/fork-schema/catalog` did not exist.
- The PostgreSQL mutation matrix then demonstrated the old fail-open behavior: 1 passed and 16 failed before production wiring.
- GREEN catalog/cutover units: 24 tests passed.
- GREEN complete medium mutation matrix: 19 tests passed, including independent missing/unknown backfills and migrations, claim/cursor/error/digest failures, all required unknown catalog object kinds, and checksum/mapping LEFT JOIN NULL, count, and digest failures.
- The aliased-workflow fixture was classified from physical schema evidence rather than its ledger alias: `public.physical_file` means current fork. A physically original official database therefore remains matched only to the exact v3.0.3 public manifest.
- Review RED reproduced the exact original-v3.0.3 crash: real repository preflight raised `column "physicalOriginalFileId" does not exist` before catalog comparison.
- Review RED reproduced the incomplete lock boundary: the exact writer PID did not wait on `public.user`.
- Review GREEN restores an exact v3.0.3 public-schema dump, applies only the current five fork migrations, and proves real preflight ready with a clean exact catalog. Missing, reordered, extra, and partial official ledgers remain fail-closed.
- Review GREEN proves all five non-workflow provider gaps remain rejected for current-fork installations, while Task 1's three audited workflow stages remain unchanged.
- Review GREEN proves deterministic complete lock sets of 98 tables for current-fork and 89 tables for original-official, observes all 89 original locks inside the transaction, and observes the current-fork `public.user` writer wait and then finish after release.

## Manifest Provenance

The manifests were generated, not hand-edited, from disposable PostgreSQL containers using `ghcr.io/immich-app/postgres:14-vectorchord0.4.3`:

- Review regeneration used `immich-task3-review-official` on port 55435, migrated from detached exact tag worktree `/tmp/immich-v3.0.3-task3-review` at `v3.0.3` (`cd308ad93`).
- Review regeneration used `immich-task3-review-fork` on port 55436, migrated from the current baseline provider with the exact five-migration fork provider.
- The committed medium fixture is a gzip/base64 schema-only dump plus exact official ledger/override rows from that same v3.0.3 database. Fixture SHA-256: `a2adf3d6eca705116923b78940b9a9e9c88661e7c718e2e0ebcd80c93497b073`.

The generator independently checks each database ledger against its exact source provider before reading catalogs. The executed generation command was:

```bash
pnpm --filter immich exec tsx scripts/generate-fork-schema-catalog.ts \
  --official-tag v3.0.3 \
  --official-url postgres://postgres:postgres@localhost:55435/immich \
  --fork-url postgres://postgres:postgres@localhost:55436/immich \
  --out src/fork-schema/manifests
```

`tsx` is a direct server dev dependency pinned at `4.21.0`; the lockfile already contained that exact package version and now records the direct importer.

It was run twice. Both outputs remained byte-identical:

| Manifest | SHA-256 | Schemas | Tables | Columns | Enums | Constraints | Indexes | Functions | Triggers | Overrides | Fork migrations |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| fork-v2 | `2ff091de0e4ee02b544cb69309afea02f88d609be9c70dc287ec1764ebf516f0` | 2 | 98 | 700 | 19 | 209 | 315 | 265 | 45 | 90 | 5 |
| v3.0.3 | `266d1dce5a76eeba613868a239e0b9bed89fb2ced56274d730981cee4c0d5a9a` | 1 | 66 | 473 | 18 | 146 | 231 | 265 | 41 | 81 | 0 |

## Verification

- `pnpm --filter immich test --run ...`: 7 files, 147 unit/startup/backup/authority/workflow tests passed.
- `pnpm --filter immich test:medium --run ... --pool=forks --maxWorkers=1`: 5 files, 49 migration-ledger/workflow-alias/authority/ledger-cutover/evidence tests passed.
- `pnpm --filter immich format`: passed.
- `pnpm --filter immich lint`: passed with zero warnings.
- `pnpm --filter immich check`: passed.
- `git diff --check`: passed.

## GitNexus

- Pre-edit impact on `DatabaseRepository`: CRITICAL, 330 transitive symbols and 21 direct callers. This was reported before editing.
- New Task 2/3 symbols were absent from the stale index and returned UNKNOWN.
- Review compare against `fork/main`: HIGH, 251 changed indexed symbols across 158 files and 8 affected flows. This comparison includes the full pre-existing corrective branch delta, so exact correction scope is verified separately with staged detection.
- Exact staged review correction: LOW, 3 changed indexed symbols across 14 files and no affected execution flows. The stale index does not recognize the newly added cutover symbols and conservatively attributes repository hunks to nearby indexed symbols.

## Residual Concerns

- Catalog capture intentionally excludes sequences: they are not row-digestible tables and are outside the required catalog categories. Tables, columns, enums, constraints, indexes, functions, triggers, migration overrides, schemas, and exact ledgers are covered.
- Catalog collection and table digests are deliberately comprehensive and may be expensive on large installations; cutover preflight is an operator maintenance-window operation.

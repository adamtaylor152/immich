# Corrective Task 3 Report

## Outcome

Cutover preflight now requires complete, exact evidence for the classified installation. Catalog comparison is fail-closed across the full public and `immich_fork` schema, fork migration and backfill sets are exact, checksum and path mapping coverage use counts plus deterministic digests, every manifest table is digested, and apply-time fork locks derive from the fork manifest.

The official workflow migrations `177861`, `177980`, and `178241` were not edited, imported, or invoked by this task.

## TDD Evidence

- Pure catalog tests first failed because `src/fork-schema/catalog` did not exist.
- The PostgreSQL mutation matrix then demonstrated the old fail-open behavior: 1 passed and 16 failed before production wiring.
- GREEN catalog/cutover units: 24 tests passed.
- GREEN complete medium mutation matrix: 19 tests passed, including independent missing/unknown backfills and migrations, claim/cursor/error/digest failures, all required unknown catalog object kinds, and checksum/mapping LEFT JOIN NULL, count, and digest failures.
- The aliased-workflow fixture was classified from physical schema evidence rather than its ledger alias: `public.physical_file` means current fork. A physically original official database therefore remains matched only to the exact v3.0.3 public manifest.

## Manifest Provenance

The manifests were generated, not hand-edited, from disposable PostgreSQL containers using `ghcr.io/immich-app/postgres:14-vectorchord0.4.3`:

- `immich-task3-official` on port 55433, migrated from detached exact tag worktree `/tmp/immich-v3.0.3-task3` at `v3.0.3` (`cd308ad93`).
- `immich-task3-fork` on port 55434, migrated from detached baseline worktree `/tmp/immich-task3-baseline` at `6802e5b5ea81848c9a5d5bd5218f8fa98fc36377` with the exact five-migration fork provider.

The generator independently checks each database ledger against its exact source provider before reading catalogs. The executed generation command was:

```bash
pnpm dlx tsx scripts/generate-fork-schema-catalog.ts \
  --official-tag v3.0.3 \
  --official-url postgres://postgres:postgres@localhost:55433/immich \
  --fork-url postgres://postgres:postgres@localhost:55434/immich \
  --out src/fork-schema/manifests
```

It was run twice. Both outputs remained byte-identical:

| Manifest | SHA-256 | Schemas | Tables | Columns | Enums | Constraints | Indexes | Functions | Triggers | Overrides | Fork migrations |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| fork-v2 | `2ff091de0e4ee02b544cb69309afea02f88d609be9c70dc287ec1764ebf516f0` | 2 | 98 | 700 | 19 | 209 | 315 | 265 | 45 | 90 | 5 |
| v3.0.3 | `266d1dce5a76eeba613868a239e0b9bed89fb2ced56274d730981cee4c0d5a9a` | 1 | 66 | 473 | 18 | 146 | 231 | 265 | 41 | 81 | 0 |

## Verification

- `pnpm --filter immich test --run ...`: 6 files, 141 unit/startup/backup/authority/workflow tests passed.
- `pnpm --filter immich test:medium --run ... --pool=forks --maxWorkers=1`: 5 files, 38 migration-ledger/workflow-alias/authority/ledger-cutover/evidence tests passed.
- `pnpm --filter immich format`: passed.
- `pnpm --filter immich lint`: passed with zero warnings.
- `pnpm --filter immich check`: passed.
- `git diff --check`: passed.

## GitNexus

- Pre-edit impact on `DatabaseRepository`: CRITICAL, 330 transitive symbols and 21 direct callers. This was reported before editing.
- New Task 2/3 symbols were absent from the stale index and returned UNKNOWN.
- Compare against `fork/main`: HIGH, 253 changed indexed symbols across 149 files and 8 affected flows. This comparison includes the full pre-existing corrective branch delta, so exact Task 3 scope is verified separately with staged detection.
- Exact staged Task 3 scope: LOW, 15 changed indexed symbols across 11 files and no affected execution flows. The stale index attributes the new repository body conservatively to the containing `DatabaseRepository` class.

## Residual Concerns

- Catalog capture intentionally excludes sequences: they are not row-digestible tables and are outside the required catalog categories. Tables, columns, enums, constraints, indexes, functions, triggers, migration overrides, schemas, and exact ledgers are covered.
- The repository does not declare `tsx`; reproducible generation currently uses the pinned-on-execution `pnpm dlx tsx` runner. The TypeScript generator itself passes the project compiler gate.
- Catalog collection and table digests are deliberately comprehensive and may be expensive on large installations; cutover preflight is an operator maintenance-window operation.

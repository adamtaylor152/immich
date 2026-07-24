# Handoff Task 1 Report: Certified Return Startup Guard and Evidence

Baseline: `5aec7e3e3f4ac1d975b45e031a9b6a11b560f5c5`

## Outcome

- Added `ForkHandoffRepository` with exact ordered `v3.0.3` ledger validation from `supported-versions.json`.
- Added canonical SHA-256 official-ledger evidence, inactive/schema-version-2 state evidence, maintenance-mode evidence, exact applied cutover checkpoint evidence, and return-reconciliation status.
- Exposed the applied official handoff checkpoint with its report, database-backup, media-snapshot, and storage-verification identities.
- Guarded both normal startup and database-restore migration flows before migration-mode classification and before either official or fork provider executes.
- Kept fresh, legacy, schema-version-1, and active modes on their existing paths. No workflow/plugin DML or DDL was introduced.

## TDD Evidence

Initial RED:

- Required unit selection exited 1 because `fork-handoff.repository` and the two startup guard methods did not exist. Existing selected coverage remained 91 passing while the four new startup/restore assertions failed.
- Required return medium selection exited 1 because the new repository did not exist.

Ordering RED after the first implementation:

- Startup and restore assertions failed with guard invocation orders after migration-mode detection (`396 > 394` and `444 > 442`).
- Production flow was then changed so inactive/schema-version-2 return validation occurs before generic ledger classification or provider execution.

GREEN:

- Focused repository/startup/backup units: 3 files, 100 tests passed.
- Task 1-5 unit regression selection: 11 files, 181 tests passed.
- Return evidence medium suite: 8 tests passed.
- Task 1-5 PostgreSQL regression selection: 13 files, 192 tests passed.

The return medium suite rejects missing, extra, timestamp-reordered, and partial ledgers; rejects maintenance/state drift; accepts only exact inactive schema-version-2 evidence; and returns the applied checkpoint.

## Static and Scope Gates

- `pnpm --filter immich check`: passed.
- `pnpm --filter immich lint`: passed with zero warnings after one test-only `prefer-switch` correction.
- `pnpm --filter immich format`: passed.
- `git diff --check`: passed.
- GitNexus pre-edit impact: `DatabaseRepository` CRITICAL (330 upstream symbols, 21 direct); constructor LOW; `DatabaseService.onBootstrap` LOW (1 direct); `DatabaseBackupService.restoreDatabaseBackup` LOW (6 upstream, 2 direct); repository registration LOW.
- GitNexus exact worktree and baseline compare detection: LOW, 7 mapped changed symbols in 6 tracked files, zero affected execution flows. New repository and medium symbols were not present in the index mapping, so executable regressions are the controlling evidence for them.

## Constraints Preserved

- `AGENTS.md` and `CLAUDE.md` remain untracked and unstaged.
- No protected official workflow migration was added, edited, imported, or invoked manually.
- No fork migration or public-schema object was added.
- No Unraid path was accessed.

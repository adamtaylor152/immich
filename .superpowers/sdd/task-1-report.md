# Corrective Task 1 Report: Workflow Compatibility Ledger Alias

## Result

Status: DONE (including review corrections)

Baseline: `3041f02c85ccc0aa132b8eea342707f27f794064`

Implemented the exact, fail-closed workflow/plugin compatibility classifier and the transactionally audited legacy-to-official ledger alias. No official migration file was added, edited, imported, or manually invoked.

## Implementation

- Added exact migration constants for legacy `1779400000000-UpdateWorkflowTables`, official `1778614946174-UpdateWorkflowTables`, and the two later official workflow stages.
- Added inspectable, deterministic PostgreSQL catalog manifests for `post-update`, `post-plugin-templates`, and `post-allowed-hosts`; their SHA-256 digests cover tables, ordered columns, types, nullability, defaults, constraints, indexes, triggers, and workflow/plugin migration overrides.
- Added SHA-256 row evidence for non-empty `plugin`, `plugin_method`, `workflow`, and `workflow_step` tables using sorted `row_to_json` text and exact counts.
- Classified original installations as `official`, the SQL-equivalent current fork marker as `legacy-alias`, and rejected both/neither markers, mixed later stages, catalog drift, and marker/schema disagreement.
- Kept `1779400000000-UpdateWorkflowTables` classified as `legacy-fork` while excluding it from generic ledger deletion.
- Added workflow/plugin tables to the locked cutover set, reclassified under those locks, audited the complete alias evidence, preserved the original timestamp, changed only the ledger name, and re-read catalog/rows before commit.
- Allowed absent-provider ledger names only for the three audited official workflow stages; all other absent official migration names remain invalid.
- Kept the original-installation path mutation-free.

## TDD Evidence

RED was observed before production implementation:

`pnpm --filter immich exec vitest --config test/vitest.config.mjs --run src/fork-schema/workflow-compatibility.spec.ts --pool=forks --maxWorkers=1`

Result: exit 1 because `src/fork-schema/workflow-compatibility` did not exist.

The first PostgreSQL implementation runs also exposed and corrected:

- reserved SQL alias `constraint` (`syntax error at or near "constraint"`);
- placeholder catalog fingerprint rejection (`Unexpected workflow schema fingerprint: 90407fdee6064f3cbd373602b00df62e54088152f6c305cbab8e28b8d69d53c5`);
- JSON audit serialization that initially stored row digests as a string instead of a JSON array.

All three were fixed without weakening assertions.

### Review-correction RED evidence

The three review findings were reproduced before the corrective production edits:

- Real `commitForkSchemaCutover` tests for both the legacy-alias and original-official paths failed because `workflow_updatedAt` changed from `pg_trigger.tgenabled = 'O'` to `'D'`.
- The two-connection PostgreSQL test failed with `expected 'wrote' to be 'blocked'`, proving a concurrent `migration_overrides` writer could enter while the cutover transaction was paused after reclassification.
- Five ordered-ledger unit cases failed before `validateOfficialMigrationLedgerOrder` existed: valid prefixes through each of the three audited gaps, a special marker with missing predecessors, and reversed special-marker timestamp order.

### Review-correction fixes

- Removed workflow trigger and override objects from generic residue classification/cleanup. The workflow compatibility catalog evidence remains their sole cutover authority.
- Added `public.migration_overrides` to `CUTOVER_LOCK_TABLES`, so the override table is locked before verification, workflow reclassification, and ledger aliasing.
- Added canonical ordering validation against `supported-versions.json`. Applied upstream ledger names must be an exact timestamp-ordered prefix; unbundled applied names are permitted only at the three audited gap positions; bundled provider names must preserve the canonical prefix/order and may omit only those gaps.
- Ordered workflow compatibility evidence by ledger timestamp and name.

### Re-review concurrency-proof hardening

The first lock regression paused in `finishForkSchemaCutover` and inferred blocking from a 100 ms race. The re-review correctly identified that this could false-pass before the writer reached PostgreSQL and did not prove lock ordering relative to reclassification.

The corrected regression now:

- pins the writer to one Kysely connection and captures its exact `pg_backend_pid()`;
- pauses in the `commitForkSchemaCutover` verify callback, which is the first callback after `CUTOVER_LOCK_TABLES` is acquired and runs before workflow reclassification;
- polls `pg_stat_activity` and `pg_locks` from the cutover transaction with a bounded five-second failure deadline;
- requires that exact writer PID to have an ungranted `RowExclusiveLock` on `public.migration_overrides` with PostgreSQL reporting `wait_event_type = 'Lock'` and `wait_event = 'relation'`;
- releases the verify callback only after that evidence is asserted, then proves the cutover and writer finish and the writer row becomes visible.

No elapsed-time race is used as the blocking assertion, and no production code changed for this re-review correction.

## Verification

- Focused classifier/cutover/startup/backup unit regressions: 122 passed across 5 files.
- PostgreSQL workflow alias, ledger cutover, and migration-ledger regressions: 15 passed across 3 files.
- The workflow medium fixture contains non-empty binary wasm bytes, plugin schema JSON, workflow config JSON, and one row in each of all four protected tables.
- Current-fork alias, original-Immich no-op, audit contents, exact timestamp preservation, schema/row digest preservation, and transaction rollback all passed.
- Both real full-cutover workflow paths preserved final catalog and row digests plus `workflow_updatedAt` enablement.
- The two-connection override writer remained blocked until the cutover transaction committed.
- Re-review verification passed 14 relevant workflow units and 12 tests across the focused ledger-cutover/workflow PostgreSQL suites.
- Exact valid prefixes through all three audited gaps passed; missing predecessors and reversed special-marker timestamp order were rejected.
- `pnpm --filter immich check`: passed (plugin SDK build and TypeScript).
- `pnpm --filter immich format`: passed.
- `pnpm --filter immich lint`: passed with zero warnings.
- `git diff --check`: passed.

## GitNexus Safety

Pre-edit impact:

- `classifyMigration`: HIGH, 14 impacted symbols, 4 direct callers, 3 modules.
- `getForkSchemaCutoverEvidence`: LOW, 4 impacted symbols, 2 direct callers.
- `commitForkSchemaCutover`: LOW, 2 impacted symbols, 1 direct caller.
- `ForkSchemaCutoverService`: LOW, 10 impacted symbols, 4 direct callers.

Pre-commit `detect_changes(scope: compare, base_ref: fork/main)` reported HIGH for the accumulated branch delta: 555 changed symbols in 119 files, 11 affected flows. This is branch-wide baseline scope, not this Task 1 commit alone. Task-local `detect_changes(scope: all)` reported LOW: 6 indexed changed symbols in 4 tracked files and zero affected processes. The new untracked compatibility module/tests were not yet present in the index result, so executable tests and the explicit repository blast-radius checks remain the stronger evidence for those files.

After staging the exact Task 1 scope, `detect_changes(scope: staged)` reported LOW: 6 indexed changed symbols across 8 staged files and zero affected processes.

For the review-correction commit, `detect_changes(scope: compare, base_ref: fork/main)` reported HIGH for the accumulated branch delta: 248 indexed changed symbols across 123 files and 8 affected processes. The exact six-file corrective staged scope reported LOW: 2 indexed changed symbols, zero affected processes. GitNexus associated both indexed symbols with `DatabaseRepository`; the compatibility module and test additions were not yet represented as indexed symbols, so the executable regressions remain the primary evidence for those additions.

For the re-review test-only correction, the exact two-file staged scope reported LOW with zero indexed changed symbols and zero affected processes. The medium regression file remains outside GitNexus symbol mapping, so the direct PostgreSQL lock evidence and focused executable suites are authoritative for this commit.

## Scope Notes

- `AGENTS.md` and `CLAUDE.md` remained untracked and were not staged.
- The existing ledger-cutover medium test uses a Task-1-only repository subclass that stops before the official migrator. This is intentional: the source tree is explicitly missing official migrations `177861`, `177980`, and `178241`, and adding or invoking them is outside this task. The production service still reports checkpoint restore required if a real post-commit official migration run fails.

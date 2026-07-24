# Corrective Task 5 Report: Locked Cutover and Safe CLI

Baseline: `6c776b4a8`

## Result

Status: DONE pending final commit metadata.

The cutover now exposes only named evidence options, validates them before mutation code, keeps preflight read-only, reclassifies and locks inside one SERIALIZABLE transaction, rechecks the complete evidence digest under those locks, performs the exact audited handoff atomically, and invokes only the official migrator after commit. No protected official workflow migration file was changed or invoked directly.

## RED Evidence

Tests were changed before production code.

- CLI RED: 5/9 failed because preflight/apply still passed positional arguments, digest mode emitted JSON, invalid format was accepted, and malformed SHA-256 was accepted.
- Service RED: 2/18 failed because object-form options were not implemented and malformed apply options reached positional `.trim()` handling instead of validation.
- Medium RED: six failure-stage cases and the two-worker case failed on the missing object API. Ten evidence-category relation writers already blocked; the eleventh exposed and corrected a test-only invalid column before production work.
- The positive unit fixture replaced empty shortcuts with all `BACKFILL_KINDS`, the complete fork migration list, every manifest table, non-empty workflow/plugin row digests, 1:1 checksum/mapping coverage, and a fresh bound storage checkpoint.

## Implementation

### Read-only preflight and complete report

- `preflight({ databaseBackupId, mediaSnapshotId })` validates non-blank IDs before repository access and preserves the exact supplied values.
- Repository preflight remains SELECT/catalog/file-provider reads only and returns installation class, classified official/legacy ledger, exact fork ledger, full catalog diff and table evidence, exact backfills, checksum/mapping coverage, non-empty workflow evidence, maintenance state, supported upstream version, and the latest exact matching storage checkpoint.
- Report digests are canonical SHA-256 hashes. Canonical JSON recursively sorts object keys.

### Lock hierarchy and atomic mutation

The apply hierarchy is:

1. validate the lowercase SHA-256 digest and both checkpoint IDs;
2. acquire `DatabaseLock.Migrations`;
3. open a SERIALIZABLE transaction;
4. classify `current-fork` versus `original-official` inside that transaction;
5. derive all relation locks from the selected catalog manifest, sort by schema/name, and acquire `SHARE ROW EXCLUSIVE` locks;
6. rerun all evidence with the exact checkpoint IDs, recompute the canonical digest, and reject drift;
7. alias the exact workflow marker when classified as `legacy-alias` without workflow DML/DDL;
8. audit then delete only exact generic legacy ledger rows;
9. disable the exact five remaining legacy triggers and delete the exact eleven remaining legacy migration overrides;
10. transition `ready -> inactive`, set `active=false` and schema version `2`;
11. write the checkpoint audit with report, installation, storage, and workflow evidence;
12. commit;
13. call only `runOfficialMigrations()`.

The complete manifest lock boundary was exercised with concurrent writers for official ledger, fork ledger, state, backfills, checksums, mappings, workflow data, storage run, storage byte evidence, maintenance metadata, and ordinary public table/catalog evidence.

### Rollback and post-commit boundary

Failure injection hooks exist after these six mutation stages:

- `workflow-alias`
- `legacy-ledger-audit`
- `legacy-ledger-delete`
- `legacy-artifact-shutdown`
- `state-transition`
- `checkpoint-audit`

Every injected failure restored exact ledger names/timestamps, workflow marker/catalog/non-empty rows, audit/checkpoint rows, legacy trigger enablement, legacy override rows, and complete state including phase/active/schema version.

The explicit post-commit PostgreSQL test proves an official migration failure leaves the handoff committed (`inactive`, schema version `2`), keeps the legacy row removed and checkpoint audit present, throws an error containing `checkpoint restore required`, and performs no reverse ledger mutation.

### CLI

- `immich-admin fork-schema-cutover preflight --format json|digest --database-backup-id <id> --media-snapshot-id <id>`
- `immich-admin fork-schema-cutover apply --report-digest <sha256> --database-backup-id <id> --media-snapshot-id <id>`

Only named options are accepted. Blank IDs, invalid format, positional compatibility arguments, absent digest, and non-lowercase/non-SHA-256 digest are rejected before service mutation entry. JSON output is one canonical parseable line. Digest output is exactly the 64-character digest and one newline.

## Rejected Task 9 Category Closure

1. **Fail-open/partial preflight evidence: CLOSED.** The complete fixture and exact report cover both installation classes, all ledgers, all manifest tables/catalog objects, every backfill kind, coverage, workflow evidence, and bound storage evidence. Unknown or incomplete evidence blocks.
2. **Unsafe workflow marker handling: CLOSED.** Only the exact audited SQL-equivalent legacy marker aliases; original-official is unchanged; workflow schema, overrides, trigger state, and non-empty row digests are preserved; rollback is proven.
3. **Premature sidecar read authority: CLOSED.** Preflight does not mutate authority. Public/legacy remains authoritative through `ready`; only the locked transaction transitions to `inactive`; activation remains return-reconciliation-only.
4. **Missing live storage-byte proof/freshness: CLOSED.** Exact backup/snapshot IDs select the latest completed run, require age at most one hour, and bind run ID/count/digest/current path/root evidence into both report and inner recheck.
5. **Incomplete ledger/backfill/table/catalog/checksum/mapping validation: CLOSED.** Exact sets, ordering, digests, counts, NULL failure handling, every manifest table, and unknown-object rejection are all exercised across Task 1-5/Task 8 regressions.
6. **Unsafe lock/rollback boundaries: CLOSED.** SERIALIZABLE plus deterministic manifest locks precede inner evidence; eleven writer categories block; two apply workers yield one commit; all six mutation stages roll back completely.
7. **CLI positional/shape mismatch: CLOSED.** Required named options and output formats are implemented and invalid shapes are rejected before service entry.
8. **Post-commit failure/reverse-ledger ambiguity: CLOSED.** Only `runOfficialMigrations()` runs after commit; failure requires checkpoint restore and never initiates reverse surgery.

## Verification

- Focused Task 5 unit: 27/27 passed.
- Focused Task 5 ledger/concurrency medium: 35/35 passed before the added post-commit case.
- Explicit post-commit failure: 1/1 passed.
- Expanded Task 1-5/startup/backup/CLI unit selection: 12 files, 210/210 passed.
- Complete fork-schema Task 1-5/Task 8 medium selection: 12 files, 184/184 passed.
- Catalog/manifest unit gate: 18/18 passed; tracked manifests have no diff.
- `pnpm --filter immich format`: passed.
- `pnpm --filter immich lint`: passed with zero warnings.
- `pnpm --filter immich check`: passed.
- `git diff --check`: passed.

The database-backed manifest generator was not rerun because `OFFICIAL_CATALOG_DATABASE_URL` and `FORK_CATALOG_DATABASE_URL` were not provided. No manifest inputs or outputs changed; the exact catalog/manifest suites and byte-clean manifest diff passed.

## GitNexus Safety

Pre-edit impact was attempted for every existing Task 5 symbol. The index predates the cutover service/CLI symbols, so those returned UNKNOWN. `DatabaseRepository` resolved CRITICAL with 330 impacted symbols, 21 direct callers, zero indexed processes, and one affected module; this was warned before production edits. No additional HIGH or CRITICAL symbol resolved.

Task-local compare against `6c776b4a8` reported LOW: 6 mapped symbols across 9 files, zero affected indexed flows. The mapped symbols are false-nearby methods plus the `DatabaseRepository` class because the stale index does not contain the new cutover members. Accumulated compare against `fork/main` remains HIGH: 248 mapped symbols across 166 files and 8 affected flows; this is the whole long-lived branch, not Task 5 scope. Exact staged detection reported LOW: 6 mapped symbols across the intended 11 files and zero affected indexed flows.

## Scope and Residual Concerns

- `AGENTS.md` and `CLAUDE.md` remain untracked and unstaged.
- No protected official workflow migration file was modified, imported, or manually invoked.
- No Unraid path was accessed.
- The external production-shaped clone and official-container certification remain Task 6 release gates; they are not replaced by these local synthetic and PostgreSQL gates.

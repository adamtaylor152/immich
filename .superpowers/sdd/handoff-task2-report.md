# Handoff Task 2 Report: Resumable Inactive Return Reconciliation

Baseline: `e1ff775d3cf5580f9f1abb8e20f4c18cedc97b4d`

## Outcome

- Added a distinct inactive return-reconciliation lifecycle that creates one running audit, initializes the exact seven backfill kinds from current official asset/album rows, and resumes completed progress after interruption.
- Added inactive-only, running-audit-gated batch claims while leaving the existing dual-write claim path and job transition behavior unchanged.
- Reused all registered privacy, album/closure, enrichment, config/automation, health/score/frame, checksum, and storage handlers synchronously while `active=false` and `phase=inactive`; this task never calls a phase transition or activation method.
- Preserved ordinary storage normalization in `dual-write`, `ready`, and `active`; `legacy`, `inactive`, and `failed` remain blocked. Inactive return work uses explicit APIs whose capability must exactly match the durable storage/checksum progress kind, claim token, claimed ID array, and target asset.
- Added one SERIALIZABLE archive-before-delete transaction for every orphan sidecar family. It writes deterministic `(sourceTable, sourceKey)` identities and canonical `row_to_json` payloads before FK-safe deletion, then rejects any remaining references to missing official assets/albums.
- Kept config non-authoritative during reconciliation and performed no workflow/plugin DML or DDL. Exact workflow/plugin row digests, schema digest/stage, and ledger evidence remain byte-equal before and after orphan cleanup and full handler reconciliation.

## TDD Evidence

Initial RED:

- Migration-service unit: 24 existing tests passed; 3 new tests failed specifically because `reconcileAfterOfficialReturn` did not exist.
- Return medium: 8 Task 1 tests passed; 3 new tests failed specifically because begin/resume, inactive claim, and archive/delete methods did not exist.
- The first archive implementation produced 15/16 rows; the regression exposed and corrected health cleanup order so orphan health is removed before candidates and empty runs.
- The real official-created-ID fixture first exposed both storage guards as dual-write-only, then reached the approved-root safety check. Production was widened only for the dedicated inactive/running-audit mode; the test root was rebound after service setup.
- A final exact-progress RED injected an unknown backfill kind and resolved instead of rejecting. Resume now locks and validates the exact seven-kind progress set before continuing.
- Review correction REDs proved three gaps: exact-PID orphan writers were not relation-fenced, an ambient running audit admitted ordinary storage APIs, and zero albums skipped config reconciliation.

GREEN:

- Focused migration-service unit: 27/27 passed.
- Return reconciliation PostgreSQL suite: 13/13 passed.
- Broad Task 1-5/startup/backup/fork unit selection: 13 files, 210/210 passed.
- Complete Task 1-5/Task 8/return PostgreSQL selection before the final exact-set case: 12 files, 168/168 passed; the final return suite then passed 13/13.
- Review correction migration-service unit: 27/27 passed.
- Review correction PostgreSQL suite: 45/45 passed, including 22 independent orphan predicates, the exact-backend-PID writer race, database/file config interruptions, exact return storage claims, and the six-phase ordinary storage matrix.
- Final fork-reference unit superset: 16 files, 279/279 passed.
- Final complete fork-schema PostgreSQL suite: 13 files, 229/229 passed.

## Independent Review Corrections

- One static 16-family orphan descriptor now drives archive, delete, and final verification. Deterministically sorted `SHARE ROW EXCLUSIVE` locks cover both public parents, the archive relation, and every sidecar until transaction commit.
- Config reconciliation runs once per durable return audit independently of album cardinality. Its count/digest/source evidence is stored in the audit, is interruption-safe before and after evidence persistence, and the config digest is bound into the final automation digest.
- Storage return authority is no longer ambient. Ordinary repository entry points retain their established phase matrix; dedicated return entry points require the exact durable claim on reserve, run, and release.

## Coverage and Constraints

- Interruption after a committed batch resumes at the next claim and does not reprocess the completed batch.
- Handler failures persist through `failBatch` without advancing progress and remain resumable.
- Official-created asset/album IDs receive default privacy, enrichment, album/closure, config, checksum, physical-file, and mapping state through the real registered handlers; storage reservations finish at zero.
- Orphan coverage includes privacy, album metadata/closure, enrichment, smart rules/matches/exclusions, health/candidates/runs, scores, duplicate frames, checksums, physical mappings/files, and reservations. Config remains present and is not treated as ID-owned orphan data.
- No active phase is entered. No workflow/provider migration is imported or manually invoked. No public-schema object or cross-schema foreign key is added.
- `AGENTS.md`, `CLAUDE.md`, and protected workflow migrations were not modified or staged. No Unraid path was accessed.

## Static and GitNexus Gates

- `pnpm --filter immich format`: passed.
- `pnpm --filter immich lint`: passed with zero warnings.
- `pnpm --filter immich check`: passed.
- `git diff --check`: passed.
- Pre-edit impact: `ForkSchemaRepository` CRITICAL (479 upstream, 20 direct); `claimBatch` LOW (4 upstream, 2 direct); `ForkSchemaMigrationService` MEDIUM (11 upstream, 5 direct); storage reservation LOW (5 upstream, 1 direct); locked normalization LOW (1 direct). The new Task 1 handoff repository was absent from the index.
- Pre-report exact worktree and baseline detection: LOW, 15 mapped symbols in 7 files, zero affected execution flows. New handoff/reconciliation methods and medium symbols are not yet represented in the stale index, so executable regressions are the controlling evidence for them.
- Post-review `detect_changes(scope=all)` reported LOW risk, 5 mapped changed symbols across 8 files, and zero affected flows; the stale index again mapped only established physical-file symbols.
- Final targeted Prettier, ESLint, TypeScript `--noEmit`, and `git diff --check` gates passed after all production and test edits.

## Repeat-Safety Re-review Corrections

- RED: successful zero-album database and file reconciliation reruns changed the automation digest and progress timestamp; the exact-PID storage race completed without entering a durable authority fence.
- Automation finalization now atomically stores raw automation digest, config digest, and their bound digest in the running audit. Exact bindings compare-and-no-op without touching progress bytes; malformed, mismatched, or tampered binding/progress evidence fails closed.
- Empty completed claim polling no longer rewrites `updatedAt`, so successful reruns preserve byte-identical audit, config, and automation progress evidence.
- Explicit return reserve, run, and release transactions hold locks on state, the running audit, and the exact progress-kind claim through commit. Validation still requires exact kind, token, ordered claimed IDs, and asset membership; the ordinary six-phase policy is unchanged.
- PostgreSQL evidence observes the completion writer's exact backend PID blocked behind the in-flight worker, then proves the old capability fails and the replacement capability succeeds after release.
- Focused migration unit: 27/27 passed. Full return reconciliation medium: 46/46 passed. Final fork-reference unit superset: 16 files, 279/279 passed. Final complete fork-schema medium suite: 13 files, 230/230 passed.
- Final targeted Prettier, ESLint, TypeScript `--noEmit`, cached/working-tree diff checks passed. GitNexus compare against `47d5a20d2` and exact staged detection both reported LOW mapped risk, 2 stale-index symbols across 4 files, and zero affected flows.

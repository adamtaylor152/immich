# Handoff Task 2 Report: Resumable Inactive Return Reconciliation

Baseline: `e1ff775d3cf5580f9f1abb8e20f4c18cedc97b4d`

## Outcome

- Added a distinct inactive return-reconciliation lifecycle that creates one running audit, initializes the exact seven backfill kinds from current official asset/album rows, and resumes completed progress after interruption.
- Added inactive-only, running-audit-gated batch claims while leaving the existing dual-write claim path and job transition behavior unchanged.
- Reused all registered privacy, album/closure, enrichment, config/automation, health/score/frame, checksum, and storage handlers synchronously while `active=false` and `phase=inactive`; this task never calls a phase transition or activation method.
- Allowed storage normalization reservation and commit only for ordinary dual-write or the dedicated inactive/running-audit mode. Inactive without that audit remains blocked.
- Added one SERIALIZABLE archive-before-delete transaction for every orphan sidecar family. It writes deterministic `(sourceTable, sourceKey)` identities and canonical `row_to_json` payloads before FK-safe deletion, then rejects any remaining references to missing official assets/albums.
- Kept config non-authoritative during reconciliation and performed no workflow/plugin DML or DDL. Exact workflow/plugin row digests, schema digest/stage, and ledger evidence remain byte-equal before and after orphan cleanup and full handler reconciliation.

## TDD Evidence

Initial RED:

- Migration-service unit: 24 existing tests passed; 3 new tests failed specifically because `reconcileAfterOfficialReturn` did not exist.
- Return medium: 8 Task 1 tests passed; 3 new tests failed specifically because begin/resume, inactive claim, and archive/delete methods did not exist.
- The first archive implementation produced 15/16 rows; the regression exposed and corrected health cleanup order so orphan health is removed before candidates and empty runs.
- The real official-created-ID fixture first exposed both storage guards as dual-write-only, then reached the approved-root safety check. Production was widened only for the dedicated inactive/running-audit mode; the test root was rebound after service setup.
- A final exact-progress RED injected an unknown backfill kind and resolved instead of rejecting. Resume now locks and validates the exact seven-kind progress set before continuing.

GREEN:

- Focused migration-service unit: 27/27 passed.
- Return reconciliation PostgreSQL suite: 13/13 passed.
- Broad Task 1-5/startup/backup/fork unit selection: 13 files, 210/210 passed.
- Complete Task 1-5/Task 8/return PostgreSQL selection before the final exact-set case: 12 files, 168/168 passed; the final return suite then passed 13/13.

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

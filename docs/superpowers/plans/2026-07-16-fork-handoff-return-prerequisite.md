# Official Handoff and Fork Return Prerequisite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved but missing official-handoff and resumable fork-return reconciliation commands required before two-origin container certification.

**Architecture:** Task 5 remains the only mutation path into official handoff. A new handoff service validates the committed checkpoint and exact certified tag, while return startup fails closed on unsupported official ledgers. Return reconciliation stays in `inactive`, archives/deletes orphan sidecars, reuses the existing backfill handlers through a distinct resumable inactive reconciliation mode, and changes `inactive -> active` only in one final locked transaction after exact verification.

**Tech Stack:** TypeScript, NestJS, nest-commander, Kysely, PostgreSQL 14, Vitest medium tests, existing fork migration/backfill repositories.

## Global Constraints

- Workflows remain ordinary upstream tables; return reconciliation performs no workflow/plugin DML or DDL.
- Supported return is the exact certified `v3.0.3` ledger from `supported-versions.json`; partial, extra, reordered, or unknown official ledgers fail before reconciliation.
- Both official and fork providers run through normal startup; the return command never imports or manually invokes protected official workflow migrations.
- Reconciliation reads remain inactive and fork sidecars remain non-authoritative until the final transaction.
- Maintenance mode is mandatory for prepare-official and prepare-fork.
- Orphan sidecars are archived in `immich_fork.orphaned_records` before deletion.
- Reconciliation is resumable through existing `backfill_progress`; rerunning `prepare-fork` resumes rather than discards completed batches.
- No cross-schema foreign keys and no new public-schema objects.
- Use `apply_patch`; never stage `AGENTS.md`, `CLAUDE.md`, or protected workflow migrations.

---

### Task 1: Certified Return Startup Guard and Handoff Evidence

**Files:**

- Create: `server/src/repositories/fork-handoff.repository.ts`
- Create: `server/src/repositories/fork-handoff.repository.spec.ts`
- Modify: `server/src/repositories/index.ts`
- Modify: `server/src/repositories/database.repository.ts`
- Modify: `server/src/services/database.service.ts`
- Modify: `server/src/services/database.service.spec.ts`
- Modify: `server/src/services/database-backup.service.ts`
- Modify: `server/src/services/database-backup.service.spec.ts`
- Test: `server/test/medium/specs/fork-schema/return-reconciliation.spec.ts`

**Interfaces:**

- Produces: `ForkReturnEvidence`
- Produces: `ForkHandoffRepository.getReturnEvidence(kysely?): Promise<ForkReturnEvidence>`
- Produces: `ForkHandoffRepository.assertCertifiedReturnLedger(kysely?): Promise<'v3.0.3'>`
- Produces: `ForkHandoffRepository.getOfficialHandoffCheckpoint(): Promise<OfficialHandoffCheckpoint>`

- [ ] **Step 1: Write failing exact-ledger and startup tests**

```ts
it.each(['missing', 'extra', 'reordered', 'partial'])(
  'rejects an %s official return ledger before migration',
  async (mutation) => {
    await mutateOfficialLedger(db, mutation);
    await expect(repository.assertCertifiedReturnLedger()).rejects.toThrow(/certified v3\.0\.3 ledger/);
  },
);

it('accepts exact v3.0.3 only while inactive at schema version 2 in maintenance mode', async () => {
  expect(await repository.getReturnEvidence()).toMatchObject({
    active: false,
    maintenanceMode: true,
    phase: 'inactive',
    schemaVersion: '2',
    supportedTag: 'v3.0.3',
  });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.mjs --run src/repositories/fork-handoff.repository.spec.ts src/services/database.service.spec.ts src/services/database-backup.service.spec.ts --pool=forks --maxWorkers=1
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/fork-schema/return-reconciliation.spec.ts --pool=forks --maxWorkers=1
```

Expected: FAIL because the handoff repository/startup guard does not exist.

- [ ] **Step 3: Implement exact evidence**

```ts
export type ForkReturnEvidence = {
  active: boolean;
  appliedCheckpointId: string;
  maintenanceMode: boolean;
  phase: ForkSchemaPhase;
  schemaVersion: string;
  supportedTag: 'v3.0.3';
  officialLedgerDigest: string;
  reconciliationStatus: 'not-started' | 'running' | 'failed' | 'complete';
};

async assertCertifiedReturnLedger(kysely = this.db): Promise<'v3.0.3'> {
  const names = await getTimestampOrderedPublicLedger(kysely);
  if (!arraysEqual(names, supportedVersions.upstreamMigrations)) {
    throw new Error('Fork return requires the exact certified v3.0.3 ledger');
  }
  return 'v3.0.3';
}
```

The evidence query also requires maintenance mode, `inactive`, `active=false`, `schemaVersion='2'`, and one applied `official-cutover-checkpoint` audit row.

- [ ] **Step 4: Guard startup before official/fork providers**

When isolated state is `inactive` at schema version 2, `DatabaseService` and restore migration flow call `assertCertifiedReturnLedger()` before `runOfficialMigrations()`. Other fresh/legacy/active startup modes retain existing behavior.

- [ ] **Step 5: Run GREEN and commit**

Run the RED commands plus startup/backup migration-mode suites.

Commit:

```bash
git add server/src/repositories server/src/services server/test/medium/specs/fork-schema/return-reconciliation.spec.ts
git commit -m "fix(server): guard certified fork return startup"
```

---

### Task 2: Resumable Inactive Return Reconciliation

**Files:**

- Modify: `server/src/repositories/fork-schema.repository.ts`
- Modify: `server/src/repositories/fork-schema.repository.mock.ts`
- Modify: `server/src/repositories/fork-handoff.repository.ts`
- Modify: `server/src/services/fork-schema-migration.service.ts`
- Modify: `server/src/services/fork-schema-migration.service.spec.ts`
- Test: `server/test/medium/specs/fork-schema/return-reconciliation.spec.ts`

**Interfaces:**

- Produces: `ForkSchemaRepository.beginOrResumeReturnReconciliation(): Promise<void>`
- Produces: `ForkSchemaRepository.claimReturnBatch(kind, size): Promise<BackfillClaim | null>`
- Produces: `ForkHandoffRepository.archiveAndDeleteOrphans(kysely?): Promise<OrphanArchiveSummary>`
- Produces: `ForkSchemaMigrationService.reconcileAfterOfficialReturn(batchSize, hooks?): Promise<ForkSchemaMigrationStatus>`

- [ ] **Step 1: Add interruption/orphan/default RED tests**

```ts
it('resumes inactive reconciliation after interruption without reprocessing completed batches', async () => {
  await expect(service.reconcileAfterOfficialReturn(1, { afterBatch: failOnce })).rejects.toThrow('injected');
  const before = await repository.getProgress();
  await service.reconcileAfterOfficialReturn(1);
  expect(await repository.getProgress()).toEqual(expectCompletedProgress());
  expect(before.some(({ processed }) => processed > 0)).toBe(true);
});

it('archives deleted upstream IDs and seeds defaults for official-created IDs', async () => {
  await seedDeletedSidecarsAndNewOfficialRows(db);
  await service.reconcileAfterOfficialReturn(10);
  expect(await orphanRows(db)).toEqual(expect.arrayContaining(expectedArchivedRows));
  expect(await sidecarRowsForNewIds(db)).toEqual(expectedDefaults);
});
```

Cover every fork table family: privacy, albums/closure, enrichment, config, smart rules/matches/exclusions, health/candidates/runs, scores, duplicate frames, checksum, physical mapping/files/reservations. Workflow/plugin tables are snapshot-asserted unchanged.

- [ ] **Step 2: Run RED**

Run migration-service units and return-reconciliation medium test. Expected: FAIL because inactive reconciliation cannot claim batches or archive orphans.

- [ ] **Step 3: Implement a distinct inactive claim mode**

```ts
async claimReturnBatch(kind: BackfillKind, size: number): Promise<BackfillClaim | null> {
  return this.claimBatchForMode(kind, size, {
    phase: 'inactive',
    requiredAudit: 'fork-return-reconciliation',
  });
}
```

`beginOrResumeReturnReconciliation()` creates or resumes a running audit row and initializes exact `BACKFILL_KINDS` progress from current public assets/albums without changing phase. Existing dual-write claims remain unchanged.

- [ ] **Step 4: Implement archive-before-delete**

`archiveAndDeleteOrphans()` runs in a serializable transaction, inserts canonical `row_to_json` payloads into `orphaned_records` with deterministic `sourceTable/sourceKey`, then deletes dependent rows in FK-safe order. It verifies zero remaining references to missing public assets/albums before commit.

- [ ] **Step 5: Reuse handlers while inactive**

`reconcileAfterOfficialReturn()` uses the already registered handlers with `claimReturnBatch`, persists progress per batch, resumes after interruption, and never calls `transitionPhase`. Config is read from public upstream state because `inactive` does not overlay fork config.

- [ ] **Step 6: Run GREEN and commit**

Run migration-service units plus return-reconciliation, privacy/album, enrichment/config/smart, health/score/frame, and checksum/storage medium suites.

Commit:

```bash
git add server/src/repositories server/src/services server/test/medium/specs/fork-schema
git commit -m "feat(server): reconcile fork sidecars after official use"
```

---

### Task 3: Atomic Activation and Operator Commands

**Files:**

- Create: `server/src/services/fork-handoff.service.ts`
- Create: `server/src/services/fork-handoff.service.spec.ts`
- Create: `server/src/commands/fork-handoff.command.ts`
- Create: `server/src/commands/fork-handoff.command.spec.ts`
- Modify: `server/src/commands/index.ts`
- Modify: `server/src/services/index.ts`
- Modify: `server/src/repositories/fork-handoff.repository.ts`
- Test: `server/test/medium/specs/fork-schema/return-reconciliation.spec.ts`

**Interfaces:**

- Produces: `ForkHandoffService.prepareOfficial(): Promise<OfficialHandoffCheckpoint>`
- Produces: `ForkHandoffService.prepareFork(options: { batchSize: number }): Promise<ReconciliationReport>`
- Produces CLI: `immich-admin fork-handoff prepare-official`
- Produces CLI: `immich-admin fork-handoff prepare-fork --batch-size <positive integer>`

- [ ] **Step 1: Add command/final-transaction RED tests**

```ts
it('activates only in the final verified transaction', async () => {
  await seedExactOfficialReturnFixture(db);
  const report = await service.prepareFork({ batchSize: 1 });
  expect(report).toMatchObject({ active: true, phase: 'active', supportedTag: 'v3.0.3' });
  expect(await state(db)).toMatchObject({ active: true, phase: 'active' });
});

it('rolls back activation when final verification drifts', async () => {
  await expect(service.prepareFork({ batchSize: 1 }, { beforeActivate: injectDrift })).rejects.toThrow();
  expect(await state(db)).toMatchObject({ active: false, phase: 'inactive' });
});
```

- [ ] **Step 2: Run RED**

Run handoff service/CLI units and return medium suite. Expected: FAIL because service/commands do not exist.

- [ ] **Step 3: Implement prepare-official**

`prepareOfficial()` is read-only. It requires maintenance mode, the applied Task 5 checkpoint, inactive/schema version 2, and a fresh bound storage checkpoint. It returns the exact image `ghcr.io/immich-app/immich-server:v3.0.3` plus checkpoint IDs/digests and never starts Docker.

- [ ] **Step 4: Implement final activation**

`prepareFork()` validates exact return evidence, archives orphans, resumes all batches, then acquires `DatabaseLock.Migrations` and runs one serializable final transaction. The transaction locks state/progress/audit and manifest tables, revalidates exact official ledger, zero orphans, exact completed backfills/digests, and workflow row/catalog snapshot, writes an applied return audit, then calls the repository’s reconciliation-only `inactive -> active` mutation.

- [ ] **Step 5: Implement commands**

Commands print canonical one-line JSON. `prepare-fork` rejects invalid batch size before invoking service. No positional compatibility aliases.

- [ ] **Step 6: Run complete gates and commit**

Run all new units/medium, Task 1–5/Task 8 regressions, startup/backup, check/lint/format/diff, GitNexus compare/staged.

Commit:

```bash
git add server/src server/test/medium/specs/fork-schema/return-reconciliation.spec.ts
git commit -m "feat(server): support official handoff and fork return"
```

**Review gate:** Independent reviewer must verify unsupported official ledgers fail before provider execution, workflows are unchanged, every sidecar family reconciles or archives, interruption resumes, maintenance is required, and activation occurs only in the final transaction.

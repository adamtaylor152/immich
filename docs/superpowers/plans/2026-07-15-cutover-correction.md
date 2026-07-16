# Upstream-Compatible Cutover Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rejected ledger cutover with a fail-closed implementation that aliases the SQL-equivalent workflow migration without changing workflow data, preserves original-Immich installations, and proves complete database and media compatibility before official handoff.

**Architecture:** Keep legacy public fields authoritative through backfill readiness, then perform a single maintenance-window cutover that revalidates immutable evidence under locks, aliases the workflow ledger when and only when the legacy marker and exact official-equivalent schema agree, records the fork-v2 checkpoint, and invokes the unchanged official migrator after commit. Large media verification runs beforehand as a resumable checkpoint whose snapshot identity and aggregate digest are bound into the cutover report.

**Tech Stack:** TypeScript, NestJS, Kysely, PostgreSQL 14, Vitest, Testcontainers, nest-commander, Node filesystem and crypto APIs, official Immich `v3.0.3` container.

## Global Constraints

- Never edit, reorder, rename, or manually invoke a released official migration.
- `public.kysely_migrations` remains owned by original Immich; ledger surgery is exact, allowlisted, audited, locked, and transactional.
- `immich_fork.migrations` must remain an exact ordered provider-backed ledger; do not insert a virtual migration name.
- Workflow/plugin rows and tables are never modified by the workflow alias.
- Original-Immich installations containing `1778614946174-UpdateWorkflowTables` never execute the alias branch.
- Current-fork installations containing `1779400000000-UpdateWorkflowTables` alias only that name to `1778614946174-UpdateWorkflowTables` after exact schema and row evidence is locked.
- Both markers, neither marker with existing workflow tables, marker/schema disagreement, or unknown catalog objects fail closed.
- Legacy public fields remain authoritative through `ready`; sidecars become authoritative only after explicit fork activation.
- Cutover requires maintenance mode, no active writes, a verified backup, a complete fresh storage checkpoint, and an exact preflight digest.
- A failure before checkpoint commit rolls back. A failure in the unchanged official migrator after commit requires checkpoint restore.
- Existing fork users and original-Immich-to-fork users are separate mandatory test fixtures.
- Do not proceed to production ledger cutover until the production-shaped clone, interrupted-backfill, media-snapshot, and official-container release gates pass.

---

### Task 1: Exact Workflow Compatibility Classification and Ledger Alias

**Files:**

- Create: `server/src/fork-schema/workflow-compatibility.ts`
- Create: `server/src/fork-schema/workflow-compatibility.spec.ts`
- Create: `server/test/medium/specs/fork-schema/workflow-ledger-alias.spec.ts`
- Modify: `server/src/fork-schema/migration-manifest.ts`
- Modify: `server/src/repositories/database.repository.ts`
- Modify: `server/src/services/fork-schema-cutover.service.ts`

**Interfaces:**

- Produces: `LEGACY_WORKFLOW_MIGRATION = '1779400000000-UpdateWorkflowTables'`
- Produces: `OFFICIAL_WORKFLOW_MIGRATION = '1778614946174-UpdateWorkflowTables'`
- Produces: `classifyWorkflowCompatibility(evidence): WorkflowCompatibility`
- Produces: `WorkflowCompatibility = { mode: 'official' | 'legacy-alias'; timestamp: string; schemaDigest: string; rowDigests: WorkflowRowDigest[] }`
- Produces: `aliasLegacyWorkflowMigration(transaction, evidence, reportDigest): Promise<void>`

- [ ] **Step 1: Add failing pure-classifier tests**

```ts
it.each([
  { official: true, legacy: true, error: 'both workflow migration markers' },
  { official: false, legacy: false, error: 'no workflow migration marker' },
  { official: false, legacy: true, schema: 'mismatch', error: 'workflow schema fingerprint' },
  { official: true, legacy: false, schema: 'post-update', later: ['templates-without-ledger'], error: 'workflow ledger/schema disagreement' },
])('fails closed for $error', ({ official, legacy, schema = 'post-update', later = [], error }) => {
  expect(() => classifyWorkflowCompatibility(fixture({ official, legacy, schema, later }))).toThrow(error);
});

it('classifies original Immich without requesting an alias', () => {
  expect(classifyWorkflowCompatibility(fixture({ official: true, legacy: false }))).toMatchObject({ mode: 'official' });
});

it('classifies the SQL-equivalent fork marker as an alias', () => {
  expect(classifyWorkflowCompatibility(fixture({ official: false, legacy: true }))).toMatchObject({
    mode: 'legacy-alias',
    timestamp: '2026-07-15T00:00:00.000Z',
  });
});
```

- [ ] **Step 2: Run the classifier test and verify RED**

Run: `pnpm --filter immich exec vitest --config test/vitest.config.mjs --run src/fork-schema/workflow-compatibility.spec.ts --pool=forks --maxWorkers=1`

Expected: FAIL because the compatibility module does not exist.

- [ ] **Step 3: Implement exact constants and classifier**

```ts
export const LEGACY_WORKFLOW_MIGRATION = '1779400000000-UpdateWorkflowTables';
export const OFFICIAL_WORKFLOW_MIGRATION = '1778614946174-UpdateWorkflowTables';

export function classifyWorkflowCompatibility(evidence: WorkflowCompatibilityEvidence): WorkflowCompatibility {
  const legacy = evidence.ledger.find(({ name }) => name === LEGACY_WORKFLOW_MIGRATION);
  const official = evidence.ledger.find(({ name }) => name === OFFICIAL_WORKFLOW_MIGRATION);
  if (legacy && official) throw new Error('Found both workflow migration markers');
  if (!legacy && !official) throw new Error('Found workflow tables with no workflow migration marker');
  const expectedStage = stageFromLedger(evidence.ledger);
  if (evidence.schemaStage !== expectedStage) throw new Error('Workflow ledger/schema disagreement');
  if (evidence.schemaDigest !== WORKFLOW_SCHEMA_DIGESTS[expectedStage]) {
    throw new Error('Unexpected workflow schema fingerprint');
  }
  return {
    mode: legacy ? 'legacy-alias' : 'official',
    timestamp: (legacy ?? official)!.timestamp,
    schemaDigest: evidence.schemaDigest,
    rowDigests: evidence.rowDigests,
  };
}
```

The accepted stages are exactly `post-update`, `post-plugin-templates`, and `post-allowed-hosts`; each later stage requires its matching official ledger row.

- [ ] **Step 4: Add failing PostgreSQL no-loss tests**

Seed non-empty `plugin`, `plugin_method`, `workflow`, and `workflow_step` tables. Capture catalog digest, per-table count/digest, and migration timestamp. Test:

```ts
it('aliases a current-fork workflow marker without touching schema or rows', async () => {
  const before = await workflowEvidence(db);
  await repository.aliasLegacyWorkflowMigration(trx, before.compatibility, reportDigest);
  const after = await workflowEvidence(db);
  expect(after.schemaDigest).toBe(before.schemaDigest);
  expect(after.rowDigests).toEqual(before.rowDigests);
  expect(after.ledger).toContainEqual({ name: OFFICIAL_WORKFLOW_MIGRATION, timestamp: before.marker.timestamp });
  expect(after.ledger).not.toContainEqual(expect.objectContaining({ name: LEGACY_WORKFLOW_MIGRATION }));
});

it('leaves an original-Immich workflow ledger and rows byte-equivalent', async () => {
  const before = await workflowEvidence(db);
  await applyCutoverForOfficialFixture();
  expect(await workflowEvidence(db)).toEqual(before);
});
```

Also fail after deleting the legacy marker and prove ledger, audit, schema, and all seeded rows roll back.

- [ ] **Step 5: Implement catalog and row evidence**

Use `pg_catalog` to canonicalize every workflow/plugin table, column, type, nullability, default, constraint, index, trigger, and migration override. Hash sorted canonical JSON with SHA-256. Hash every table as sorted `row_to_json` text and retain exact counts. Lock `public.kysely_migrations`, `plugin`, `plugin_method`, `workflow`, and `workflow_step` before the apply-time read.

- [ ] **Step 6: Implement the exact alias in the cutover transaction**

```ts
if (compatibility.mode === 'legacy-alias') {
  await auditWorkflowAlias(transaction, compatibility, reportDigest);
  await sql`DELETE FROM public.kysely_migrations WHERE name = ${LEGACY_WORKFLOW_MIGRATION}`.execute(transaction);
  await sql`
    INSERT INTO public.kysely_migrations (name, timestamp)
    VALUES (${OFFICIAL_WORKFLOW_MIGRATION}, ${compatibility.timestamp})
  `.execute(transaction);
  const after = await getWorkflowCompatibilityEvidence(transaction);
  assertWorkflowEvidenceUnchanged(compatibility, after);
}
```

Remove `LEGACY_WORKFLOW_MIGRATION` from the generic legacy-deletion loop so it can only pass through this alias path.

- [ ] **Step 7: Run gates and commit**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.mjs --run src/fork-schema/workflow-compatibility.spec.ts src/services/fork-schema-cutover.service.spec.ts --pool=forks --maxWorkers=1
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/fork-schema/workflow-ledger-alias.spec.ts --pool=forks --maxWorkers=1
pnpm --filter immich check
```

Expected: PASS, with non-empty original and current-fork workflow fixtures retaining identical row digests.

Commit: `fix(server): preserve workflows through official ledger alias`

---

### Task 2: Rollback-Safe Authority Phases

**Files:**

- Create: `server/src/fork-schema/authority.ts`
- Create: `server/src/fork-schema/authority.spec.ts`
- Modify: `server/src/repositories/fork-schema.repository.ts`
- Modify: `server/src/repositories/fork-privacy.repository.ts`
- Modify: `server/src/repositories/fork-album-metadata.repository.ts`
- Modify: `server/src/repositories/fork-enrichment.repository.ts`
- Modify: `server/src/repositories/fork-config.repository.ts`
- Modify: `server/src/repositories/smart-album.repository.ts`
- Modify: `server/src/services/fork-schema-migration.service.ts`
- Test: `server/test/medium/specs/fork-schema/authority-cutover.spec.ts`

**Interfaces:**

- Produces: `isLegacyAuthoritative(phase: ForkSchemaPhase): boolean`
- Produces: `isForkAuthoritative(phase: ForkSchemaPhase): boolean`
- Produces: locked transition `ready -> inactive` during official cutover and `inactive -> active` after return reconciliation.

- [ ] **Step 1: Write failing authority tests**

```ts
it.each(['legacy', 'dual-write', 'ready'] as const)('keeps legacy reads authoritative in %s', (phase) => {
  expect(isLegacyAuthoritative(phase)).toBe(true);
  expect(isForkAuthoritative(phase)).toBe(false);
});

it('makes sidecars authoritative only when active', () => {
  expect(isForkAuthoritative('active')).toBe(true);
  expect(isLegacyAuthoritative('inactive')).toBe(false);
});
```

The medium test writes after reaching `ready`, reads through the legacy projection, deploys the previous-fork fixture, and proves the write is visible there.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter immich exec vitest --config test/vitest.config.mjs --run src/fork-schema/authority.spec.ts --pool=forks --maxWorkers=1`

Expected: FAIL because `ready` currently selects sidecars.

- [ ] **Step 3: Implement one central phase policy**

```ts
export const isLegacyAuthoritative = (phase: ForkSchemaPhase) =>
  phase === 'legacy' || phase === 'dual-write' || phase === 'ready';

export const isForkAuthoritative = (phase: ForkSchemaPhase) => phase === 'active';
```

Replace every local `phase !== 'legacy' && phase !== 'dual-write'` decision with the central helper. Keep dual writes enabled in `dual-write` and `ready`. `inactive` must not overlay fork configuration or expose fork-only results.

- [ ] **Step 4: Make the cutover transition atomic**

The locked cutover transaction changes `ready -> inactive`, sets `active = false`, disables remaining fork triggers, and records the checkpoint. No earlier coordinator action changes read authority. Return reconciliation alone changes `inactive -> active`.

- [ ] **Step 5: Run phase and feature regressions**

Run unit suites for privacy, albums, enrichment, configuration, smart albums, physical deduplication, and fork migration coordination plus `authority-cutover.spec.ts` in the medium environment.

Expected: PASS with legacy reads through `ready`, no fork overlays in `inactive`, and sidecars in `active`.

Commit: `fix(server): switch fork authority only at locked cutover`

---

### Task 3: Complete Database Evidence and Catalog Manifests

**Files:**

- Create: `server/src/fork-schema/catalog.ts`
- Create: `server/src/fork-schema/catalog.spec.ts`
- Create: `server/src/fork-schema/manifests/v3.0.3-public-catalog.json`
- Create: `server/src/fork-schema/manifests/fork-v2-catalog.json`
- Create: `server/scripts/generate-fork-schema-catalog.ts`
- Modify: `server/src/repositories/database.repository.ts`
- Modify: `server/src/services/fork-schema-cutover.service.ts`
- Test: `server/test/medium/specs/fork-schema/cutover-evidence.spec.ts`

**Interfaces:**

- Produces: `CatalogManifest`, `CatalogDiff`, `getCatalogEvidence(runner)`
- Produces: exact `backfillKindsValid`, `forkLedgerValid`, `checksumCoverage`, `mappingCoverage`, and `tableEvidence`.

- [ ] **Step 1: Add fail-closed evidence tests**

Test each condition independently:

```ts
it.each([
  'missing backfill kind',
  'unknown backfill kind',
  'active claim',
  'invalid final digest',
  'missing checksum sidecar',
  'missing physical mapping',
  'unknown fork migration',
  'missing fork migration',
  'unknown public table',
  'unknown public column',
  'unknown trigger',
  'unknown constraint',
  'unknown index',
])('refuses %s', async (mutation) => {
  await mutateFixture(mutation);
  expect((await service.preflight()).ready).toBe(false);
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/fork-schema/cutover-evidence.spec.ts --pool=forks --maxWorkers=1`

Expected: FAIL because current evidence is partial and pattern-based.

- [ ] **Step 3: Generate exact manifests**

The generator connects to two disposable databases: one migrated by exact tag `v3.0.3`, and one migrated by the fork provider. It emits sorted JSON containing schemas, tables, columns, enums, constraints, indexes, functions, triggers, and migration overrides. Run:

```bash
pnpm --filter immich exec tsx scripts/generate-fork-schema-catalog.ts --official-tag v3.0.3 --out src/fork-schema/manifests
git diff --exit-code -- server/src/fork-schema/manifests || true
```

The generated files contain no timestamps or environment-specific OIDs. CI regenerates and requires a clean diff.

- [ ] **Step 4: Require exact backfill and fork-ledger sets**

```ts
const kinds = new Set(evidence.backfills.map(({ kind }) => kind));
if (kinds.size !== BACKFILL_KINDS.length || BACKFILL_KINDS.some((kind) => !kinds.has(kind))) {
  blockers.push('Backfill progress does not contain the exact required kind set');
}
for (const row of evidence.backfills) {
  if (row.remaining !== 0 || row.lastError || row.claimToken || row.claimedIds.length > 0 || !SHA256.test(row.digest ?? '')) {
    blockers.push(`Backfill ${row.kind} is not durably complete`);
  }
}
```

Load the fork provider, require the ledger to be its exact ordered applied set, and reject names absent from the provider. Represent fork-v2 cutover through `state.schemaVersion = '2'` plus an audit checkpoint row; do not add a provider-absent ledger entry.

- [ ] **Step 5: Require complete asset coverage**

Checksum coverage requires one valid `asset_checksum` row for every applicable public asset. Mapping coverage requires every normalized asset to have an upstream-readable path and forbids any public physical reference. Count and digest both sides; SQL NULLs count as failures.

- [ ] **Step 6: Digest and lock every fork table**

Include `state`, `migration_audit`, `backfill_progress`, `orphaned_records`, `asset_health_run`, `asset_health_candidate`, `asset_storage_reservation`, and every other table in the generated fork manifest. The apply transaction derives its table locks from that same manifest; there is no separately maintained partial constant.

- [ ] **Step 7: Compare full catalogs**

Classify the installation first, then compare its entire public and `immich_fork` catalogs with the matching manifest plus the explicit inert-legacy allowlist. Any unclassified object is a blocker. Remove all prefix-based residue queries.

- [ ] **Step 8: Run gates and commit**

Run catalog unit tests, `cutover-evidence.spec.ts`, migration-ledger medium tests, `pnpm --filter immich check`, lint, formatting, and manifest regeneration.

Commit: `fix(server): require complete cutover database evidence`

---

### Task 4: Fresh Resumable Storage Verification Checkpoint

**Files:**

- Create: `server/src/fork-schema/migrations/0000000000050-CutoverVerification.ts`
- Create: `server/src/repositories/fork-cutover-verification.repository.ts`
- Create: `server/src/services/fork-cutover-verification.service.ts`
- Create: `server/src/services/fork-cutover-verification.service.spec.ts`
- Create: `server/src/commands/fork-cutover-verification.command.ts`
- Modify: `server/src/commands/index.ts`
- Modify: `server/src/repositories/index.ts`
- Modify: `server/src/services/index.ts`
- Modify: `server/src/repositories/database.repository.ts`
- Test: `server/test/medium/specs/fork-schema/storage-cutover-verification.spec.ts`

**Interfaces:**

- Produces CLI: `immich-admin fork-schema-cutover verify-storage start|resume|status --database-backup-id <id> --media-snapshot-id <id>`
- Produces: `start(databaseBackupId, snapshotId): Promise<StorageVerificationRun>`
- Produces: `resume(runId, batchSize): Promise<StorageVerificationRun>`
- Produces: a complete run digest bound to snapshot ID, asset count, paths, size, SHA-1, SHA-256, device/inode/link evidence, and completion time.

- [ ] **Step 1: Write failing interruption and corruption tests**

Create assets with distinct files, hardlinks, reflinks where supported, a missing path, a symlink escape, changed bytes after Task 8, and shared bytes. Assert batching resumes without reaccepting stale evidence and that any unreadable/corrupt path prevents completion.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/fork-schema/storage-cutover-verification.spec.ts --pool=forks --maxWorkers=1`

Expected: FAIL because verification runs do not exist.

- [ ] **Step 3: Add fork-owned verification tables**

Create `cutover_verification_run` and `cutover_verification_asset` under `immich_fork`, with no cross-schema foreign keys. Runs store `databaseBackupId`, `snapshotId`, `status`, `cursor`, counts, aggregate digest, failure, and timestamps. Asset rows store logical asset ID and immutable verification evidence. Both operator-supplied identifiers are non-empty, immutable after run creation, and included in every status response.

- [ ] **Step 4: Reuse Task 8 filesystem proof**

Extract or reuse the root-safe regular-file, readability, hash, size, and inode/link verification primitives. Never infer success from the Task 8 database sidecars alone. Each batch locks its run, verifies current bytes, records canonical evidence, and advances its cursor atomically.

- [ ] **Step 5: Complete with a canonical aggregate**

```ts
const digest = sha256(
  rows
    .toSorted((a, b) => a.assetId.localeCompare(b.assetId))
    .map(({ assetId, path, size, sha1, sha256, device, inode, links }) =>
      JSON.stringify({ assetId, path, size, sha1, sha256, device, inode, links }),
    )
    .join('\n'),
);
```

Completion requires verified row count equal to the locked applicable asset count and zero failures.

- [ ] **Step 6: Bind freshness into preflight**

Preflight requires the latest complete run, exact operator-supplied database backup and media snapshot IDs, and completion within one hour. It includes the run ID, both checkpoint IDs, count, digest, and completion timestamp in the report digest. Apply rechecks the row and rejects changed checkpoint IDs, asset count, or digest.

- [ ] **Step 7: Run gates and commit**

Run service unit tests, storage medium tests, Task 8 checksum/storage suites, typecheck, lint, and formatting.

Commit: `feat(server): verify media snapshot before cutover`

---

### Task 5: Rebuild the Locked Cutover and Safe CLI

**Files:**

- Modify: `server/src/services/fork-schema-cutover.service.ts`
- Modify: `server/src/services/fork-schema-cutover.service.spec.ts`
- Modify: `server/src/commands/fork-schema-cutover.command.ts`
- Modify: `server/src/repositories/database.repository.ts`
- Modify: `server/test/medium/specs/fork-schema/ledger-cutover.spec.ts`
- Create: `server/test/medium/specs/fork-schema/cutover-concurrency.spec.ts`

**Interfaces:**

- Produces CLI: `immich-admin fork-schema-cutover preflight --format json|digest --database-backup-id <id> --media-snapshot-id <id>`
- Produces CLI: `immich-admin fork-schema-cutover apply --report-digest <sha256> --database-backup-id <id> --media-snapshot-id <id>`
- Produces: `preflight(options): Promise<CutoverReport>`
- Produces: `apply(options): Promise<HandoffCheckpoint>`

- [ ] **Step 1: Replace permissive tests with the complete contract**

Delete the empty-backfill ready fixture. Seed exact backfill rows, exact fork ledger, complete sidecars, a complete storage run, maintenance mode, and both workflow installation classes. Test digest drift, concurrent writes, lock ordering, alias rollback, unknown catalogs, and post-commit official migration failure.

- [ ] **Step 2: Verify RED against the rejected Task 9 implementation**

Run the cutover service unit suite plus ledger and concurrency medium suites.

Expected: FAIL on the incomplete report, phase, CLI, and lock behavior.

- [ ] **Step 3: Keep preflight strictly read-only**

`preflight()` performs SELECT/catalog reads only. It returns installation class, exact ledger classifications, complete catalog/table evidence, exact backfill status, asset coverage, workflow evidence, storage checkpoint, supported official tag, blockers, and a canonical SHA-256 digest.

- [ ] **Step 4: Apply under one lock hierarchy**

Acquire `DatabaseLock.Migrations`, begin a serializable transaction, lock manifest-derived tables in deterministic schema/name order, then re-run all evidence inside that transaction. Refuse digest drift before mutation. Perform workflow alias, generic allowlisted legacy audit/deletion, trigger shutdown, `ready -> inactive`, state schema version 2, and checkpoint audit atomically.

- [ ] **Step 5: Preserve the rollback boundary**

Inject failures after every mutation stage and assert the original ledger, workflow marker, audit, triggers, phase, and checkpoint all roll back. After commit, invoke only `runOfficialMigrations()`; wrap failure with `checkpoint restore required` and never attempt reverse ledger surgery.

- [ ] **Step 6: Implement named CLI options**

Use nest-commander options rather than positional parameters. `--format digest` prints only the digest plus newline. `apply` requires all three named evidence options and refuses malformed SHA-256, an absent backup ID, or an absent snapshot ID before connecting to mutation code.

- [ ] **Step 7: Run complete Task 9 gates and commit**

Run all fork-schema unit/medium suites serially, database repository tests, startup/backup migration-mode tests, `pnpm --filter immich check`, targeted lint/format, and `git diff --check`.

Commit: `fix(server): make legacy ledger cutover fail closed`

**Review gate:** Regenerate one frozen review package from `8c321d1d4` through this commit. The reviewer must explicitly close every finding from the rejected `655e6ee47` Task 9 review before Task 10 resumes.

---

### Task 6: Two-Origin and Official-Container Certification

**Files:**

- Create: `e2e/src/specs/server/fork-schema-origin-upgrade.e2e-spec.ts`
- Create: `e2e/src/specs/server/fork-schema-current-fork-cutover.e2e-spec.ts`
- Modify: `e2e/src/specs/server/fork-schema-roundtrip.e2e-spec.ts`
- Modify: `scripts/test-fork-roundtrip.sh`
- Modify: `.github/workflows/fork-roundtrip.yml`
- Modify: `docs/administration/upstream-handoff.md`
- Modify: `docs/superpowers/plans/2026-07-15-upstream-reversion-compatible-fork-schema.md`

**Interfaces:**

- Produces CI lanes `origin-v3.0.3-to-fork`, `current-fork-to-official-v3.0.3`, and `official-v3.0.3-to-fork-return`.
- Consumes exact image tag `v3.0.3` from `supported-versions.json`.

- [x] **Step 1: Add an original-Immich non-empty workflow fixture**

Boot exact official `v3.0.3`, create users/assets/albums plus non-empty plugins, methods, workflows, and steps, record schema and row digests, then boot the compatible fork. Assert the workflow ledger and rows remain unchanged before any newer official migration.

- [x] **Step 2: Add a current-fork alias fixture**

Seed the same rows with the legacy `177940...` marker, run backfills and storage verification with interruptions, apply cutover, and assert only the marker changes to `177861...` before the official migrator. Then assert later upstream workflow migrations preserve rows while adding their columns.

- [x] **Step 3: Exercise the supported official image**

Boot official `v3.0.3` against the cutover database, log in, read existing workflows, execute one, create another, upload/download/delete assets, and verify database/media invariants.

- [x] **Step 4: Exercise fork return**

Boot the compatible fork, inspect the official ledger before startup, run official then fork providers, reconcile non-workflow sidecars, activate in the final transaction, and prove both old and official-created workflows remain ordinary upstream data.

- [x] **Step 5: Document exact operator sequence and destructive boundaries**

Documentation states that workflow data is preserved through an SQL-equivalent ledger alias, no workflow sidecar exists, both/missing markers block, media verification requires the snapshot ID, and any post-commit migration failure requires database/media restore.

- [x] **Step 6: Run certification and commit**

Run: `OFFICIAL_IMMICH_TAG=v3.0.3 pnpm --filter immich-e2e test:fork-roundtrip`

Expected: all three origin/cutover/return lanes pass with matching workflow row digests and media invariants.

Commit: `test: certify both Immich migration origins`

**Release gate:** Repeat against a sanitized production-shaped current-fork clone. Interrupt every backfill and storage-verification job at least once, resume, confirm exact final digests, take database/media checkpoints, run cutover, and boot official `v3.0.3`. This external gate cannot be replaced by local synthetic tests.

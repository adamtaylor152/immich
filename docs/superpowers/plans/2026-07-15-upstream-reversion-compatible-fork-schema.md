# Upstream-Reversion-Compatible Fork Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Immich Enhanced 3.0+ capable of moving from the fork to matching official Immich and back to a compatible fork without deleting dormant fork data.

**Architecture:** Keep official migrations unchanged in `kysely_migrations`, run fork migrations from an isolated `immich_fork.migrations` ledger, and move fork-owned state into sidecar tables. Existing installations use an expand/backfill/cutover compatibility release; official handoff is enabled only after storage, checksum, ledger, and official-container round-trip gates pass.

**Tech Stack:** TypeScript, NestJS, Kysely, PostgreSQL, Vitest unit/medium tests, nest-commander, BullMQ jobs, Docker Compose, official Immich container images.

## Global Constraints

- The compatibility contract starts with official Immich 3.0.
- Official migration files and their contents remain unchanged.
- `kysely_migrations` contains only official migration names after cutover.
- Fork migrations use the `immich_fork` schema and an independent migration ledger.
- Existing fork data is never deleted during handoff or compatibility migration.
- Before ledger cutover, the legacy schema remains authoritative and rollback is the previous fork release.
- After ledger cutover, rollback requires restoring the mandatory database and media checkpoint.
- Unknown migration names, unreadable originals, active writes, unsafe deduplication references, and count/hash mismatches fail closed.
- An old fork may not open an arbitrarily newer official database; return requires a fork release that supports the current official version.
- Execute each release wave in a fresh isolated worktree and do not combine waves into one production deployment.

## Release Waves

1. **Wave A — Compatibility foundation:** Tasks 1-4. Deployable with legacy reads authoritative.
2. **Wave B — Sidecar conversion:** Tasks 5-8. Dual-write and backfill; no ledger cutover.
3. **Wave C — Handoff enablement:** Tasks 9-10. Maintenance-window cutover and return support.
4. **Wave D — Release certification:** Tasks 11-12. Official-container round trip, docs, and release gate.

---

### Task 1: Migration Ownership Manifest

**Files:**

- Create: `server/src/fork-schema/migration-manifest.ts`
- Create: `server/src/fork-schema/supported-versions.json`
- Create: `scripts/generate-upstream-migration-manifest.mjs`
- Test: `server/src/fork-schema/migration-manifest.spec.ts`

**Interfaces:**

- Produces: `classifyMigration(name: string): 'upstream' | 'legacy-fork' | 'unknown'`
- Produces: `assertSupportedUpstream(version: string): void`
- Produces: `LEGACY_FORK_MIGRATIONS: ReadonlySet<string>`

- [ ] **Step 1: Write classification and version tests**

```ts
describe(classifyMigration, () => {
  it('classifies known legacy fork migrations', () => {
    expect(classifyMigration('1778000000000-PhysicalDeduplication')).toBe('legacy-fork');
    expect(classifyMigration('2100000000030-AddSha256ChecksumAlgorithm')).toBe('legacy-fork');
  });

  it('does not guess unknown migrations', () => {
    expect(classifyMigration('9999999999999-CustomPatch')).toBe('unknown');
  });
});

it('accepts a supported upstream version', () => expect(() => assertSupportedUpstream('3.0.3')).not.toThrow());
it('rejects an unsupported upstream version', () => expect(() => assertSupportedUpstream('4.0.0')).toThrow());
```

- [ ] **Step 2: Run the test and verify failure**

Run: `pnpm --filter immich test -- --run src/fork-schema/migration-manifest.spec.ts`

Expected: FAIL because `migration-manifest.ts` does not exist.

- [ ] **Step 3: Implement the explicit manifest**

```ts
import supportedVersions from 'src/fork-schema/supported-versions.json';
import semver from 'semver';

export const LEGACY_FORK_MIGRATIONS = new Set([
  '1778000000000-PhysicalDeduplication',
  '1778255964846-PhysicalDeduplicationSchemaReconcile',
  '1778300000000-AddVideoDuplicateFrames',
  '1778788656647-AddVideoDuplicateFrameTriggerOverride',
  '1778900000000-CreateAssetHealthTables',
  '1779000000000-AddAssetBestPhotoScore',
  '1779100000000-ReconcileAssetHealthAndBestPhotoSchema',
  '1779200000000-AddAssetExifDescriptionTrigramIndex',
  '1779300000000-AddSmartSearchDescriptionTable',
  '1779400000000-UpdateWorkflowTables',
  '1779500000000-ReconcileSchemaDrift',
  '1779600000000-CreateSmartAlbumTables',
  '1779700000000-AddAlbumParentAndClosure',
  '1779800000000-AddAlbumIcon',
  '1779900000000-AddAlbumSortOrder',
  '2100000000010-AddAssetIsNsfwIndex',
  '2100000000020-AddAlbumCycleGuardTrigger',
  '2100000000030-AddSha256ChecksumAlgorithm',
]);

export function classifyMigration(name: string) {
  if (LEGACY_FORK_MIGRATIONS.has(name)) return 'legacy-fork' as const;
  if (supportedVersions.upstreamMigrations.includes(name)) return 'upstream' as const;
  return 'unknown' as const;
}

export function assertSupportedUpstream(version: string) {
  if (!supportedVersions.ranges.some((range) => semver.satisfies(version, range))) {
    throw new Error(`Unsupported official Immich database version: ${version}`);
  }
}
```

Generate `supported-versions.json` from an immutable upstream tag rather than
maintaining the migration list by hand:

```ts
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const tag = process.argv[2];
if (!tag?.match(/^v\d+\.\d+\.\d+$/)) throw new Error('Usage: generate-upstream-migration-manifest.ts v3.0.3');
const output = execFileSync('git', ['ls-tree', '-r', '--name-only', tag, 'server/src/schema/migrations'], {
  encoding: 'utf8',
});
const upstreamMigrations = output
  .trim()
  .split('\n')
  .map((path) => path.split('/').at(-1)?.replace(/\.ts$/, ''))
  .filter((name): name is string => Boolean(name))
  .toSorted();
writeFileSync(
  'server/src/fork-schema/supported-versions.json',
  JSON.stringify({ ranges: ['>=3.0.0 <4.0.0'], certifiedTags: [tag], upstreamMigrations }, null, 2) + '\n',
);
```

Run: `node scripts/generate-upstream-migration-manifest.mjs v3.0.3`

- [ ] **Step 4: Run tests and static checks**

Run: `pnpm --filter immich test -- --run src/fork-schema/migration-manifest.spec.ts && pnpm --filter immich check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/fork-schema
git commit -m "feat(server): classify upstream and legacy fork migrations"
```

### Task 2: Dual Migration Providers and Fork Baseline

**Files:**

- Create: `server/src/fork-schema/migration-provider.ts`
- Create: `server/src/fork-schema/migrations/0000000000000-ForkSchemaBaseline.ts`
- Modify: `server/src/repositories/database.repository.ts`
- Modify: `server/src/services/database.service.ts`
- Test: `server/test/medium/specs/fork-schema/migration-ledgers.spec.ts`

**Interfaces:**

- Produces: `DatabaseRepository.runOfficialMigrations(): Promise<void>`
- Produces: `DatabaseRepository.runForkMigrations(): Promise<void>`
- Produces: `DatabaseRepository.detectMigrationMode(): Promise<'legacy' | 'isolated' | 'fresh'>`

- [ ] **Step 1: Write medium tests for independent ledgers**

```ts
it('records official and fork migrations in separate ledgers', async () => {
  await repository.runOfficialMigrations();
  await repository.runForkMigrations();
  expect(await sql`SELECT name FROM kysely_migrations WHERE name LIKE '%Fork%'`.execute(db)).toHaveLength(0);
  expect(await sql`SELECT name FROM immich_fork.migrations`.execute(db)).toEqual(
    expect.objectContaining({ rows: [expect.objectContaining({ name: '0000000000000-ForkSchemaBaseline' })] }),
  );
});
```

- [ ] **Step 2: Verify the medium test fails**

Run: `pnpm --filter immich test:medium -- --run test/medium/specs/fork-schema/migration-ledgers.spec.ts`

Expected: FAIL because the fork schema and methods do not exist.

- [ ] **Step 3: Implement filtered providers and baseline**

`migration-provider.ts` must wrap `FileMigrationProvider.getMigrations()` and return either migrations classified as `upstream` or files under `fork-schema/migrations`; it must throw for unknown names in the upstream folder.

```ts
return new Migrator({
  db: this.db,
  migrationTableSchema: 'immich_fork',
  migrationTableName: 'migrations',
  migrationLockTableName: 'migrations_lock',
  provider: forkProvider,
});
```

The baseline migration creates `immich_fork`, `state`, `migration_audit`, and `backfill_progress`. `state` has one row with `id = 1`, `active`, `schemaVersion`, `upstreamVersion`, `phase`, and checkpoint timestamps.

- [ ] **Step 4: Route startup by detected mode**

In `DatabaseService.onBootstrap()`, preserve the combined legacy migrator only for unconverted databases. For `fresh` and `isolated`, run official migrations first and fork migrations second. Refuse `unknown` migration names before either migrator executes.

- [ ] **Step 5: Run tests and checks**

Run: `pnpm --filter immich test:medium -- --run test/medium/specs/fork-schema/migration-ledgers.spec.ts && pnpm --filter immich test -- --run src/services/database.service.spec.ts && pnpm --filter immich check`

Expected: PASS with no fork name in `kysely_migrations` on a fresh database.

- [ ] **Step 6: Commit**

```bash
git add server/src/fork-schema server/src/repositories/database.repository.ts server/src/services/database.service.ts server/test/medium/specs/fork-schema
git commit -m "feat(server): isolate fork migration history"
```

### Task 3: Fork State and Backfill Repository

**Files:**

- Create: `server/src/repositories/fork-schema.repository.ts`
- Create: `server/test/repositories/fork-schema.repository.mock.ts`
- Modify: `server/src/repositories/index.ts`
- Modify: `server/src/services/base.service.ts`
- Test: `server/test/medium/specs/fork-schema/fork-state.spec.ts`

**Interfaces:**

- Produces: `ForkSchemaRepository.getState(): Promise<ForkState>`
- Produces: `ForkSchemaRepository.setPhase(phase: ForkSchemaPhase): Promise<void>`
- Produces: `claimBatch(kind: BackfillKind, size: number): Promise<string[]>`
- Produces: `completeBatch(kind: BackfillKind, cursor: string, count: number, digest: string): Promise<void>`

- [ ] **Step 1: Write tests for singleton state and resumable progress**

Test that two concurrent batch claims cannot return the same IDs, progress survives repository reconstruction, and activation is rejected unless every backfill reports `remaining = 0`.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter immich test:medium -- --run test/medium/specs/fork-schema/fork-state.spec.ts`

Expected: FAIL because the repository is absent.

- [ ] **Step 3: Implement state types and repository methods**

```ts
export type ForkSchemaPhase = 'legacy' | 'dual-write' | 'ready' | 'inactive' | 'active' | 'failed';
export type BackfillKind = 'privacy' | 'albums' | 'enrichment' | 'automation' | 'health' | 'storage' | 'checksum';
export type ForkState = { active: boolean; phase: ForkSchemaPhase; schemaVersion: string; upstreamVersion: string };
```

Use `FOR UPDATE SKIP LOCKED` for claims and store `cursor`, `processed`, `remaining`, `digest`, and `lastError` per backfill kind.

- [ ] **Step 4: Register repository injection and mock**

Add `ForkSchemaRepository` to `repositories`, `BASE_SERVICE_DEPENDENCIES`, the `BaseService` constructor, and test service setup.

- [ ] **Step 5: Run unit, medium, and type checks**

Run: `pnpm --filter immich test:medium -- --run test/medium/specs/fork-schema/fork-state.spec.ts && pnpm --filter immich check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/repositories server/src/services/base.service.ts server/test
git commit -m "feat(server): track fork schema conversion state"
```

### Task 4: Compatibility Migration Control Plane

**Files:**

- Create: `server/src/services/fork-schema-migration.service.ts`
- Create: `server/src/services/fork-schema-migration.service.spec.ts`
- Create: `server/src/commands/fork-schema.command.ts`
- Modify: `server/src/commands/index.ts`
- Modify: `server/src/enum.ts`
- Modify: `server/src/types.ts`
- Modify: `server/src/services/index.ts`

**Interfaces:**

- Produces CLI: `immich-admin fork-schema status|start|pause|resume|verify`
- Produces job: `JobName.ForkSchemaBackfill`
- Produces: `runBatch(kind: BackfillKind, batchSize: number): Promise<JobStatus>`

- [ ] **Step 1: Write service tests**

```ts
it('does not start outside legacy phase', async () => {
  mocks.forkSchema.getState.mockResolvedValue({
    active: true,
    phase: 'ready',
    schemaVersion: '2',
    upstreamVersion: '3.0.3',
  });
  await expect(service.start()).rejects.toThrow('Backfill can only start from legacy phase');
});
```

Also test pause/resume idempotency and that a failed batch records `lastError` without advancing its cursor.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter immich test -- --run src/services/fork-schema-migration.service.spec.ts`

Expected: FAIL because the service is absent.

- [ ] **Step 3: Implement the coordinator and job handler**

The service transitions `legacy -> dual-write -> ready`, queues exactly one batch at a time per kind, and returns structured status. It never performs ledger cutover.

- [ ] **Step 4: Implement the nest-commander command**

The command prints phase, per-kind processed/remaining counts, digest, and last error. `start` requires explicit confirmation; `verify` is read-only.

- [ ] **Step 5: Run tests and checks**

Run: `pnpm --filter immich test -- --run src/services/fork-schema-migration.service.spec.ts && pnpm --filter immich check`

Expected: PASS.

- [ ] **Step 6: Commit Wave A**

```bash
git add server/src
git commit -m "feat(server): add fork schema migration control plane"
```

**Release gate:** Deploy Wave A to a disposable copy of the current fork database. Confirm legacy reads remain authoritative and stopping/restarting does not change migration ledgers.

### Task 5: Privacy and Album Sidecars

**Files:**

- Create: `server/src/fork-schema/migrations/0000000000010-PrivacyAndAlbums.ts`
- Create: `server/src/repositories/fork-privacy.repository.ts`
- Create: `server/src/repositories/fork-album-metadata.repository.ts`
- Modify: `server/src/services/image-enrichment.service.ts`
- Modify: `server/src/repositories/album.repository.ts`
- Modify: `server/src/services/fork-schema-migration.service.ts`
- Test: `server/test/medium/specs/fork-schema/privacy-album-backfill.spec.ts`

**Interfaces:**

- Produces sidecars: `immich_fork.asset_privacy`, `album_metadata`, `album_closure`
- Produces: `backfillPrivacy(ids: string[]): Promise<BatchResult>`
- Produces: `backfillAlbums(ids: string[]): Promise<BatchResult>`

- [ ] **Step 1: Write medium tests using legacy rows**

Seed `asset.is_nsfw`, suppression metadata, album parent/icon/sort order, run batches twice, and assert identical sidecars with no duplicate closure rows.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter immich test:medium -- --run test/medium/specs/fork-schema/privacy-album-backfill.spec.ts`

Expected: FAIL because sidecars do not exist.

- [ ] **Step 3: Add fork migration and repositories**

Sidecars use upstream UUIDs as indexed logical IDs without cross-schema foreign keys. Upserts use `ON CONFLICT DO UPDATE` and return a deterministic SHA-256 digest of canonicalized rows.

- [ ] **Step 4: Add phase-aware dual writes and reads**

During `dual-write`, legacy writes happen first, followed by sidecar writes in the same transaction where possible. Reads remain legacy until `ready`; isolated databases read sidecars exclusively.

- [ ] **Step 5: Run privacy, album, sync, and shared-link tests**

Run: `pnpm --filter immich test:medium -- --run test/medium/specs/fork-schema/privacy-album-backfill.spec.ts && pnpm --filter immich test -- --run src/services/image-enrichment.service.spec.ts src/services/album.service.spec.ts src/services/sync.service.spec.ts src/services/shared-link.service.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src server/test/medium/specs/fork-schema
git commit -m "feat(server): migrate privacy and album state to sidecars"
```

### Task 6: Enrichment, Configuration, and Smart-Album Sidecars

**Files:**

- Create: `server/src/fork-schema/migrations/0000000000020-EnrichmentAndAutomation.ts`
- Create: `server/src/repositories/fork-enrichment.repository.ts`
- Create: `server/src/repositories/fork-config.repository.ts`
- Modify: `server/src/services/image-enrichment.service.ts`
- Modify: `server/src/services/smart-album.service.ts`
- Modify: `server/src/repositories/smart-album.repository.ts`
- Modify: `server/src/services/system-config.service.ts`
- Test: `server/test/medium/specs/fork-schema/enrichment-automation-backfill.spec.ts`

**Interfaces:**

- Produces sidecars for enrichment provenance, descriptions, tags, smart-album rules/exclusions, and fork configuration.

- [ ] **Step 1: Write tests that preserve user-authored descriptions**

Seed a description with user text plus an `AI description:` block, enrichment provenance, smart-album rules, and RunPod settings. Assert exact user text remains upstream and generated state is copied to fork tables.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter immich test:medium -- --run test/medium/specs/fork-schema/enrichment-automation-backfill.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Implement provenance-aware conversion**

Only remove upstream generated blocks when stored provenance reproduces the exact block. If provenance is absent or mismatched, copy to the sidecar but leave upstream text unchanged and set `requiresReview = true`.

- [ ] **Step 4: Add phase-aware repositories**

Keep upstream album rows and membership as static official data. Move automation rules and exclusions only; dual-write until cutover.

- [ ] **Step 5: Run focused suites**

Run: `pnpm --filter immich test:medium -- --run test/medium/specs/fork-schema/enrichment-automation-backfill.spec.ts && pnpm --filter immich test -- --run src/services/image-enrichment.service.spec.ts src/services/smart-album.service.spec.ts src/services/system-config.service.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src server/test/medium/specs/fork-schema
git commit -m "feat(server): isolate enrichment and automation data"
```

### Task 7: Health, Scoring, and Duplicate-Frame Sidecars

**Files:**

- Create: `server/src/fork-schema/migrations/0000000000030-DerivedResults.ts`
- Modify: `server/src/repositories/media-health.repository.ts`
- Modify: `server/src/repositories/best-photos.repository.ts`
- Modify: `server/src/repositories/duplicate.repository.ts`
- Modify: `server/src/services/fork-schema-migration.service.ts`
- Test: `server/test/medium/specs/fork-schema/derived-results-backfill.spec.ts`

**Interfaces:**

- Produces fork-owned health run/findings, best-photo scores, and video duplicate-frame tables.

- [ ] **Step 1: Write idempotent-copy and orphan tests**

Assert legacy rows copy exactly, reruns do not duplicate them, and rows for nonexistent upstream assets are archived in `immich_fork.orphaned_records` rather than activated.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter immich test:medium -- --run test/medium/specs/fork-schema/derived-results-backfill.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Add migration and repository schema qualification**

All queries use explicit `immich_fork` table qualification; do not keep public-schema table names as runtime aliases.

- [ ] **Step 4: Add backfill and digest verification**

Compute per-table row counts and deterministic digests before marking each backfill complete.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --filter immich test:medium -- --run test/medium/specs/fork-schema/derived-results-backfill.spec.ts && pnpm --filter immich test -- --run src/services/media-health.service.spec.ts src/services/best-photos.service.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src server/test/medium/specs/fork-schema
git commit -m "feat(server): isolate fork derived result tables"
```

### Task 8: Checksum and Physical-Storage Normalization

**Files:**

- Create: `server/src/services/fork-storage-normalization.service.ts`
- Create: `server/src/services/fork-storage-normalization.service.spec.ts`
- Create: `server/src/fork-schema/migrations/0000000000040-ChecksumsAndStorage.ts`
- Modify: `server/src/services/physical-deduplication.service.ts`
- Modify: `server/src/repositories/physical-file.repository.ts`
- Modify: `server/src/repositories/crypto.repository.ts`
- Modify: `server/src/services/fork-schema-migration.service.ts`
- Create: `server/src/services/physical-deduplication.service.spec.ts`
- Test: `server/test/medium/specs/fork-schema/checksum-storage-backfill.spec.ts`

**Interfaces:**

- Produces: `normalizeAsset(assetId: string): Promise<NormalizationResult>`
- Produces: `NormalizationResult = { assetId; sha1; sha256; linkCount; verifiedPaths }`

- [ ] **Step 1: Write tests for unreadable files, SHA conversion, and hardlink safety**

Create two assets sharing fork canonical bytes. Assert each upstream path remains readable after deleting either path, SHA-256 is preserved in the sidecar, SHA-1 is restored upstream, and unreadable originals leave progress failed without changing the asset row.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter immich test:medium -- --run test/medium/specs/fork-schema/checksum-storage-backfill.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Implement staged file normalization**

Write a temporary sibling path, create a hardlink or reflink, fsync, verify size and both hashes, atomically rename, then update the database. Never unlink the legacy canonical path before verification commits.

- [ ] **Step 4: Implement checksum conversion**

Persist SHA-256 in `immich_fork.asset_checksum`; compute upstream SHA-1 from the original stream; update `asset.checksum` and `checksumAlgorithm` in one transaction. Record evidence in progress rows.

- [ ] **Step 5: Run focused and regression tests**

Run: `pnpm --filter immich test:medium -- --run test/medium/specs/fork-schema/checksum-storage-backfill.spec.ts && pnpm --filter immich test -- --run src/services/physical-deduplication.service.spec.ts src/repositories/crypto.repository.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit Wave B**

```bash
git add server/src server/test/medium/specs/fork-schema
git commit -m "feat(server): normalize fork checksums and deduplicated storage"
```

**Release gate:** Run all backfills on a production-shaped clone, interrupt every job type at least once, resume, and verify zero remaining records plus matching digests. Do not proceed to Task 9 on the first production deployment of Wave B.

### Task 9: Locked Legacy Ledger Cutover

**Files:**

- Create: `server/src/services/fork-schema-cutover.service.ts`
- Create: `server/src/services/fork-schema-cutover.service.spec.ts`
- Create: `server/src/commands/fork-schema-cutover.command.ts`
- Modify: `server/src/commands/index.ts`
- Modify: `server/src/repositories/database.repository.ts`
- Test: `server/test/medium/specs/fork-schema/ledger-cutover.spec.ts`

**Interfaces:**

- Produces CLI: `immich-admin fork-schema-cutover preflight|apply`
- Produces: `preflight(): Promise<CutoverReport>`
- Produces: `apply(expectedReportDigest: string): Promise<HandoffCheckpoint>`

- [ ] **Step 1: Write fail-closed tests**

Test refusal for an unknown migration, nonzero backfill remainder, active writes, checksum failure, unsafe physical mapping, and a preflight digest that differs at apply time.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter immich test:medium -- --run test/medium/specs/fork-schema/ledger-cutover.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Implement read-only preflight**

Return exact ledger classifications, schema residue allowlist, table counts, digests, storage failures, upstream version, and a canonical report digest. Preflight must not mutate any table.

- [ ] **Step 4: Implement locked apply**

Under `DatabaseLock.Migrations` and maintenance mode: re-run preflight, copy legacy ledger rows to audit, delete only `LEGACY_FORK_MIGRATIONS`, insert the applied fork-v2 baseline, disable legacy triggers, switch reads to sidecars, and run official migrations. Unknown names abort the transaction.

- [ ] **Step 5: Verify rollback boundary**

Test that a failure before commit leaves the legacy ledger and phase unchanged. Document that any failure after committed cutover requires checkpoint restore.

- [ ] **Step 6: Run tests and commit**

Run: `pnpm --filter immich test:medium -- --run test/medium/specs/fork-schema/ledger-cutover.spec.ts && pnpm --filter immich check`

```bash
git add server/src server/test/medium/specs/fork-schema
git commit -m "feat(server): add locked fork ledger cutover"
```

### Task 10: Official Handoff and Fork Return Commands

**Files:**

- Create: `server/src/services/fork-handoff.service.ts`
- Create: `server/src/services/fork-handoff.service.spec.ts`
- Create: `server/src/commands/fork-handoff.command.ts`
- Modify: `server/src/commands/index.ts`
- Modify: `server/src/fork-schema/supported-versions.json`
- Test: `server/test/medium/specs/fork-schema/return-reconciliation.spec.ts`

**Interfaces:**

- Produces CLI: `immich-admin fork-handoff prepare-official`
- Produces CLI: `immich-admin fork-handoff prepare-fork`
- Produces: `prepareOfficial(): Promise<HandoffCheckpoint>`
- Produces: `prepareFork(): Promise<ReconciliationReport>`

- [ ] **Step 1: Write handoff and return tests**

Assert official preparation sets `active = false`, disables triggers, and records a checkpoint. Assert return refuses an unsupported official version, archives orphan sidecars, initializes new upstream IDs, and activates only after reconciliation succeeds.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter immich test:medium -- --run test/medium/specs/fork-schema/return-reconciliation.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Implement official preparation**

Require maintenance mode, a completed cutover, zero failed gates, and a recent backup acknowledgment. The command prints the exact official image tag to start and never starts Docker itself.

- [ ] **Step 4: Implement return reconciliation**

Inspect official migration names before normal startup, validate the supported-version manifest, run official then fork migrations, archive orphan sidecars, seed defaults for new IDs, rebuild derived indexes, and activate in a final transaction.

- [ ] **Step 5: Run tests and commit Wave C**

Run: `pnpm --filter immich test:medium -- --run test/medium/specs/fork-schema/return-reconciliation.spec.ts && pnpm --filter immich check`

```bash
git add server/src server/test/medium/specs/fork-schema
git commit -m "feat(server): support official handoff and fork return"
```

### Task 11: Official-Container Round-Trip Certification

> Corrective certification implemented as the three explicit lanes
> `origin-v3.0.3-to-fork`, `current-fork-to-official-v3.0.3`, and
> `official-v3.0.3-to-fork-return`. The harness derives the sole exact certified
> tag from `supported-versions.json`; it rejects overrides and never floats an
> image tag. Operator instructions live at
> `docs/docs/administration/upstream-handoff.md`.

**Files:**

- Create: `e2e/src/specs/server/fork-schema-roundtrip.e2e-spec.ts`
- Create: `e2e/docker-compose.fork-roundtrip.yml`
- Create: `scripts/test-fork-roundtrip.sh`
- Create: `.github/workflows/fork-roundtrip.yml`
- Modify: `e2e/package.json`

**Interfaces:**

- Produces command: `pnpm --filter immich-e2e test:fork-roundtrip`
- Consumes: `OFFICIAL_IMMICH_TAG`, defaulting to the exact supported manifest tag.

- [x] **Step 1: Write the round-trip test harness**

The test seeds users, assets, albums, privacy state, enrichment, smart albums, deduplicated files, and fork migration history; it records invariant counts and file digests.

- [x] **Step 2: Add the container sequence**

```bash
docker compose -f e2e/docker-compose.fork-roundtrip.yml up -d postgres fork-server
pnpm --filter immich-e2e test -- --run src/specs/server/fork-schema-roundtrip.e2e-spec.ts --testNamePattern seed
docker compose -f e2e/docker-compose.fork-roundtrip.yml stop fork-server
docker compose -f e2e/docker-compose.fork-roundtrip.yml up -d official-server
pnpm --filter immich-e2e test -- --run src/specs/server/fork-schema-roundtrip.e2e-spec.ts --testNamePattern official
docker compose -f e2e/docker-compose.fork-roundtrip.yml stop official-server
docker compose -f e2e/docker-compose.fork-roundtrip.yml up -d fork-server
pnpm --filter immich-e2e test -- --run src/specs/server/fork-schema-roundtrip.e2e-spec.ts --testNamePattern return
```

- [x] **Step 3: Assert official operations**

The official phase must start twice and pass login, server info, timeline, search, upload, edit, asset deletion, album creation/deletion, and background-job health.

- [x] **Step 4: Assert return invariants**

Verify original counts/digests, new official records receive defaults, deleted records do not reactivate sidecars, and compatible fork features become active.

- [x] **Step 5: Add CI workflow and run locally**

Run: `OFFICIAL_IMMICH_TAG=v3.0.3 pnpm --filter immich-e2e test:fork-roundtrip`

Expected: PASS through fork -> official -> fork with both official boots healthy.

Local completion does not satisfy the release gate. A sanitized,
production-shaped current-fork clone must still be interrupted and resumed for
every backfill and storage-verification kind, checkpointed, digest-compared,
cut over, and booted with exact official `v3.0.3` before release.

Independent Task 6 review corrections are complete. The corrected clean `all`
run additionally proves normal fork API and microservices startup after return,
exact preservation/default/orphan behavior for all seven sidecar families, a
second official restart, execution of both preserved upstream workflows, and
complete CI path triggers. Workflow data remains solely in upstream tables;
the compatibility correction restores the official v3 plugin host ABI at
runtime and does not introduce a workflow migration or sidecar.

- [x] **Step 6: Commit**

```bash
git add e2e scripts/test-fork-roundtrip.sh .github/workflows/fork-roundtrip.yml
git commit -m "test: certify fork and official database round trips"
```

### Task 12: Operator Documentation and Release Enforcement

**Files:**

- Create: `docs/docs/features/switching-between-fork-and-official.md`
- Modify: `docs/docs/features/revert-to-upstream.md`
- Modify: `docs/docs/features/fork-privacy-suite.md`
- Modify: `README.md`
- Modify: `.github/workflows/nsfw-unraid-docker.yml`
- Test: `server/src/fork-schema/migration-manifest.spec.ts`

**Interfaces:**

- Produces operator runbooks for legacy conversion, handoff, return, backups, visibility changes, and rollback boundaries.

- [ ] **Step 1: Add release-manifest enforcement test**

Test that the server version is inside `supported-versions.json`, the official migration list matches the bundled provider, and a release cannot set `reversionSupported = true` without a certified official tag.

- [ ] **Step 2: Write the operator runbook**

Include exact commands:

```bash
immich-admin fork-schema status
immich-admin fork-schema start
immich-admin fork-schema verify
immich-admin fork-schema-cutover preflight
REPORT_DIGEST="$(immich-admin fork-schema-cutover preflight --format digest)"
immich-admin fork-schema-cutover apply --report-digest "$REPORT_DIGEST"
immich-admin fork-handoff prepare-official
# Keep maintenance enabled through the checkpoint, stop the fork server, then
# run this from a one-shot admin process using the same fork image:
immich-admin disable-maintenance-mode
# Immediately start ghcr.io/immich-app/immich-server:v3.0.3 and verify the
# exact full certified ledger before any official API operation.
immich-admin fork-handoff prepare-fork
```

Document that official operation exposes assets previously hidden only by fork privacy filters.

- [ ] **Step 3: Update the old reversion page**

Retain its warning for pre-compatibility releases. Add a versioned branch: legacy releases still require backup restore; compatibility-certified releases use the new handoff flow.

- [ ] **Step 4: Gate image publication**

Make the release workflow require the round-trip job and embed `supported-versions.json` plus the certification result in image labels/artifacts.

- [ ] **Step 5: Run the full release gate**

Run: `pnpm --filter immich check:all && pnpm --filter immich-e2e check && OFFICIAL_IMMICH_TAG=v3.0.3 pnpm --filter immich-e2e test:fork-roundtrip`

Expected: all checks PASS; the published manifest names the tested official tag.

- [ ] **Step 6: Commit Wave D**

```bash
git add docs README.md .github/workflows/nsfw-unraid-docker.yml server/src/fork-schema
git commit -m "docs: publish certified fork handoff workflow"
```

## Final Production Validation

- [ ] Run Wave A against a restored production backup and verify no behavior change.
- [ ] Run Wave B backfills to completion, interrupt/resume each job type, and compare all counts and digests.
- [ ] Snapshot database and media before Wave C.
- [ ] Run cutover preflight twice and confirm identical report digests.
- [ ] Apply cutover, start the matching official image, and complete official mobile smoke tests.
- [ ] Create and delete representative official assets/albums while dormant.
- [ ] Start a compatible fork, reconcile, and verify fork state plus new/deleted official records.
- [ ] Retain `immich_fork_legacy` read-only for at least one release cycle.
- [ ] Do not remove inert legacy columns or tables until a later independently approved cleanup plan.

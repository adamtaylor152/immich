import { Kysely, sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { ChecksumAlgorithm } from 'src/enum';
import { getCatalogEvidence } from 'src/fork-schema/catalog';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { BACKFILL_KINDS } from 'src/repositories/fork-schema.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { ForkSchemaCutoverService } from 'src/services/fork-schema-cutover.service';
import { mediumFactory } from 'test/medium.factory';
import { getKyselyDB, newTestService } from 'test/utils';

const SHA256 = 'a'.repeat(64);
const ASSET_SHA1 = Buffer.alloc(20, 1);
const ASSET_SHA256 = Buffer.alloc(32, 2);

const insertAsset = async (db: Kysely<DB>) => {
  const user = mediumFactory.userInsert();
  const asset = mediumFactory.assetInsert({
    checksum: ASSET_SHA1,
    checksumAlgorithm: ChecksumAlgorithm.sha1File,
    originalPath: `/upload/${randomUUID()}.jpg`,
    ownerId: user.id,
  });
  await db.insertInto('user').values(user).execute();
  await db.insertInto('asset').values(asset).execute();
  return asset;
};

const insertChecksum = async (db: Kysely<DB>, assetId: string) => {
  await sql`
    INSERT INTO immich_fork.asset_checksum
      ("assetId", sha1, sha256, "sizeInBytes", "verifiedPaths", "linkCount")
    VALUES (${assetId}::uuid, ${ASSET_SHA1}, ${ASSET_SHA256}, 1, '{}', 1)
  `.execute(db);
};

const insertMapping = async (db: Kysely<DB>, asset: { id?: string; originalPath: string }) => {
  const physicalFileId = randomUUID();
  await sql`
    INSERT INTO immich_fork.physical_file
      (id, "canonicalAssetId", type, checksum, "sizeInBytes", "canonicalPath", "createdAt", "updatedAt")
    VALUES (${physicalFileId}::uuid, ${asset.id}::uuid, 'original', ${ASSET_SHA256}, 1,
      ${asset.originalPath}, now(), now())
  `.execute(db);
  await sql`
    INSERT INTO immich_fork.asset_physical_file ("assetId", "physicalFileId", "upstreamPath")
    VALUES (${asset.id}::uuid, ${physicalFileId}::uuid, ${asset.originalPath})
  `.execute(db);
};

describe('complete fork schema cutover evidence', () => {
  let db: Kysely<DB>;
  let repository: DatabaseRepository;
  let service: ForkSchemaCutoverService;
  let databaseMock: ReturnType<typeof newTestService>['mocks']['database'];

  beforeAll(async () => {
    db = await getKyselyDB('cutover_evidence');
    repository = new DatabaseRepository(db, LoggingRepository.create(), new ConfigRepository());
    const testService = newTestService(ForkSchemaCutoverService);
    service = testService.sut;
    databaseMock = testService.mocks.database;
    databaseMock.getForkSchemaCutoverEvidence.mockImplementation((runner) =>
      repository.getForkSchemaCutoverEvidence(runner ?? db),
    );
  });

  beforeEach(async () => {
    await sql`DROP SCHEMA IF EXISTS task3_unexpected CASCADE`.execute(db);
    await sql`DROP TABLE IF EXISTS public.task3_unexpected CASCADE`.execute(db);
    await sql`ALTER TABLE public.asset DROP COLUMN IF EXISTS task3_unexpected CASCADE`.execute(db);
    await sql`ALTER TABLE public.asset DROP CONSTRAINT IF EXISTS task3_unexpected`.execute(db);
    await sql`DROP TRIGGER IF EXISTS task3_unexpected ON public.asset`.execute(db);
    await sql`DROP INDEX IF EXISTS public.task3_unexpected_index`.execute(db);
    await sql`DROP FUNCTION IF EXISTS public.task3_unexpected()`.execute(db);
    await sql`DROP TYPE IF EXISTS public.task3_unexpected_enum`.execute(db);
    await sql`
      TRUNCATE immich_fork.asset_physical_file, immich_fork.physical_file, immich_fork.asset_checksum
    `.execute(db);
    await db.deleteFrom('asset').execute();
    await db.deleteFrom('user').execute();
    await sql`TRUNCATE immich_fork.backfill_progress, immich_fork.migration_audit, immich_fork.migrations`.execute(db);
    await sql`
      INSERT INTO immich_fork.migrations (name, timestamp)
      SELECT name, row_number() OVER ()::text
      FROM unnest(${[
        '0000000000000-ForkSchemaBaseline',
        '0000000000010-PrivacyAndAlbums',
        '0000000000020-EnrichmentAndAutomation',
        '0000000000030-DerivedResults',
        '0000000000040-ChecksumsAndStorage',
      ]}::text[]) AS name
    `.execute(db);
    await sql`
      INSERT INTO immich_fork.backfill_progress
        (kind, cursor, processed, remaining, digest, "claimedCursor", "claimedIds", "claimToken", "lastError")
      SELECT kind, NULL, 0, 0, ${SHA256}, NULL, '{}', NULL, NULL
      FROM unnest(${[...BACKFILL_KINDS]}::text[]) AS kind
    `.execute(db);
    await sql`
      UPDATE immich_fork.state
      SET active = false, phase = 'ready', "schemaVersion" = '1', "upstreamVersion" = '3.0.3'
      WHERE id = 1
    `.execute(db);
    await sql`
      INSERT INTO public.system_metadata (key, value)
      VALUES ('maintenance-mode', '{"isMaintenanceMode":true}'::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `.execute(db);
  });

  afterAll(async () => db.destroy());

  it('reads a complete public and fork catalog without OIDs or timestamps', async () => {
    const catalog = await getCatalogEvidence(db);

    expect(catalog.schemas.map(({ identity }) => identity)).toEqual(['immich_fork', 'public']);
    expect(catalog.tables.map(({ identity }) => identity)).toEqual(
      expect.arrayContaining([
        'immich_fork.state',
        'immich_fork.migration_audit',
        'immich_fork.backfill_progress',
        'immich_fork.orphaned_records',
        'immich_fork.asset_health_run',
        'immich_fork.asset_health_candidate',
        'immich_fork.asset_storage_reservation',
      ]),
    );
    for (const entries of [
      catalog.schemas,
      catalog.tables,
      catalog.columns,
      catalog.enums,
      catalog.constraints,
      catalog.indexes,
      catalog.functions,
      catalog.triggers,
    ]) {
      expect(entries.every((value) => Object.keys(value).toSorted().join(',') === 'definition,identity')).toBe(true);
    }
  });

  it.each([
    ['missing backfill kind', sql`DELETE FROM immich_fork.backfill_progress WHERE kind = ${BACKFILL_KINDS[0]}`],
    [
      'unknown backfill kind',
      sql`INSERT INTO immich_fork.backfill_progress (kind, remaining, digest) VALUES ('unknown', 0, ${SHA256})`,
    ],
    [
      'active claim',
      sql`UPDATE immich_fork.backfill_progress SET "claimToken" = 'claim' WHERE kind = ${BACKFILL_KINDS[0]}`,
    ],
    [
      'active cursor',
      sql`UPDATE immich_fork.backfill_progress SET cursor = 'cursor' WHERE kind = ${BACKFILL_KINDS[0]}`,
    ],
    [
      'backfill error',
      sql`UPDATE immich_fork.backfill_progress SET "lastError" = 'failed' WHERE kind = ${BACKFILL_KINDS[0]}`,
    ],
    [
      'invalid final digest',
      sql`UPDATE immich_fork.backfill_progress SET digest = 'invalid' WHERE kind = ${BACKFILL_KINDS[0]}`,
    ],
    [
      'missing fork migration',
      sql`DELETE FROM immich_fork.migrations WHERE name = '0000000000040-ChecksumsAndStorage'`,
    ],
    [
      'unknown fork migration',
      sql`INSERT INTO immich_fork.migrations (name, timestamp) VALUES ('9999999999999-Unknown', now())`,
    ],
  ])('refuses %s independently', async (_name, mutation) => {
    await mutation.execute(db);

    const preflight = await service.preflight();
    expect(preflight.ready).toBe(false);
  });

  it.each([
    ['table', sql`CREATE TABLE public.task3_unexpected (id integer)`],
    ['column', sql`ALTER TABLE public.asset ADD COLUMN task3_unexpected integer`],
    [
      'trigger',
      sql`CREATE TRIGGER task3_unexpected BEFORE UPDATE ON public.asset FOR EACH ROW EXECUTE FUNCTION updated_at()`,
    ],
    ['constraint', sql`ALTER TABLE public.asset ADD CONSTRAINT task3_unexpected CHECK (id IS NOT NULL)`],
    ['index', sql`CREATE INDEX task3_unexpected_index ON public.asset (id)`],
    ['function', sql`CREATE FUNCTION public.task3_unexpected() RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 1'`],
    ['enum', sql`CREATE TYPE public.task3_unexpected_enum AS ENUM ('value')`],
    ['schema', sql`CREATE SCHEMA task3_unexpected`],
  ])('refuses an unknown public %s object', async (_kind, mutation) => {
    await mutation.execute(db);
    const preflight = await service.preflight();
    expect(preflight.ready).toBe(false);
  });

  it('refuses a missing checksum sidecar by exact count and digest coverage', async () => {
    const asset = await insertAsset(db);
    await insertMapping(db, asset);

    const evidence = await repository.getForkSchemaCutoverEvidence(db);
    expect(evidence.checksumCoverage).toMatchObject({
      applicableCount: 1,
      invalidCount: 1,
      sidecarCount: 0,
      valid: false,
    });
    expect(evidence.checksumCoverage.applicableDigest).not.toBe(evidence.checksumCoverage.sidecarDigest);
    expect(evidence.mappingCoverage.valid).toBe(true);
    const preflight = await service.preflight();
    expect(preflight.ready).toBe(false);
  });

  it('refuses a missing physical mapping by exact count and digest coverage', async () => {
    const asset = await insertAsset(db);
    await insertChecksum(db, asset.id!);

    const evidence = await repository.getForkSchemaCutoverEvidence(db);
    expect(evidence.checksumCoverage.valid).toBe(true);
    expect(evidence.mappingCoverage).toMatchObject({
      mappingCount: 0,
      normalizedCount: 1,
      unsafeCount: 1,
      valid: false,
    });
    expect(evidence.mappingCoverage.normalizedDigest).not.toBe(evidence.mappingCoverage.mappingDigest);
    const preflight = await service.preflight();
    expect(preflight.ready).toBe(false);
  });
});

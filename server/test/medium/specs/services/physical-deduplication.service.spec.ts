import { sql } from 'kysely';
import { randomBytes, randomUUID } from 'node:crypto';
import { Stats } from 'node:fs';
import { defaults } from 'src/dtos/config.dto';
import { AssetFileType, JobName, JobStatus, SystemMetadataKey } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { ForkSchemaRepository } from 'src/repositories/fork-schema.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PhysicalFileRepository } from 'src/repositories/physical-file.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { PhysicalDeduplicationService } from 'src/services/physical-deduplication.service';
import { clearConfigCache } from 'src/utils/config';
import { newMediumService } from 'test/medium.factory';
import { getActiveForkKyselyDB as getKyselyDB } from 'test/utils';

const dryRunSummary = (masterUserId: string) => ({
  mode: 'dry-run' as const,
  masterUserId,
  ranAt: new Date().toISOString(),
  eligibleAssets: 0,
  linkedAssets: 0,
  skippedExternal: 0,
  skippedMissingMaster: 0,
  reclaimableBytes: 0,
  deletedBytes: 0,
  samples: [],
});

/**
 * Boots the service against a fresh fork-active database with:
 * - real PhysicalFileRepository + ForkSchemaRepository (the data-loss-critical paths)
 * - a mocked StorageRepository whose existsSync/stat answers come from `existing`
 * - a mocked JobRepository so FileDelete queueing is observable without side effects
 */
const bootstrap = async () => {
  const database = await getKyselyDB();
  const existing = new Set<string>();

  // The active fork phase makes the immich_fork.config sidecar authoritative;
  // seed the two required keys so `getConfig` can overlay them.
  await sql`
    INSERT INTO immich_fork.config (key, value)
    VALUES
      ('machineLearning.runpod', ${JSON.stringify(defaults.machineLearning.runpod)}::jsonb),
      ('smartAlbums', ${JSON.stringify(defaults.smartAlbums)}::jsonb)
    ON CONFLICT (key) DO NOTHING
  `.execute(database);

  const { ctx: fixtures } = newMediumService(PhysicalDeduplicationService, {
    database,
    real: [],
    mock: [LoggingRepository],
  });
  const { user: masterUser } = await fixtures.newUser();
  const { user: dupUser } = await fixtures.newUser();

  const { sut, ctx } = newMediumService(PhysicalDeduplicationService, {
    database,
    real: [AssetRepository, ConfigRepository, ForkSchemaRepository, PhysicalFileRepository],
    mock: [
      CryptoRepository,
      DatabaseRepository,
      JobRepository,
      LoggingRepository,
      StorageRepository,
      SystemMetadataRepository,
    ],
  });

  ctx.getMock(DatabaseRepository).withLock.mockImplementation((_lock, callback) => callback());
  ctx.getMock(JobRepository).queue.mockResolvedValue();
  ctx.getMock(CryptoRepository).hashFile.mockResolvedValue(randomBytes(32));
  ctx
    .getMock(SystemMetadataRepository)
    .get.mockImplementation((key) =>
      Promise.resolve(
        key === SystemMetadataKey.PhysicalDeduplicationMigration
          ? dryRunSummary(masterUser.id)
          : { physicalDeduplication: { enabled: true, masterUserId: masterUser.id } },
      ),
    );
  ctx.getMock(SystemMetadataRepository).set.mockResolvedValue();

  const storage = ctx.getMock(StorageRepository);
  storage.checkFileExists.mockImplementation((path) => Promise.resolve(existing.has(path)));
  storage.stat.mockImplementation((path) =>
    existing.has(path) ? Promise.resolve({ size: 500 } as Stats) : Promise.reject(new Error('ENOENT')),
  );

  const queuedDeletes = () =>
    ctx
      .getMock(JobRepository)
      .queue.mock.calls.filter(([job]) => job.name === JobName.FileDelete)
      .flatMap(([job]) => (job as { data: { files: string[] } }).data.files);

  const newPair = async () => {
    const checksum = randomBytes(20);
    const masterPath = `/data/upload/${randomUUID()}-master.jpg`;
    const dupPath = `/data/upload/${randomUUID()}-dup.jpg`;

    const { asset: master } = await ctx.newAsset({ ownerId: masterUser.id, checksum, originalPath: masterPath });
    await ctx.newExif({ assetId: master.id, fileSizeInByte: 1000 });
    const { asset: duplicate } = await ctx.newAsset({ ownerId: dupUser.id, checksum, originalPath: dupPath });
    await ctx.newExif({ assetId: duplicate.id, fileSizeInByte: 1000 });

    return { master, duplicate, masterPath, dupPath };
  };

  const getAssetLink = (id: string) =>
    database
      .selectFrom('asset')
      .select(['originalPath', 'physicalOriginalFileId'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  return { sut, ctx, database, existing, masterUser, dupUser, queuedDeletes, newPair, getAssetLink };
};

beforeEach(() => {
  clearConfigCache();
});

describe(PhysicalDeduplicationService.name, () => {
  it('refuses to queue a FileDelete when the master file is missing on disk', async () => {
    const { sut, newPair, queuedDeletes, getAssetLink } = await bootstrap();
    const { duplicate, dupPath } = await newPair();
    // master path deliberately never marked as existing on disk

    await expect(sut.handleApply({})).resolves.toBe(JobStatus.Success);

    expect(queuedDeletes()).toEqual([]);
    await expect(getAssetLink(duplicate.id)).resolves.toEqual({
      originalPath: dupPath,
      physicalOriginalFileId: null,
    });
  });

  it('refuses to delete a duplicate generated file when the master generated file is missing', async () => {
    const { sut, ctx, database, existing, newPair, queuedDeletes } = await bootstrap();
    const { master, duplicate, masterPath, dupPath } = await newPair();

    const masterPreview = `/data/thumbs/${master.id}-preview.jpg`;
    const dupPreview = `/data/thumbs/${duplicate.id}-preview.jpg`;
    await ctx.newAssetFile({ assetId: master.id, type: AssetFileType.Preview, path: masterPreview });
    await ctx.newAssetFile({ assetId: duplicate.id, type: AssetFileType.Preview, path: dupPreview });
    existing.add(masterPath).add(dupPreview);
    // masterPreview deliberately missing on disk

    await expect(sut.handleApply({})).resolves.toBe(JobStatus.Success);

    // the original was linked and its duplicate copy queued for deletion...
    expect(queuedDeletes()).toEqual([dupPath]);
    // ...but the duplicate's preview is untouched: its row still points at its own file
    const previewRow = await database
      .selectFrom('asset_file')
      .select(['path', 'physicalFileId'])
      .where('assetId', '=', duplicate.id)
      .where('type', '=', AssetFileType.Preview)
      .executeTakeFirstOrThrow();
    expect(previewRow).toEqual({ path: dupPreview, physicalFileId: null });
  });

  it('is idempotent: a rerun links nothing new and queues no additional deletes', async () => {
    const { sut, ctx, existing, newPair, queuedDeletes, getAssetLink } = await bootstrap();
    const { master, duplicate, masterPath, dupPath } = await newPair();

    const masterPreview = `/data/thumbs/${master.id}-preview.jpg`;
    const dupPreview = `/data/thumbs/${duplicate.id}-preview.jpg`;
    await ctx.newAssetFile({ assetId: master.id, type: AssetFileType.Preview, path: masterPreview });
    await ctx.newAssetFile({ assetId: duplicate.id, type: AssetFileType.Preview, path: dupPreview });
    existing.add(masterPath).add(masterPreview).add(dupPreview);

    await expect(sut.handleApply({})).resolves.toBe(JobStatus.Success);
    expect(queuedDeletes().sort()).toEqual([dupPath, dupPreview].sort());
    const afterFirstRun = await getAssetLink(duplicate.id);
    expect(afterFirstRun.originalPath).toBe(masterPath);
    expect(afterFirstRun.physicalOriginalFileId).not.toBeNull();

    ctx.getMock(JobRepository).queue.mockClear();
    await expect(sut.handleApply({})).resolves.toBe(JobStatus.Success);

    expect(queuedDeletes()).toEqual([]);
    await expect(getAssetLink(duplicate.id)).resolves.toEqual(afterFirstRun);
  });

  it('dry-run emits no FileDelete and mutates nothing', async () => {
    const { sut, ctx, existing, newPair, getAssetLink } = await bootstrap();
    const { duplicate, masterPath, dupPath } = await newPair();
    existing.add(masterPath);

    await expect(sut.handleDryRun({})).resolves.toBe(JobStatus.Success);

    expect(ctx.getMock(JobRepository).queue).not.toHaveBeenCalled();
    expect(ctx.getMock(StorageRepository).copyFile).not.toHaveBeenCalled();
    await expect(getAssetLink(duplicate.id)).resolves.toEqual({
      originalPath: dupPath,
      physicalOriginalFileId: null,
    });
    expect(ctx.getMock(SystemMetadataRepository).set).toHaveBeenCalledWith(
      SystemMetadataKey.PhysicalDeduplicationMigration,
      expect.objectContaining({ mode: 'dry-run', eligibleAssets: 1, deletedBytes: 0 }),
    );
  });

  it('suppresses physical deletion while another asset still references the file', async () => {
    const { sut, ctx, database, existing, dupUser, newPair, queuedDeletes, getAssetLink } = await bootstrap();
    const { duplicate, masterPath, dupPath } = await newPair();
    existing.add(masterPath);

    // A second asset still stores the same on-disk file at dupPath.
    const { asset: other } = await ctx.newAsset({ ownerId: dupUser.id, originalPath: dupPath });
    await ctx.newExif({ assetId: other.id, fileSizeInByte: 1000 });

    await expect(sut.handleApply({})).resolves.toBe(JobStatus.Success);
    expect(queuedDeletes()).toContain(dupPath);
    await expect(getAssetLink(duplicate.id)).resolves.toMatchObject({ originalPath: masterPath });

    // The FileDelete handler routes through deleteUnreferencedPath, which is
    // the refcount gate: while `other` still references dupPath, unlink must
    // not run.
    const unlink = vi.fn().mockResolvedValue(undefined);
    const physicalFileRepository = ctx.get(PhysicalFileRepository);
    await expect(physicalFileRepository.deleteUnreferencedPath(dupPath, unlink)).resolves.toEqual({
      deleted: false,
      references: 1,
    });
    expect(unlink).not.toHaveBeenCalled();

    // Once the last reference is gone the same call deletes.
    await database.deleteFrom('asset').where('id', '=', other.id).execute();
    await expect(physicalFileRepository.deleteUnreferencedPath(dupPath, unlink)).resolves.toEqual({
      deleted: true,
      references: 0,
    });
    expect(unlink).toHaveBeenCalledTimes(1);
  });
});

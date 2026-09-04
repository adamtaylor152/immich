import { Kysely } from 'kysely';
import { randomBytes, randomUUID } from 'node:crypto';
import { AssetFileType, PhysicalFileType } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PhysicalFileRepository } from 'src/repositories/physical-file.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { MediumTestContext, newMediumService } from 'test/medium.factory';
import { getActiveForkKyselyDB as getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(PhysicalFileRepository) };
};

const newAssetWithSize = async (ctx: MediumTestContext, ownerId: string, dto: object = {}) => {
  // the factory default originalPath is shared between assets; refcount tests
  // need a path unique to each asset
  const { asset } = await ctx.newAsset({ ownerId, originalPath: `/data/upload/${randomUUID()}.jpg`, ...dto });
  await ctx.newExif({ assetId: asset.id, fileSizeInByte: 1000 });
  return asset;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(PhysicalFileRepository.name, () => {
  describe('ensureOriginalPhysicalFile', () => {
    it('creates the row once and links the asset; a second call reuses it', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const asset = await newAssetWithSize(ctx, user.id);

      const first = await sut.ensureOriginalPhysicalFile(asset.id);
      expect(first).toMatchObject({
        canonicalAssetId: asset.id,
        path: asset.originalPath,
        type: PhysicalFileType.Original,
        sizeInBytes: 1000,
      });

      const second = await sut.ensureOriginalPhysicalFile(asset.id);
      expect(second?.id).toBe(first?.id);

      const rows = await defaultDatabase
        .selectFrom('physical_file')
        .select('id')
        .where('canonicalAssetId', '=', asset.id)
        .execute();
      expect(rows).toHaveLength(1);
    });

    it('refuses external, offline and trashed assets', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const trashed = await newAssetWithSize(ctx, user.id, { deletedAt: new Date() });
      const offline = await newAssetWithSize(ctx, user.id, { isOffline: true });

      await expect(sut.ensureOriginalPhysicalFile(trashed.id)).resolves.toBeUndefined();
      await expect(sut.ensureOriginalPhysicalFile(offline.id)).resolves.toBeUndefined();
    });
  });

  describe('upsertPhysicalFile', () => {
    it('is keyed by path: a re-upsert updates in place instead of inserting', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const asset = await newAssetWithSize(ctx, user.id);
      const path = `/data/thumbs/${randomUUID()}.jpg`;

      const first = await sut.upsertPhysicalFile({
        canonicalAssetId: asset.id,
        checksum: randomBytes(20),
        path,
        sizeInBytes: 100,
        type: PhysicalFileType.Preview,
      });
      const second = await sut.upsertPhysicalFile({
        canonicalAssetId: asset.id,
        checksum: randomBytes(20),
        path,
        sizeInBytes: 200,
        type: PhysicalFileType.Preview,
      });

      expect(second.id).toBe(first.id);
      expect(second.sizeInBytes).toBe(200);
    });
  });

  describe('deleteUnreferencedPath (refcount gate)', () => {
    it('counts asset originalPath references and refuses to unlink while any remain', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const asset = await newAssetWithSize(ctx, user.id);
      const physicalFile = await sut.ensureOriginalPhysicalFile(asset.id);
      const unlink = vi.fn().mockResolvedValue(undefined);

      await expect(sut.deleteUnreferencedPath(asset.originalPath, unlink)).resolves.toMatchObject({
        deleted: false,
      });
      expect(unlink).not.toHaveBeenCalled();

      await defaultDatabase.deleteFrom('asset').where('id', '=', asset.id).execute();
      await expect(sut.deleteUnreferencedPath(asset.originalPath, unlink)).resolves.toEqual({
        deleted: true,
        references: 0,
      });
      expect(unlink).toHaveBeenCalledTimes(1);
      // orphan physical_file row is cleaned up in the same transaction
      await expect(sut.getPhysicalFile(physicalFile!.id)).resolves.toBeUndefined();
    });

    it('counts asset_file references against generated files', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const asset = await newAssetWithSize(ctx, user.id);
      const path = `/data/thumbs/${randomUUID()}-preview.jpg`;
      await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path });
      const unlink = vi.fn().mockResolvedValue(undefined);

      await expect(sut.deleteUnreferencedPath(path, unlink)).resolves.toEqual({
        deleted: false,
        references: 1,
      });
      expect(unlink).not.toHaveBeenCalled();

      await defaultDatabase.deleteFrom('asset_file').where('path', '=', path).execute();
      await expect(sut.deleteUnreferencedPath(path, unlink)).resolves.toEqual({ deleted: true, references: 0 });
    });
  });

  describe('getMasterOriginalCandidate', () => {
    it('returns the matching active master copy deterministically', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const checksum = randomBytes(20);
      const master = await newAssetWithSize(ctx, user.id, { checksum });

      const first = await sut.getMasterOriginalCandidate(user.id, checksum, 1000);
      const second = await sut.getMasterOriginalCandidate(user.id, checksum, 1000);

      expect(first?.id).toBe(master.id);
      expect(second?.id).toBe(master.id);
    });

    it('ignores trashed and size-mismatched copies', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const trashedChecksum = randomBytes(20);
      await newAssetWithSize(ctx, user.id, { checksum: trashedChecksum, deletedAt: new Date() });
      await expect(sut.getMasterOriginalCandidate(user.id, trashedChecksum, 1000)).resolves.toBeUndefined();

      const liveChecksum = randomBytes(20);
      await newAssetWithSize(ctx, user.id, { checksum: liveChecksum });
      await expect(sut.getMasterOriginalCandidate(user.id, liveChecksum, 999)).resolves.toBeUndefined();
    });
  });

  describe('getCanonicalGeneratedFile', () => {
    it('resolves the master-owned generated file only for linked duplicates', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const master = await newAssetWithSize(ctx, user.id);
      const duplicate = await newAssetWithSize(ctx, user.id);
      const masterPhysical = await sut.ensureOriginalPhysicalFile(master.id);
      const generated = await sut.upsertPhysicalFile({
        canonicalAssetId: master.id,
        checksum: randomBytes(20),
        path: `/data/thumbs/${randomUUID()}-preview.jpg`,
        sizeInBytes: 100,
        type: PhysicalFileType.Preview,
      });

      // the master itself is canonical, so it never resolves through this path
      await expect(sut.getCanonicalGeneratedFile(master.id, AssetFileType.Preview)).resolves.toBeUndefined();
      // unlinked duplicate: nothing to resolve
      await expect(sut.getCanonicalGeneratedFile(duplicate.id, AssetFileType.Preview)).resolves.toBeUndefined();

      await sut.linkAssetToOriginalPhysicalFile(duplicate.id, masterPhysical!);
      await expect(sut.getCanonicalGeneratedFile(duplicate.id, AssetFileType.Preview)).resolves.toEqual({
        id: generated.id,
        path: generated.path,
      });
    });
  });

  describe('linkAssetToRecoveredOriginal', () => {
    it('creates a locked physical reference for an untracked recovered path', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const asset = await newAssetWithSize(ctx, user.id);
      const checksum = randomBytes(32);
      const recoveredPath = `/data/upload/${user.id}/${randomUUID()}.jpg`;

      const physical = await sut.linkAssetToRecoveredOriginal(asset.id, recoveredPath, checksum, 4321);
      const linked = await sut.getOriginalPhysicalFile(asset.id);

      expect(physical).toMatchObject({
        canonicalAssetId: asset.id,
        checksum,
        path: recoveredPath,
        sizeInBytes: 4321,
        type: PhysicalFileType.Original,
      });
      expect(linked?.id).toBe(physical.id);
    });
  });
});

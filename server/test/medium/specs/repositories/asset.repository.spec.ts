import { Kysely } from 'kysely';
import { AssetFileType, AssetMetadataKey, AssetOrder, AssetType, AssetVisibility } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { StackRepository } from 'src/repositories/stack.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { MediumTestContext, newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const addDescriptionPreviewState = async (ctx: MediumTestContext, assetId: string) => {
  await ctx.newJobStatus({ assetId });
  await ctx.newAssetFile({ assetId, type: AssetFileType.Preview, path: `${assetId}-preview.webp` });
};

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(AssetRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(AssetRepository.name, () => {
  describe('getTimeBucket', () => {
    it('should order assets by local day first and fileCreatedAt within each day', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user: { id: user.id } });

      const [{ asset: previousLocalDayAsset }, { asset: nextLocalDayEarlierAsset }, { asset: nextLocalDayLaterAsset }] =
        await Promise.all([
          ctx.newAsset({
            ownerId: user.id,
            fileCreatedAt: new Date('2026-03-09T00:30:00.000Z'),
            localDateTime: new Date('2026-03-08T22:30:00.000Z'),
          }),
          ctx.newAsset({
            ownerId: user.id,
            fileCreatedAt: new Date('2026-03-08T23:30:00.000Z'),
            localDateTime: new Date('2026-03-09T01:30:00.000Z'),
          }),
          ctx.newAsset({
            ownerId: user.id,
            fileCreatedAt: new Date('2026-03-08T23:45:00.000Z'),
            localDateTime: new Date('2026-03-09T01:45:00.000Z'),
          }),
        ]);

      await Promise.all([
        ctx.newExif({ assetId: previousLocalDayAsset.id, timeZone: 'UTC-2' }),
        ctx.newExif({ assetId: nextLocalDayEarlierAsset.id, timeZone: 'UTC+2' }),
        ctx.newExif({ assetId: nextLocalDayLaterAsset.id, timeZone: 'UTC+2' }),
      ]);

      const descendingBucket = await sut.getTimeBucket(
        '2026-03-01',
        { order: AssetOrder.Desc, userIds: [user.id], visibility: AssetVisibility.Timeline },
        auth,
      );
      expect(JSON.parse(descendingBucket.assets)).toEqual(
        expect.objectContaining({
          id: [nextLocalDayLaterAsset.id, nextLocalDayEarlierAsset.id, previousLocalDayAsset.id],
        }),
      );

      const ascendingBucket = await sut.getTimeBucket(
        '2026-03-01',
        { order: AssetOrder.Asc, userIds: [user.id], visibility: AssetVisibility.Timeline },
        auth,
      );
      expect(JSON.parse(ascendingBucket.assets)).toEqual(
        expect.objectContaining({
          id: [previousLocalDayAsset.id, nextLocalDayEarlierAsset.id, nextLocalDayLaterAsset.id],
        }),
      );
    });
  });

  describe('upsertExif', () => {
    it('should append to locked columns', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({
        assetId: asset.id,
        dateTimeOriginal: '2023-11-19T18:11:00',
        lockedProperties: ['dateTimeOriginal'],
      });

      await expect(
        ctx.database
          .selectFrom('asset_exif')
          .select('lockedProperties')
          .where('assetId', '=', asset.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ lockedProperties: ['dateTimeOriginal'] });

      await sut.upsertExif({
        exif: { assetId: asset.id, lockedProperties: ['description'] },
        lockedPropertiesBehavior: 'append',
      });

      await expect(
        ctx.database
          .selectFrom('asset_exif')
          .select('lockedProperties')
          .where('assetId', '=', asset.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ lockedProperties: ['description', 'dateTimeOriginal'] });
    });

    it('should deduplicate locked columns', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({
        assetId: asset.id,
        dateTimeOriginal: '2023-11-19T18:11:00',
        lockedProperties: ['dateTimeOriginal', 'description'],
      });

      await expect(
        ctx.database
          .selectFrom('asset_exif')
          .select('lockedProperties')
          .where('assetId', '=', asset.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ lockedProperties: ['dateTimeOriginal', 'description'] });

      await sut.upsertExif({
        exif: { assetId: asset.id, lockedProperties: ['description'] },
        lockedPropertiesBehavior: 'append',
      });

      await expect(
        ctx.database
          .selectFrom('asset_exif')
          .select('lockedProperties')
          .where('assetId', '=', asset.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ lockedProperties: ['description', 'dateTimeOriginal'] });
    });
  });

  describe('unlockProperties', () => {
    it('should unlock one property', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({
        assetId: asset.id,
        dateTimeOriginal: '2023-11-19T18:11:00',
        lockedProperties: ['dateTimeOriginal', 'description'],
      });

      await expect(
        ctx.database
          .selectFrom('asset_exif')
          .select('lockedProperties')
          .where('assetId', '=', asset.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ lockedProperties: ['dateTimeOriginal', 'description'] });

      await sut.unlockProperties(asset.id, ['dateTimeOriginal']);

      await expect(
        ctx.database
          .selectFrom('asset_exif')
          .select('lockedProperties')
          .where('assetId', '=', asset.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ lockedProperties: ['description'] });
    });

    it('should unlock all properties', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({
        assetId: asset.id,
        dateTimeOriginal: '2023-11-19T18:11:00',
        lockedProperties: ['dateTimeOriginal', 'description'],
      });

      await expect(
        ctx.database
          .selectFrom('asset_exif')
          .select('lockedProperties')
          .where('assetId', '=', asset.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ lockedProperties: ['dateTimeOriginal', 'description'] });

      await sut.unlockProperties(asset.id, ['description', 'dateTimeOriginal']);

      await expect(
        ctx.database
          .selectFrom('asset_exif')
          .select('lockedProperties')
          .where('assetId', '=', asset.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ lockedProperties: null });
    });
  });

  describe('getDescriptionStats', () => {
    it('should only count images with an asset_job_status row and a preview file', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      const baseline = await sut.getDescriptionStats();

      // Eligible: image with job status + preview
      const { asset: eligible } = await ctx.newAsset({ ownerId: user.id });
      await addDescriptionPreviewState(ctx, eligible.id);

      // Ineligible: no asset_job_status row
      await ctx.newAsset({ ownerId: user.id });

      // Ineligible: video (type mismatch)
      const { asset: video } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video });
      await addDescriptionPreviewState(ctx, video.id);

      // Ineligible: hidden asset (excluded by withDefaultVisibility)
      const { asset: hidden } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Hidden });
      await addDescriptionPreviewState(ctx, hidden.id);

      const stats = await sut.getDescriptionStats();
      expect(stats.totalAssets - baseline.totalAssets).toBe(1);
      expect(stats.withDescription - baseline.withDescription).toBe(0);
      expect(stats.withoutDescription - baseline.withoutDescription).toBe(1);
    });

    it('should count eligible assets with a successful description as withDescription', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      const baseline = await sut.getDescriptionStats();

      const { asset: described } = await ctx.newAsset({ ownerId: user.id });
      await addDescriptionPreviewState(ctx, described.id);
      await ctx.newMetadata({
        assetId: described.id,
        key: AssetMetadataKey.MlEnrichment,
        value: { description: { status: 'success' } },
      });

      const stats = await sut.getDescriptionStats();
      expect(stats.totalAssets - baseline.totalAssets).toBe(1);
      expect(stats.withDescription - baseline.withDescription).toBe(1);
      expect(stats.withoutDescription - baseline.withoutDescription).toBe(0);
    });
  });

  describe('deleteAll', () => {
    it('should delete stacked assets', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const [{ asset: primary }, { asset: child }] = await Promise.all([
        ctx.newAsset({ ownerId: user.id }),
        ctx.newAsset({ ownerId: user.id }),
      ]);
      // `stack.primaryAssetId` has no ON DELETE action, so the stack has to be
      // removed before the assets it points at.
      await ctx.get(StackRepository).create({ ownerId: user.id }, [primary.id, child.id]);

      const deleted = await sut.deleteAll(user.id);

      expect(deleted).toHaveLength(2);
      await expect(sut.getByIds([primary.id, child.id])).resolves.toEqual([]);
    });
  });
});

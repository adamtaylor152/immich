import { Kysely } from 'kysely';
import { AssetMetadataKey, AssetType, SyncEntityType, SyncRequestType } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ForkSchemaRepository } from 'src/repositories/fork-schema.repository';
import { PartnerRepository } from 'src/repositories/partner.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getActiveForkKyselyDB as getKyselyDB, wait } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = async (db?: Kysely<DB>) => {
  const ctx = new SyncTestContext(db || defaultDatabase);
  const { auth, user, session } = await ctx.newSyncAuthUser();
  return { auth, user, session, ctx };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const nsfwMetadata = (isNsfw: boolean) => ({
  nsfwDetection: {
    status: 'success',
    result: { isNsfw, score: 0.99, labels: { explicit: 0.99 } },
  },
});

describe(SyncRequestType.PartnerAssetsV2, () => {
  it('should detect and sync the first partner asset', async () => {
    const { auth, ctx } = await setup();

    const originalFileName = 'firstPartnerAsset';
    const checksum = '1115vHcVkZzNp3Q9G+FEA0nu6zUbGb4Tj4UOXkN0wRA=';
    const legacyChecksum = 'EREREREREREREREREREREQ==';
    const thumbhash = '2225vHcVkZzNp3Q9G+FEA0nu6zUbGb4Tj4UOXkN0wRA=';
    const date = new Date().toISOString();

    const { user: user2 } = await ctx.newUser();
    const { asset } = await ctx.newAsset({
      ownerId: user2.id,
      originalFileName,
      checksum: Buffer.from(checksum, 'base64'),
      thumbhash: Buffer.from(thumbhash, 'base64'),
      fileCreatedAt: date,
      fileModifiedAt: date,
      localDateTime: date,
      createdAt: date,
      deletedAt: null,
      duration: 600_000,
      libraryId: null,
    });
    await ctx.get(ForkSchemaRepository).recordAssetChecksums({
      assetId: asset.id,
      sha1: Buffer.from(legacyChecksum, 'base64'),
      sha256: Buffer.from(checksum, 'base64'),
      sizeInBytes: 1,
      path: asset.originalPath,
      source: 'upload',
    });

    await ctx.newPartner({ sharedById: user2.id, sharedWithId: auth.user.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.PartnerAssetsV2]);
    expect(response).toEqual([
      {
        ack: expect.any(String),
        data: {
          id: asset.id,
          ownerId: asset.ownerId,
          originalFileName,
          thumbhash,
          checksum: legacyChecksum,
          deletedAt: null,
          fileCreatedAt: date,
          fileModifiedAt: date,
          createdAt: date,
          isFavorite: false,
          localDateTime: date,
          type: asset.type,
          visibility: asset.visibility,
          duration: asset.duration,
          isEdited: asset.isEdited,
          stackId: null,
          livePhotoVideoId: null,
          libraryId: asset.libraryId,
          width: null,
          height: null,
        },
        type: SyncEntityType.PartnerAssetV2,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, response);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.PartnerAssetsV2]);
  });

  it('should detect and sync a deleted partner asset', async () => {
    const { auth, ctx } = await setup();
    const assetRepo = ctx.get(AssetRepository);

    const { user: user2 } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user2.id });
    await ctx.newPartner({ sharedById: user2.id, sharedWithId: auth.user.id });
    await assetRepo.remove(asset);

    const response = await ctx.syncStream(auth, [SyncRequestType.PartnerAssetsV2]);
    expect(response).toEqual([
      {
        ack: expect.any(String),
        data: {
          assetId: asset.id,
        },
        type: SyncEntityType.PartnerAssetDeleteV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, response);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.PartnerAssetsV2]);
  });

  it('should not sync a deleted partner asset due to a user delete', async () => {
    const { auth, ctx } = await setup();
    const userRepo = ctx.get(UserRepository);

    const { user: user2 } = await ctx.newUser();
    await ctx.newPartner({ sharedById: user2.id, sharedWithId: auth.user.id });
    await ctx.newAsset({ ownerId: user2.id });
    await userRepo.delete({ id: user2.id }, true);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.PartnerAssetsV2]);
  });

  it('should not sync a deleted partner asset due to a partner delete (unshare)', async () => {
    const { auth, ctx } = await setup();
    const partnerRepo = ctx.get(PartnerRepository);

    const { user: user2 } = await ctx.newUser();
    await ctx.newAsset({ ownerId: user2.id });
    const { partner } = await ctx.newPartner({ sharedById: user2.id, sharedWithId: auth.user.id });
    await expect(ctx.syncStream(auth, [SyncRequestType.PartnerAssetsV2])).resolves.toEqual([
      expect.objectContaining({ type: SyncEntityType.PartnerAssetV2 }),
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
    await partnerRepo.remove(partner);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.PartnerAssetsV2]);
  });

  it('should not sync an asset or asset delete for own user', async () => {
    const { auth, ctx } = await setup();
    const assetRepo = ctx.get(AssetRepository);

    const { user: user2 } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id });
    await ctx.newPartner({ sharedById: user2.id, sharedWithId: auth.user.id });

    await expect(ctx.syncStream(auth, [SyncRequestType.AssetsV2])).resolves.toEqual([
      expect.objectContaining({ type: SyncEntityType.AssetV2 }),
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.PartnerAssetsV2]);

    await assetRepo.remove(asset);

    await expect(ctx.syncStream(auth, [SyncRequestType.AssetsV2])).resolves.toEqual([
      expect.objectContaining({ type: SyncEntityType.AssetDeleteV1 }),
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.PartnerAssetsV2]);
  });

  it('should not sync an asset or asset delete for unrelated user', async () => {
    const { auth, ctx } = await setup();
    const assetRepo = ctx.get(AssetRepository);

    const { user: user2 } = await ctx.newUser();
    const { session } = await ctx.newSession({ userId: user2.id });
    const { asset } = await ctx.newAsset({ ownerId: user2.id });
    const auth2 = factory.auth({ session, user: user2 });

    await expect(ctx.syncStream(auth2, [SyncRequestType.AssetsV2])).resolves.toEqual([
      expect.objectContaining({ type: SyncEntityType.AssetV2 }),
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.PartnerAssetsV2]);

    await assetRepo.remove(asset);

    await expect(ctx.syncStream(auth2, [SyncRequestType.AssetsV2])).resolves.toEqual([
      expect.objectContaining({ type: SyncEntityType.AssetDeleteV1 }),
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.PartnerAssetsV2]);
  });

  it('should hide NSFW Live Photo motion IDs from non-elevated partner asset sync', async () => {
    const { auth, ctx } = await setup();
    const { user: partner } = await ctx.newUser();
    const { asset: safeMotion } = await ctx.newAsset({ ownerId: partner.id, type: AssetType.Video });
    const { asset: nsfwMotion } = await ctx.newAsset({ ownerId: partner.id, type: AssetType.Video });
    const { asset: safePhoto } = await ctx.newAsset({ ownerId: partner.id, livePhotoVideoId: safeMotion.id });
    const { asset: nsfwMotionPhoto } = await ctx.newAsset({ ownerId: partner.id, livePhotoVideoId: nsfwMotion.id });
    await ctx.newPartner({ sharedById: partner.id, sharedWithId: auth.user.id });
    await ctx.newMetadata({
      assetId: nsfwMotion.id,
      key: AssetMetadataKey.MlEnrichment,
      value: nsfwMetadata(true),
    });

    const hiddenResponse = await ctx.syncStream({ ...auth, hideNsfwAssets: true }, [SyncRequestType.PartnerAssetsV2]);
    const hiddenAssets = hiddenResponse
      .filter(({ type }) => type === SyncEntityType.PartnerAssetV2)
      .map(({ data }) => data);

    expect(hiddenAssets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: safePhoto.id, livePhotoVideoId: safeMotion.id }),
        expect.objectContaining({ id: nsfwMotionPhoto.id, livePhotoVideoId: null }),
      ]),
    );
    expect(hiddenAssets.map(({ id }) => id)).not.toContain(nsfwMotion.id);

    const elevatedResponse = await ctx.syncStream(auth, [SyncRequestType.PartnerAssetsV2]);
    expect(elevatedResponse).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ id: nsfwMotionPhoto.id, livePhotoVideoId: nsfwMotion.id }),
          type: SyncEntityType.PartnerAssetV2,
        }),
      ]),
    );
  });

  it('should exclude NSFW partner assets from a non-elevated sync but include them for an elevated one', async () => {
    const { auth, ctx } = await setup();
    const { user: partner } = await ctx.newUser();
    const { asset: safeAsset } = await ctx.newAsset({ ownerId: partner.id });
    const { asset: nsfwAsset } = await ctx.newAsset({ ownerId: partner.id });
    await ctx.newPartner({ sharedById: partner.id, sharedWithId: auth.user.id });
    await ctx.newMetadata({
      assetId: nsfwAsset.id,
      key: AssetMetadataKey.MlEnrichment,
      value: nsfwMetadata(true),
    });

    const hiddenResponse = await ctx.syncStream({ ...auth, hideNsfwAssets: true }, [SyncRequestType.PartnerAssetsV2]);
    const hiddenIds = hiddenResponse
      .filter(({ type }) => type === SyncEntityType.PartnerAssetV2)
      .map(({ data }) => (data as { id: string }).id);
    expect(hiddenIds).toContain(safeAsset.id);
    expect(hiddenIds).not.toContain(nsfwAsset.id);

    const elevatedResponse = await ctx.syncStream(auth, [SyncRequestType.PartnerAssetsV2]);
    const elevatedIds = elevatedResponse
      .filter(({ type }) => type === SyncEntityType.PartnerAssetV2)
      .map(({ data }) => (data as { id: string }).id);
    expect(elevatedIds).toContain(safeAsset.id);
    expect(elevatedIds).toContain(nsfwAsset.id);
  });

  it('should exclude NSFW partner assets from a non-elevated backfill but include them for an elevated one', async () => {
    const { auth, ctx } = await setup();
    const { user: partner1 } = await ctx.newUser();
    const { user: partner2 } = await ctx.newUser();
    const { asset: safeBackfillAsset } = await ctx.newAsset({ ownerId: partner2.id });
    const { asset: nsfwBackfillAsset } = await ctx.newAsset({ ownerId: partner2.id });
    await ctx.newMetadata({
      assetId: nsfwBackfillAsset.id,
      key: AssetMetadataKey.MlEnrichment,
      value: nsfwMetadata(true),
    });
    await wait(2);
    await ctx.newAsset({ ownerId: partner1.id });
    await ctx.newPartner({ sharedById: partner1.id, sharedWithId: auth.user.id });

    const initialResponse = await ctx.syncStream(auth, [SyncRequestType.PartnerAssetsV2]);
    await ctx.syncAckAll(auth, initialResponse);

    // second partner share triggers a backfill of their older assets
    await ctx.newPartner({ sharedById: partner2.id, sharedWithId: auth.user.id });

    const hiddenResponse = await ctx.syncStream({ ...auth, hideNsfwAssets: true }, [SyncRequestType.PartnerAssetsV2]);
    const hiddenIds = hiddenResponse
      .filter(({ type }) => type === SyncEntityType.PartnerAssetBackfillV2)
      .map(({ data }) => (data as { id: string }).id);
    expect(hiddenIds).toContain(safeBackfillAsset.id);
    expect(hiddenIds).not.toContain(nsfwBackfillAsset.id);

    const elevatedResponse = await ctx.syncStream(auth, [SyncRequestType.PartnerAssetsV2]);
    const elevatedIds = elevatedResponse
      .filter(({ type }) => type === SyncEntityType.PartnerAssetBackfillV2)
      .map(({ data }) => (data as { id: string }).id);
    expect(elevatedIds).toContain(safeBackfillAsset.id);
    expect(elevatedIds).toContain(nsfwBackfillAsset.id);
  });

  it('should backfill partner assets when a partner shared their library with you', async () => {
    const { auth, ctx } = await setup();

    const { user: user2 } = await ctx.newUser();
    const { user: user3 } = await ctx.newUser();
    const { asset: assetUser3 } = await ctx.newAsset({ ownerId: user3.id });
    await wait(2);
    const { asset: assetUser2 } = await ctx.newAsset({ ownerId: user2.id });
    await ctx.newPartner({ sharedById: user2.id, sharedWithId: auth.user.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.PartnerAssetsV2]);
    expect(response).toEqual([
      {
        ack: expect.any(String),
        data: expect.objectContaining({
          id: assetUser2.id,
        }),
        type: SyncEntityType.PartnerAssetV2,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, response);
    await ctx.newPartner({ sharedById: user3.id, sharedWithId: auth.user.id });

    const newResponse = await ctx.syncStream(auth, [SyncRequestType.PartnerAssetsV2]);
    expect(newResponse).toEqual([
      {
        ack: expect.any(String),
        data: expect.objectContaining({
          id: assetUser3.id,
        }),
        type: SyncEntityType.PartnerAssetBackfillV2,
      },
      {
        ack: expect.stringContaining(SyncEntityType.PartnerAssetBackfillV2),
        data: {},
        type: SyncEntityType.SyncAckV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, newResponse);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.PartnerAssetsV2]);
  });

  it('should only backfill partner assets created prior to the current partner asset checkpoint', async () => {
    const { auth, ctx } = await setup();

    const { user: user2 } = await ctx.newUser();
    const { user: user3 } = await ctx.newUser();
    const { asset: assetUser3 } = await ctx.newAsset({ ownerId: user3.id });
    await wait(2);
    const { asset: assetUser2 } = await ctx.newAsset({ ownerId: user2.id });
    await wait(2);
    const { asset: asset2User3 } = await ctx.newAsset({ ownerId: user3.id });
    await ctx.newPartner({ sharedById: user2.id, sharedWithId: auth.user.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.PartnerAssetsV2]);
    expect(response).toEqual([
      {
        ack: expect.any(String),
        data: expect.objectContaining({
          id: assetUser2.id,
        }),
        type: SyncEntityType.PartnerAssetV2,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
    await ctx.syncAckAll(auth, response);

    await ctx.newPartner({ sharedById: user3.id, sharedWithId: auth.user.id });
    const newResponse = await ctx.syncStream(auth, [SyncRequestType.PartnerAssetsV2]);
    expect(newResponse).toEqual([
      {
        ack: expect.any(String),
        data: expect.objectContaining({
          id: assetUser3.id,
        }),
        type: SyncEntityType.PartnerAssetBackfillV2,
      },
      {
        ack: expect.stringContaining(SyncEntityType.PartnerAssetBackfillV2),
        data: {},
        type: SyncEntityType.SyncAckV1,
      },
      {
        ack: expect.any(String),
        data: expect.objectContaining({
          id: asset2User3.id,
        }),
        type: SyncEntityType.PartnerAssetV2,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, newResponse);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.PartnerAssetsV2]);
  });

  it('should not resend an already-acked item when backfill resumes', async () => {
    const { auth, ctx } = await setup();
    const { user: user2 } = await ctx.newUser();
    const { user: user3 } = await ctx.newUser();

    // backfill needs assets with an older updateId
    const { asset: partnerAsset1 } = await ctx.newAsset({ ownerId: user3.id });
    await wait(2);
    const { asset: partnerAsset2 } = await ctx.newAsset({ ownerId: user3.id });

    await wait(2);

    // backfill needs an initial ack, otherwise it syncs everything
    const { asset: initialAsset } = await ctx.newAsset({ ownerId: user2.id });
    await ctx.newPartner({ sharedById: user2.id, sharedWithId: auth.user.id });

    const setupResponse = await ctx.syncStream(auth, [SyncRequestType.PartnerAssetsV2]);
    expect(setupResponse).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ id: initialAsset.id }),
        type: SyncEntityType.PartnerAssetV2,
      }),
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
    await ctx.syncAckAll(auth, setupResponse);

    // partner share to trigger backfill
    await ctx.newPartner({ sharedById: user3.id, sharedWithId: auth.user.id });

    const response1 = await ctx.syncStream(auth, [SyncRequestType.PartnerAssetsV2]);
    expect(response1).toEqual([
      // receive both
      expect.objectContaining({
        data: expect.objectContaining({ id: partnerAsset1.id }),
        type: SyncEntityType.PartnerAssetBackfillV2,
      }),
      expect.objectContaining({
        data: expect.objectContaining({ id: partnerAsset2.id }),
        type: SyncEntityType.PartnerAssetBackfillV2,
      }),
      expect.objectContaining({ type: SyncEntityType.SyncAckV1 }),
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    // ack 1st
    await ctx.sut.setAcks(auth, { acks: [response1[0].ack] });

    const response2 = await ctx.syncStream(auth, [SyncRequestType.PartnerAssetsV2]);
    expect(response2).toEqual([
      // receive 2nd
      expect.objectContaining({
        data: expect.objectContaining({ id: partnerAsset2.id }),
        type: SyncEntityType.PartnerAssetBackfillV2,
      }),
      expect.objectContaining({ type: SyncEntityType.SyncAckV1 }),
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, response2);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.PartnerAssetsV2]);
  });

  it('should hide isFavorite for partner assets', async () => {
    const { auth, ctx } = await setup();
    const { user: user2 } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user2.id, isFavorite: true });
    await ctx.newPartner({ sharedById: user2.id, sharedWithId: auth.user.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.PartnerAssetsV2]);
    expect(response).toEqual([
      {
        ack: expect.any(String),
        data: expect.objectContaining({ id: asset.id, isFavorite: false }),
        type: SyncEntityType.PartnerAssetV2,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
  });
});

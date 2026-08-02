import { Kysely } from 'kysely';
import { randomBytes } from 'node:crypto';
import { SystemConfig } from 'src/config';
import { AssetMediaStatus, AssetRejectReason, AssetUploadAction } from 'src/dtos/asset-media-response.dto';
import { AssetMediaSize } from 'src/dtos/asset-media.dto';
import { AlbumUserRole, AssetFileType, AssetMetadataKey, AssetType, ChecksumAlgorithm, SharedLinkType } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { ForkSchemaRepository } from 'src/repositories/fork-schema.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedLinkRepository } from 'src/repositories/shared-link.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { TagRepository } from 'src/repositories/tag.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { AssetMediaService } from 'src/services/asset-media.service';
import { AssetService } from 'src/services/asset.service';
import { ImmichFileResponse } from 'src/utils/file';
import { upsertTags } from 'src/utils/tag';
import { mediumFactory, newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getActiveForkKyselyDB as getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const result = newMediumService(AssetMediaService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      AlbumRepository,
      AssetRepository,
      ConfigRepository,
      SharedLinkRepository,
      SystemMetadataRepository,
      TagRepository,
      UserRepository,
    ],
    mock: [EventRepository, ForkSchemaRepository, LoggingRepository, JobRepository, StorageRepository],
  });

  // automock returns undefined for everything, so restore the two behaviours
  // the service actually relies on: config passthrough, and "no sha1
  // translations recorded" for the duplicate pre-check.
  const forkSchema = result.ctx.getMock(ForkSchemaRepository);
  forkSchema.overlayConfig.mockImplementation((config: SystemConfig) => Promise.resolve(config));
  forkSchema.getChecksumTranslations.mockResolvedValue([]);

  return result;
};

const nsfwMetadata = (isNsfw: boolean, review?: { action: string; isNsfw: boolean }) => ({
  nsfwDetection: {
    status: 'success',
    result: { isNsfw, score: isNsfw ? 0.95 : 0.05, labels: { explicit: isNsfw ? 0.95 : 0.05 } },
    ...(review && { review }),
  },
});

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(AssetService.name, () => {
  describe('uploadAsset', () => {
    it('should work', async () => {
      const { sut, ctx } = setup();

      ctx.getMock(StorageRepository).utimes.mockResolvedValue();
      ctx.getMock(EventRepository).emit.mockResolvedValue();
      ctx.getMock(JobRepository).queue.mockResolvedValue();

      const fileSizeInByte = 12_345;

      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, fileSizeInByte });
      const auth = factory.auth({ user: { id: user.id } });

      await expect(
        sut.uploadAsset(
          auth,
          {
            fileModifiedAt: new Date(),
            fileCreatedAt: new Date(),
            assetData: Buffer.from('some data'),
          },
          mediumFactory.uploadFile({ size: fileSizeInByte }),
        ),
      ).resolves.toEqual({
        id: expect.any(String),
        status: AssetMediaStatus.CREATED,
      });

      expect(ctx.getMock(EventRepository).emit).toHaveBeenCalledWith('AssetCreate', {
        asset: expect.objectContaining({}),
        file: expect.objectContaining({ size: fileSizeInByte }),
      });
    });

    it('records SHA-256 (32-byte checksum + sha256File algorithm) for new uploads', async () => {
      const { sut, ctx } = setup();

      ctx.getMock(StorageRepository).utimes.mockResolvedValue();
      ctx.getMock(EventRepository).emit.mockResolvedValue();
      ctx.getMock(JobRepository).queue.mockResolvedValue();

      const { user } = await ctx.newUser();
      const auth = factory.auth({ user: { id: user.id } });
      // 32 bytes — what file-upload.interceptor.ts emits after switching to sha256.
      const sha256 = randomBytes(32);
      const response = await sut.uploadAsset(
        auth,
        { fileModifiedAt: new Date(), fileCreatedAt: new Date(), assetData: Buffer.from('some data') },
        mediumFactory.uploadFile({ checksum: sha256 }),
      );

      expect(response.status).toBe(AssetMediaStatus.CREATED);

      const created = await ctx.get(AssetRepository).getById(response.id);
      expect(created).not.toBeNull();
      expect(created!.checksumAlgorithm).toBe(ChecksumAlgorithm.sha256File);
      expect(created!.checksum).toBeInstanceOf(Buffer);
      expect(created!.checksum.length).toBe(32);
      expect(created!.checksum.equals(sha256)).toBe(true);
    });

    it('preserves legacy SHA-1 rows when a new SHA-256 row with the same content is uploaded', async () => {
      // Mixed-algorithm rows must NOT dedup with each other: the digest bytes
      // differ (20 vs 32 bytes), and dedup keys on full bytes — so a fresh
      // SHA-256 upload of the same content as a legacy SHA-1 asset becomes its
      // own master rather than linking. The legacy row is untouched.
      const { sut, ctx } = setup();

      ctx.getMock(StorageRepository).utimes.mockResolvedValue();
      ctx.getMock(EventRepository).emit.mockResolvedValue();
      ctx.getMock(JobRepository).queue.mockResolvedValue();

      const { user } = await ctx.newUser();
      const legacySha1 = randomBytes(20);
      const { asset: legacyAsset } = await ctx.newAsset({
        ownerId: user.id,
        checksum: legacySha1,
        checksumAlgorithm: ChecksumAlgorithm.sha1File,
      });

      const auth = factory.auth({ user: { id: user.id } });
      const newSha256 = randomBytes(32);
      const response = await sut.uploadAsset(
        auth,
        { fileModifiedAt: new Date(), fileCreatedAt: new Date(), assetData: Buffer.from('some data') },
        mediumFactory.uploadFile({ checksum: newSha256 }),
      );

      expect(response.id).not.toBe(legacyAsset.id);
      expect(response.status).toBe(AssetMediaStatus.CREATED);

      const refetched = await ctx.get(AssetRepository).getById(legacyAsset.id);
      expect(refetched!.checksumAlgorithm).toBe(ChecksumAlgorithm.sha1File);
      expect(refetched!.checksum.length).toBe(20);
      expect(refetched!.checksum.equals(legacySha1)).toBe(true);
    });

    it('rejects an exact SHA-256 duplicate within the same owner (dedup on the new algo)', async () => {
      const { sut, ctx } = setup();

      ctx.getMock(StorageRepository).utimes.mockResolvedValue();
      ctx.getMock(EventRepository).emit.mockResolvedValue();
      ctx.getMock(JobRepository).queue.mockResolvedValue();

      const { user } = await ctx.newUser();
      const sha256 = randomBytes(32);
      const { asset: existing } = await ctx.newAsset({
        ownerId: user.id,
        checksum: sha256,
        checksumAlgorithm: ChecksumAlgorithm.sha256File,
      });

      const auth = factory.auth({ user: { id: user.id } });
      const response = await sut.uploadAsset(
        auth,
        { fileModifiedAt: new Date(), fileCreatedAt: new Date(), assetData: Buffer.from('some data') },
        mediumFactory.uploadFile({ checksum: sha256 }),
      );

      expect(response).toEqual({ id: existing.id, status: AssetMediaStatus.DUPLICATE });
    });

    it('should work with an empty metadata list', async () => {
      const { sut, ctx } = setup();

      ctx.getMock(StorageRepository).utimes.mockResolvedValue();
      ctx.getMock(EventRepository).emit.mockResolvedValue();
      ctx.getMock(JobRepository).queue.mockResolvedValue();

      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, fileSizeInByte: 12_345 });
      const auth = factory.auth({ user: { id: user.id } });
      const file = mediumFactory.uploadFile();

      await expect(
        sut.uploadAsset(
          auth,
          {
            fileModifiedAt: new Date(),
            fileCreatedAt: new Date(),
            assetData: Buffer.from('some data'),
            metadata: [],
          },
          file,
        ),
      ).resolves.toEqual({
        id: expect.any(String),
        status: AssetMediaStatus.CREATED,
      });
    });

    it('should add to a shared link', async () => {
      const { sut, ctx } = setup();

      const sharedLinkRepo = ctx.get(SharedLinkRepository);

      ctx.getMock(StorageRepository).utimes.mockResolvedValue();
      ctx.getMock(EventRepository).emit.mockResolvedValue();
      ctx.getMock(JobRepository).queue.mockResolvedValue();

      const { user } = await ctx.newUser();

      const sharedLink = await sharedLinkRepo.create({
        key: randomBytes(50),
        type: SharedLinkType.Individual,
        description: 'Shared link description',
        userId: user.id,
        allowDownload: true,
        allowUpload: true,
      });

      const auth = factory.auth({ user: { id: user.id }, sharedLink });
      const file = mediumFactory.uploadFile();
      const uploadDto = {
        fileModifiedAt: new Date(),
        fileCreatedAt: new Date(),
        assetData: Buffer.from('some data'),
      };

      const response = await sut.uploadAsset(auth, uploadDto, file);
      expect(response).toEqual({ id: expect.any(String), status: AssetMediaStatus.CREATED });

      const update = await sharedLinkRepo.get(user.id, sharedLink.id);
      const assets = update!.assets;
      expect(assets).toHaveLength(1);
      expect(assets[0]).toMatchObject({ id: response.id });
    });

    it('should handle adding a duplicate asset to a shared link', async () => {
      const { sut, ctx } = setup();

      ctx.getMock(StorageRepository).utimes.mockResolvedValue();
      ctx.getMock(EventRepository).emit.mockResolvedValue();
      ctx.getMock(JobRepository).queue.mockResolvedValue();

      const sharedLinkRepo = ctx.get(SharedLinkRepository);

      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, fileSizeInByte: 12_345 });

      const sharedLink = await sharedLinkRepo.create({
        key: randomBytes(50),
        type: SharedLinkType.Individual,
        description: 'Shared link description',
        userId: user.id,
        allowDownload: true,
        allowUpload: true,
        assetIds: [asset.id],
      });

      const auth = factory.auth({ user: { id: user.id }, sharedLink });
      const uploadDto = {
        fileModifiedAt: new Date(),
        fileCreatedAt: new Date(),
        assetData: Buffer.from('some data'),
      };

      const response = await sut.uploadAsset(auth, uploadDto, mediumFactory.uploadFile({ checksum: asset.checksum }));
      expect(response).toEqual({ id: expect.any(String), status: AssetMediaStatus.DUPLICATE });

      const update = await sharedLinkRepo.get(user.id, sharedLink.id);
      const assets = update!.assets;
      expect(assets).toHaveLength(1);
      expect(assets[0]).toMatchObject({ id: response.id });
    });

    it('should add to an album shared link', async () => {
      const { sut, ctx } = setup();

      const sharedLinkRepo = ctx.get(SharedLinkRepository);

      ctx.getMock(StorageRepository).utimes.mockResolvedValue();
      ctx.getMock(EventRepository).emit.mockResolvedValue();
      ctx.getMock(JobRepository).queue.mockResolvedValue();

      const { user } = await ctx.newUser();
      const { album } = await ctx.newAlbum({ ownerId: user.id });

      const sharedLink = await sharedLinkRepo.create({
        key: randomBytes(50),
        type: SharedLinkType.Album,
        albumId: album.id,
        description: 'Shared link description',
        userId: user.id,
        allowDownload: true,
        allowUpload: true,
      });

      const auth = factory.auth({ user: { id: user.id }, sharedLink });
      const uploadDto = {
        fileModifiedAt: new Date(),
        fileCreatedAt: new Date(),
        assetData: Buffer.from('some data'),
      };

      const response = await sut.uploadAsset(auth, uploadDto, mediumFactory.uploadFile());
      expect(response).toEqual({ id: expect.any(String), status: AssetMediaStatus.CREATED });

      const result = await ctx.get(AlbumRepository).getAssetIds(album.id, [response.id]);
      const assets = [...result];
      expect(assets).toHaveLength(1);
      expect(assets[0]).toEqual(response.id);

      expect(ctx.getMock(EventRepository).emit).toHaveBeenCalledWith('AlbumUpdate', {
        id: album.id,
        userIds: [user.id],
        recipientIds: [user.id],
      });
    });

    it('should handle adding a duplicate asset to an album shared link', async () => {
      const { sut, ctx } = setup();

      const sharedLinkRepo = ctx.get(SharedLinkRepository);

      ctx.getMock(StorageRepository).utimes.mockResolvedValue();
      ctx.getMock(EventRepository).emit.mockResolvedValue();
      ctx.getMock(JobRepository).queue.mockResolvedValue();

      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { album } = await ctx.newAlbum({ ownerId: user.id }, [asset.id]);
      // await ctx.newExif({ assetId: asset.id, fileSizeInByte: 12_345 });

      const sharedLink = await sharedLinkRepo.create({
        key: randomBytes(50),
        type: SharedLinkType.Album,
        albumId: album.id,
        description: 'Shared link description',
        userId: user.id,
        allowDownload: true,
        allowUpload: true,
      });

      const auth = factory.auth({ user: { id: user.id }, sharedLink });
      const uploadDto = {
        fileModifiedAt: new Date(),
        fileCreatedAt: new Date(),
        assetData: Buffer.from('some data'),
      };

      const response = await sut.uploadAsset(auth, uploadDto, mediumFactory.uploadFile({ checksum: asset.checksum }));
      expect(response).toEqual({ id: expect.any(String), status: AssetMediaStatus.DUPLICATE });

      const result = await ctx.get(AlbumRepository).getAssetIds(album.id, [response.id]);
      const assets = [...result];
      expect(assets).toHaveLength(1);
      expect(assets[0]).toEqual(response.id);
    });
  });

  describe('duplicate checks', () => {
    it('should hide private NSFW checksum duplicates in hidden mode', async () => {
      const { sut, ctx } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();

      const { asset: visible } = await ctx.newAsset({ ownerId: user.id, checksum: randomBytes(20) });
      const { asset: unreviewedNsfw } = await ctx.newAsset({ ownerId: user.id, checksum: randomBytes(20) });
      const { asset: markedSafe } = await ctx.newAsset({ ownerId: user.id, checksum: randomBytes(20) });
      const { asset: markedNsfw } = await ctx.newAsset({ ownerId: user.id, checksum: randomBytes(20) });
      const { asset: tagOnly } = await ctx.newAsset({ ownerId: user.id, checksum: randomBytes(20) });

      await ctx.newMetadata({
        assetId: unreviewedNsfw.id,
        key: AssetMetadataKey.MlEnrichment,
        value: nsfwMetadata(true),
      });
      await ctx.newMetadata({
        assetId: markedSafe.id,
        key: AssetMetadataKey.MlEnrichment,
        value: nsfwMetadata(true, { action: 'marked-safe', isNsfw: false }),
      });
      await ctx.newMetadata({
        assetId: markedNsfw.id,
        key: AssetMetadataKey.MlEnrichment,
        value: nsfwMetadata(false, { action: 'marked-nsfw', isNsfw: true }),
      });

      const [visibleNsfwTag] = await upsertTags(ctx.get(TagRepository), { userId: user.id, tags: ['nsfw'] });
      await ctx.newTagAsset({ tagIds: [visibleNsfwTag.id], assetIds: [tagOnly.id] });

      const hiddenAuth = { ...factory.auth({ user: { id: user.id } }), hideNsfwAssets: true };

      await expect(sut.getUploadAssetIdByChecksum(hiddenAuth, visible.checksum.toString('hex'))).resolves.toEqual({
        id: visible.id,
        status: AssetMediaStatus.DUPLICATE,
      });
      await expect(
        sut.getUploadAssetIdByChecksum(hiddenAuth, unreviewedNsfw.checksum.toString('hex')),
      ).resolves.toBeUndefined();
      await expect(sut.getUploadAssetIdByChecksum(hiddenAuth, markedSafe.checksum.toString('hex'))).resolves.toEqual({
        id: markedSafe.id,
        status: AssetMediaStatus.DUPLICATE,
      });
      await expect(
        sut.getUploadAssetIdByChecksum(hiddenAuth, markedNsfw.checksum.toString('hex')),
      ).resolves.toBeUndefined();

      await expect(
        sut.bulkUploadCheck(hiddenAuth, {
          assets: [
            { id: 'visible', checksum: visible.checksum.toString('hex') },
            { id: 'unreviewed-nsfw', checksum: unreviewedNsfw.checksum.toString('hex') },
            { id: 'marked-safe', checksum: markedSafe.checksum.toString('hex') },
            { id: 'marked-nsfw', checksum: markedNsfw.checksum.toString('hex') },
            { id: 'tag-only', checksum: tagOnly.checksum.toString('hex') },
          ],
        }),
      ).resolves.toEqual({
        results: [
          {
            id: 'visible',
            action: AssetUploadAction.REJECT,
            reason: AssetRejectReason.DUPLICATE,
            assetId: visible.id,
            isTrashed: false,
          },
          { id: 'unreviewed-nsfw', action: AssetUploadAction.ACCEPT },
          {
            id: 'marked-safe',
            action: AssetUploadAction.REJECT,
            reason: AssetRejectReason.DUPLICATE,
            assetId: markedSafe.id,
            isTrashed: false,
          },
          { id: 'marked-nsfw', action: AssetUploadAction.ACCEPT },
          {
            id: 'tag-only',
            action: AssetUploadAction.REJECT,
            reason: AssetRejectReason.DUPLICATE,
            assetId: tagOnly.id,
            isTrashed: false,
          },
        ],
      });
    });

    it('should mark hidden NSFW duplicates without returning duplicate ids when upload hits the checksum constraint', async () => {
      const { sut, ctx } = setup(await getKyselyDB());

      ctx.getMock(StorageRepository).utimes.mockResolvedValue();
      ctx.getMock(EventRepository).emit.mockResolvedValue();
      ctx.getMock(JobRepository).queue.mockResolvedValue();

      const { user } = await ctx.newUser();
      const { asset: unreviewedNsfw } = await ctx.newAsset({ ownerId: user.id, checksum: randomBytes(20) });
      await ctx.newMetadata({
        assetId: unreviewedNsfw.id,
        key: AssetMetadataKey.MlEnrichment,
        value: nsfwMetadata(true),
      });

      const hiddenAuth = { ...factory.auth({ user: { id: user.id } }), hideNsfwAssets: true };
      const uploadDto = {
        fileModifiedAt: new Date(),
        fileCreatedAt: new Date(),
        assetData: Buffer.from('some data'),
      };

      await expect(
        sut.uploadAsset(hiddenAuth, uploadDto, mediumFactory.uploadFile({ checksum: unreviewedNsfw.checksum })),
      ).resolves.toEqual({ id: '00000000-0000-0000-0000-000000000000', status: AssetMediaStatus.DUPLICATE });
    });
  });

  describe('viewThumbnail', () => {
    it('should hide NSFW shared-link media using private review state', async () => {
      const { sut, ctx } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();

      const { asset: unreviewedNsfw } = await ctx.newAsset({ ownerId: user.id });
      const { asset: markedSafe } = await ctx.newAsset({ ownerId: user.id });
      const { asset: markedNsfw } = await ctx.newAsset({ ownerId: user.id });
      const { asset: tagOnly } = await ctx.newAsset({ ownerId: user.id });

      for (const assetId of [unreviewedNsfw.id, markedSafe.id, markedNsfw.id, tagOnly.id]) {
        await ctx.newExif({ assetId, fileSizeInByte: 12_345 });
        await ctx.newAssetFile({
          assetId,
          type: AssetFileType.Preview,
          path: `/${assetId}/preview.jpg`,
          isEdited: false,
        });
      }

      await ctx.newMetadata({
        assetId: unreviewedNsfw.id,
        key: AssetMetadataKey.MlEnrichment,
        value: nsfwMetadata(true),
      });
      await ctx.newMetadata({
        assetId: markedSafe.id,
        key: AssetMetadataKey.MlEnrichment,
        value: nsfwMetadata(true, { action: 'marked-safe', isNsfw: false }),
      });
      await ctx.newMetadata({
        assetId: markedNsfw.id,
        key: AssetMetadataKey.MlEnrichment,
        value: nsfwMetadata(false, { action: 'marked-nsfw', isNsfw: true }),
      });

      const [visibleNsfwTag] = await upsertTags(ctx.get(TagRepository), { userId: user.id, tags: ['nsfw'] });
      await ctx.newTagAsset({ tagIds: [visibleNsfwTag.id], assetIds: [tagOnly.id] });

      const sharedLink = await ctx.get(SharedLinkRepository).create({
        key: randomBytes(16),
        id: factory.uuid(),
        userId: user.id,
        allowDownload: true,
        allowUpload: false,
        type: SharedLinkType.Individual,
        assetIds: [unreviewedNsfw.id, markedSafe.id, markedNsfw.id, tagOnly.id],
      });

      const auth = { user, sharedLink, hideNsfwAssets: true };
      await expect(sut.viewThumbnail(auth, unreviewedNsfw.id, { size: AssetMediaSize.PREVIEW })).rejects.toThrow(
        'Not found or no asset.view access',
      );
      await expect(sut.viewThumbnail(auth, markedNsfw.id, { size: AssetMediaSize.PREVIEW })).rejects.toThrow(
        'Not found or no asset.view access',
      );
      await expect(sut.viewThumbnail(auth, markedSafe.id, { size: AssetMediaSize.PREVIEW })).resolves.toEqual(
        expect.objectContaining({ path: `/${markedSafe.id}/preview.jpg` }),
      );
      await expect(sut.downloadOriginal(auth, tagOnly.id, {})).resolves.toEqual(
        expect.objectContaining({ path: tagOnly.originalPath }),
      );
    });

    it('should hide NSFW Live Photo motion assets granted through safe photo membership', async () => {
      const { sut, ctx } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      const { user: albumViewer } = await ctx.newUser();

      const { asset: safeMotion } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video });
      const { asset: nsfwMotion } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video });
      const { asset: safePhoto } = await ctx.newAsset({ ownerId: user.id, livePhotoVideoId: safeMotion.id });
      const { asset: nsfwMotionPhoto } = await ctx.newAsset({ ownerId: user.id, livePhotoVideoId: nsfwMotion.id });

      await ctx.newMetadata({
        assetId: nsfwMotion.id,
        key: AssetMetadataKey.MlEnrichment,
        value: nsfwMetadata(true),
      });

      const { album } = await ctx.newAlbum({ ownerId: user.id }, [safePhoto.id, nsfwMotionPhoto.id]);
      await ctx.newAlbumUser({ albumId: album.id, userId: albumViewer.id, role: AlbumUserRole.Viewer });
      const sharedLink = await ctx.get(SharedLinkRepository).create({
        key: randomBytes(16),
        id: factory.uuid(),
        userId: user.id,
        allowDownload: true,
        allowUpload: false,
        type: SharedLinkType.Individual,
        assetIds: [safePhoto.id, nsfwMotionPhoto.id],
      });
      const albumSharedLink = await ctx.get(SharedLinkRepository).create({
        key: randomBytes(16),
        id: factory.uuid(),
        userId: user.id,
        allowDownload: true,
        allowUpload: false,
        type: SharedLinkType.Album,
        albumId: album.id,
      });

      const hiddenAuth = { ...factory.auth({ user: { id: user.id } }), hideNsfwAssets: true };
      await expect(sut.downloadOriginal(hiddenAuth, safeMotion.id, {})).resolves.toEqual(
        expect.objectContaining({ path: safeMotion.originalPath }),
      );
      await expect(sut.downloadOriginal(hiddenAuth, nsfwMotion.id, {})).rejects.toThrow(
        'Not found or no asset.download access',
      );

      const hiddenAlbumViewerAuth = {
        ...factory.auth({ user: { id: albumViewer.id } }),
        hideNsfwAssets: true,
      };
      await expect(sut.downloadOriginal(hiddenAlbumViewerAuth, safeMotion.id, {})).resolves.toEqual(
        expect.objectContaining({ path: safeMotion.originalPath }),
      );
      await expect(sut.downloadOriginal(hiddenAlbumViewerAuth, nsfwMotion.id, {})).rejects.toThrow(
        'Not found or no asset.download access',
      );

      await expect(sut.downloadOriginal({ user, sharedLink, hideNsfwAssets: true }, nsfwMotion.id, {})).rejects.toThrow(
        'Not found or no asset.download access',
      );
      await expect(
        sut.downloadOriginal({ user, sharedLink: albumSharedLink, hideNsfwAssets: true }, nsfwMotion.id, {}),
      ).rejects.toThrow('Not found or no asset.download access');
    });

    it('should return original thumbnail by default when both exist', async () => {
      const { sut, ctx } = setup();

      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      // Create both original and edited thumbnails
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: '/original/preview.jpg',
        isEdited: false,
      });
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: '/edited/preview.jpg',
        isEdited: true,
      });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.viewThumbnail(auth, asset.id, { size: AssetMediaSize.PREVIEW });

      expect(result).toBeInstanceOf(ImmichFileResponse);
      expect((result as ImmichFileResponse).path).toBe('/original/preview.jpg');
    });

    it('should return edited thumbnail when edited=true', async () => {
      const { sut, ctx } = setup();

      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      // Create both original and edited thumbnails
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: '/original/preview.jpg',
        isEdited: false,
      });
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: '/edited/preview.jpg',
        isEdited: true,
      });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.viewThumbnail(auth, asset.id, { size: AssetMediaSize.PREVIEW, edited: true });

      expect(result).toBeInstanceOf(ImmichFileResponse);
      expect((result as ImmichFileResponse).path).toBe('/edited/preview.jpg');
    });

    it('should return original thumbnail when edited=false', async () => {
      const { sut, ctx } = setup();

      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      // Create both original and edited thumbnails
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: '/original/preview.jpg',
        isEdited: false,
      });
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: '/edited/preview.jpg',
        isEdited: true,
      });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.viewThumbnail(auth, asset.id, { size: AssetMediaSize.PREVIEW, edited: false });

      expect(result).toBeInstanceOf(ImmichFileResponse);
      expect((result as ImmichFileResponse).path).toBe('/original/preview.jpg');
    });

    it('should return original thumbnail when only original exists and edited=false', async () => {
      const { sut, ctx } = setup();

      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      // Create only original thumbnail
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: '/original/preview.jpg',
        isEdited: false,
      });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.viewThumbnail(auth, asset.id, { size: AssetMediaSize.PREVIEW, edited: false });

      expect(result).toBeInstanceOf(ImmichFileResponse);
      expect((result as ImmichFileResponse).path).toBe('/original/preview.jpg');
    });

    it('should return original thumbnail when only original exists and edited=true', async () => {
      const { sut, ctx } = setup();

      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      // Create only original thumbnail
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: '/original/preview.jpg',
        isEdited: false,
      });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.viewThumbnail(auth, asset.id, { size: AssetMediaSize.PREVIEW, edited: true });

      expect(result).toBeInstanceOf(ImmichFileResponse);
      expect((result as ImmichFileResponse).path).toBe('/original/preview.jpg');
    });

    it('should work with thumbnail size', async () => {
      const { sut, ctx } = setup();

      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      // Create both original and edited thumbnails
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Thumbnail,
        path: '/original/thumbnail.jpg',
        isEdited: false,
      });
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Thumbnail,
        path: '/edited/thumbnail.jpg',
        isEdited: true,
      });

      const auth = factory.auth({ user: { id: user.id } });

      // Test default (should get original)
      const resultDefault = await sut.viewThumbnail(auth, asset.id, { size: AssetMediaSize.THUMBNAIL });
      expect(resultDefault).toBeInstanceOf(ImmichFileResponse);
      expect((resultDefault as ImmichFileResponse).path).toBe('/original/thumbnail.jpg');

      // Test edited=true (should get edited)
      const resultEdited = await sut.viewThumbnail(auth, asset.id, { size: AssetMediaSize.THUMBNAIL, edited: true });
      expect(resultEdited).toBeInstanceOf(ImmichFileResponse);
      expect((resultEdited as ImmichFileResponse).path).toBe('/edited/thumbnail.jpg');
    });
  });
});

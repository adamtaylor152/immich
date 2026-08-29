import { Kysely } from 'kysely';
import { ReactionType } from 'src/dtos/activity.dto';
import { AssetMetadataKey } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { ActivityRepository } from 'src/repositories/activity.repository';
import { AlbumUserRepository } from 'src/repositories/album-user.repository';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { TagRepository } from 'src/repositories/tag.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { ActivityService } from 'src/services/activity.service';
import { upsertTags } from 'src/utils/tag';
import { newMediumService } from 'test/medium.factory';
import { factory, newUuid } from 'test/small.factory';
import { getActiveForkKyselyDB as getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  return newMediumService(ActivityService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      ActivityRepository,
      AlbumRepository,
      AlbumUserRepository,
      AssetRepository,
      TagRepository,
      UserRepository,
    ],
    mock: [LoggingRepository],
  });
};

const nsfwMetadata = (isNsfw: boolean) => ({
  nsfwDetection: {
    status: 'success',
    result: { isNsfw, score: isNsfw ? 0.95 : 0.05, labels: [] },
  },
});

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(ActivityService.name, () => {
  describe('nsfw privacy', () => {
    it('filters hidden NSFW asset activity and statistics using private metadata only', async () => {
      const { sut, ctx } = setup();
      const activityRepository = ctx.get(ActivityRepository);
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });
      const { album } = await ctx.newAlbum({ ownerId: user.id });

      const { asset: safe } = await ctx.newAsset({ ownerId: user.id });
      const { asset: nsfw } = await ctx.newAsset({ ownerId: user.id });
      const { asset: tagOnly } = await ctx.newAsset({ ownerId: user.id });
      for (const asset of [safe, nsfw, tagOnly]) {
        await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
      }

      await ctx.newMetadata({
        assetId: nsfw.id,
        key: AssetMetadataKey.MlEnrichment,
        value: nsfwMetadata(true),
      });
      const [visibleNsfwTag] = await upsertTags(ctx.get(TagRepository), { userId: user.id, tags: ['nsfw'] });
      await ctx.newTagAsset({ tagIds: [visibleNsfwTag.id], assetIds: [tagOnly.id] });

      const [safeComment, nsfwComment, nsfwLike, tagOnlyComment, albumComment] = await Promise.all([
        activityRepository.create({
          albumId: album.id,
          userId: user.id,
          assetId: safe.id,
          comment: 'safe comment',
          isLiked: false,
        }),
        activityRepository.create({
          albumId: album.id,
          userId: user.id,
          assetId: nsfw.id,
          comment: 'hidden comment',
          isLiked: false,
        }),
        activityRepository.create({
          albumId: album.id,
          userId: user.id,
          assetId: nsfw.id,
          comment: null,
          isLiked: true,
        }),
        activityRepository.create({
          albumId: album.id,
          userId: user.id,
          assetId: tagOnly.id,
          comment: 'tag-only comment',
          isLiked: false,
        }),
        activityRepository.create({
          albumId: album.id,
          userId: user.id,
          assetId: null,
          comment: 'album comment',
          isLiked: false,
        }),
      ]);

      const hiddenAuth = { ...auth, hideNsfwAssets: true };
      const hiddenActivities = await sut.getAll(hiddenAuth, { albumId: album.id });
      expect(hiddenActivities.map(({ id }) => id)).toEqual(
        expect.arrayContaining([safeComment.id, tagOnlyComment.id, albumComment.id]),
      );
      expect(hiddenActivities.map(({ id }) => id)).not.toEqual(expect.arrayContaining([nsfwComment.id, nsfwLike.id]));
      await expect(sut.getStatistics(hiddenAuth, { albumId: album.id, assetId: nsfw.id })).resolves.toEqual({
        comments: 0,
        likes: 0,
      });
      await expect(sut.getStatistics(hiddenAuth, { albumId: album.id, assetId: tagOnly.id })).resolves.toEqual({
        comments: 1,
        likes: 0,
      });
      await expect(sut.getStatistics(hiddenAuth, { albumId: album.id })).resolves.toEqual({ comments: 3, likes: 0 });

      const elevatedActivities = await sut.getAll(auth, { albumId: album.id });
      expect(elevatedActivities.map(({ id }) => id)).toEqual(
        expect.arrayContaining([safeComment.id, nsfwComment.id, nsfwLike.id, tagOnlyComment.id, albumComment.id]),
      );
      await expect(sut.getStatistics(auth, { albumId: album.id })).resolves.toEqual({ comments: 4, likes: 1 });
    });

    it('denies hidden-mode activity mutations for hidden NSFW asset activity', async () => {
      const { sut, ctx } = setup();
      const activityRepository = ctx.get(ActivityRepository);
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });
      const { album } = await ctx.newAlbum({ ownerId: user.id });

      const { asset: nsfw } = await ctx.newAsset({ ownerId: user.id });
      const { asset: tagOnly } = await ctx.newAsset({ ownerId: user.id });
      await Promise.all([
        ctx.newAlbumAsset({ albumId: album.id, assetId: nsfw.id }),
        ctx.newAlbumAsset({ albumId: album.id, assetId: tagOnly.id }),
        ctx.newMetadata({
          assetId: nsfw.id,
          key: AssetMetadataKey.MlEnrichment,
          value: nsfwMetadata(true),
        }),
      ]);
      const [visibleNsfwTag] = await upsertTags(ctx.get(TagRepository), { userId: user.id, tags: ['nsfw'] });
      await ctx.newTagAsset({ tagIds: [visibleNsfwTag.id], assetIds: [tagOnly.id] });

      const nsfwComment = await activityRepository.create({
        albumId: album.id,
        userId: user.id,
        assetId: nsfw.id,
        comment: 'hidden comment',
        isLiked: false,
      });

      const hiddenAuth = { ...auth, hideNsfwAssets: true };
      await expect(
        sut.create(hiddenAuth, {
          albumId: album.id,
          assetId: nsfw.id,
          type: ReactionType.COMMENT,
          comment: 'new hidden comment',
        }),
      ).rejects.toThrow('Not found or no asset.read access');
      await expect(sut.delete(hiddenAuth, nsfwComment.id)).rejects.toThrow('Not found or no activity.delete access');

      await expect(
        sut.create(hiddenAuth, {
          albumId: album.id,
          assetId: tagOnly.id,
          type: ReactionType.COMMENT,
          comment: 'tag-only comment',
        }),
      ).resolves.toEqual(expect.objectContaining({ duplicate: false }));
      await expect(
        sut.create(hiddenAuth, {
          albumId: album.id,
          type: ReactionType.COMMENT,
          comment: 'album comment',
        }),
      ).resolves.toEqual(expect.objectContaining({ duplicate: false }));

      const remaining = await ctx.database
        .selectFrom('activity')
        .select('id')
        .where('id', '=', nsfwComment.id)
        .execute();
      expect(remaining).toHaveLength(1);
    });
  });

  describe('getAll', () => {
    it('should start off empty', async () => {
      const { sut, ctx } = setup();
      const { album, owner } = await ctx.newSharedAlbum();

      await expect(sut.getAll(factory.auth({ user: owner }), { albumId: album.id })).resolves.toEqual([]);
    });

    it('should filter by album id', async () => {
      const { sut, ctx } = setup();
      const { album, owner } = await ctx.newSharedAlbum();
      const auth = factory.auth({ user: owner });
      const { album: other } = await ctx.newAlbum({ ownerId: owner.id });
      const { value } = await sut.create(auth, { albumId: album.id, type: ReactionType.LIKE });
      await sut.create(auth, { albumId: other.id, type: ReactionType.LIKE });

      await expect(sut.getAll(auth, { albumId: album.id })).resolves.toEqual([value]);
    });

    it('should filter by type=comment', async () => {
      const { sut, ctx } = setup();
      const { album, owner } = await ctx.newSharedAlbum();
      const auth = factory.auth({ user: owner });
      const { value } = await sut.create(auth, {
        albumId: album.id,
        type: ReactionType.COMMENT,
        comment: 'comment',
      });
      await sut.create(auth, { albumId: album.id, type: ReactionType.LIKE });

      await expect(sut.getAll(auth, { albumId: album.id, type: ReactionType.COMMENT })).resolves.toEqual([value]);
    });

    it('should filter by type=like', async () => {
      const { sut, ctx } = setup();
      const { album, owner } = await ctx.newSharedAlbum();
      const auth = factory.auth({ user: owner });
      const { value } = await sut.create(auth, { albumId: album.id, type: ReactionType.LIKE });
      await sut.create(auth, { albumId: album.id, type: ReactionType.COMMENT, comment: 'comment' });

      await expect(sut.getAll(auth, { albumId: album.id, type: ReactionType.LIKE })).resolves.toEqual([value]);
    });

    it('should filter by userId', async () => {
      const { sut, ctx } = setup();
      const { album, owner } = await ctx.newSharedAlbum();
      const auth = factory.auth({ user: owner });
      const { value } = await sut.create(auth, { albumId: album.id, type: ReactionType.LIKE });

      await expect(sut.getAll(auth, { albumId: album.id, userId: newUuid() })).resolves.toEqual([]);
      await expect(sut.getAll(auth, { albumId: album.id, userId: owner.id })).resolves.toEqual([value]);
    });

    it('should filter by assetId', async () => {
      const { sut, ctx } = setup();
      const { album, asset, owner } = await ctx.newSharedAlbum();
      const auth = factory.auth({ user: owner });
      const { value } = await sut.create(auth, {
        albumId: album.id,
        assetId: asset.id,
        type: ReactionType.LIKE,
      });
      await sut.create(auth, { albumId: album.id, type: ReactionType.LIKE });

      await expect(sut.getAll(auth, { albumId: album.id, assetId: asset.id })).resolves.toEqual([value]);
    });
  });

  describe('create', () => {
    it('should add a comment to an album', async () => {
      const { sut, ctx } = setup();
      const { album, owner } = await ctx.newSharedAlbum();
      const auth = factory.auth({ user: owner });

      await expect(
        sut.create(auth, { albumId: album.id, type: ReactionType.COMMENT, comment: 'This is my first comment' }),
      ).resolves.toEqual({
        duplicate: false,
        value: {
          id: expect.any(String),
          assetId: null,
          createdAt: expect.any(Date),
          type: ReactionType.COMMENT,
          comment: 'This is my first comment',
          user: expect.objectContaining({ id: owner.id }),
        },
      });
    });

    it('should add a like to an album', async () => {
      const { sut, ctx } = setup();
      const { album, owner } = await ctx.newSharedAlbum();
      const auth = factory.auth({ user: owner });

      await expect(sut.create(auth, { albumId: album.id, type: ReactionType.LIKE })).resolves.toEqual({
        duplicate: false,
        value: {
          id: expect.any(String),
          assetId: null,
          createdAt: expect.any(Date),
          type: ReactionType.LIKE,
          comment: null,
          user: expect.objectContaining({ id: owner.id }),
        },
      });
    });

    it('should report a duplicate like on an album', async () => {
      const { sut, ctx } = setup();
      const { album, owner } = await ctx.newSharedAlbum();
      const ownerAuth = factory.auth({ user: owner });
      const { value } = await sut.create(ownerAuth, { albumId: album.id, type: ReactionType.LIKE });

      await expect(sut.create(ownerAuth, { albumId: album.id, type: ReactionType.LIKE })).resolves.toEqual({
        duplicate: true,
        value,
      });
    });

    it('should not confuse an album like with an asset like', async () => {
      const { sut, ctx } = setup();
      const { album, asset, owner } = await ctx.newSharedAlbum();
      const ownerAuth = factory.auth({ user: owner });
      const { value } = await sut.create(ownerAuth, {
        albumId: album.id,
        assetId: asset.id,
        type: ReactionType.LIKE,
      });

      const result = await sut.create(ownerAuth, { albumId: album.id, type: ReactionType.LIKE });

      expect(result.duplicate).toBe(false);
      expect(result.value.id).not.toEqual(value.id);
    });

    it('should add a comment to an asset', async () => {
      const { sut, ctx } = setup();
      const { album, asset, owner } = await ctx.newSharedAlbum();

      await expect(
        sut.create(factory.auth({ user: owner }), {
          albumId: album.id,
          assetId: asset.id,
          type: ReactionType.COMMENT,
          comment: 'This is my first comment',
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          duplicate: false,
          value: expect.objectContaining({ assetId: asset.id, comment: 'This is my first comment' }),
        }),
      );
    });

    it('should add a like to an asset', async () => {
      const { sut, ctx } = setup();
      const { album, asset, owner } = await ctx.newSharedAlbum();

      await expect(
        sut.create(factory.auth({ user: owner }), { albumId: album.id, assetId: asset.id, type: ReactionType.LIKE }),
      ).resolves.toEqual(
        expect.objectContaining({
          duplicate: false,
          value: expect.objectContaining({ assetId: asset.id, type: ReactionType.LIKE, comment: null }),
        }),
      );
    });

    it('should report a duplicate like on an asset', async () => {
      const { sut, ctx } = setup();
      const { album, asset, owner } = await ctx.newSharedAlbum();
      const auth = factory.auth({ user: owner });
      const { value } = await sut.create(auth, {
        albumId: album.id,
        assetId: asset.id,
        type: ReactionType.LIKE,
      });

      await expect(
        sut.create(auth, { albumId: album.id, assetId: asset.id, type: ReactionType.LIKE }),
      ).resolves.toEqual({ duplicate: true, value });
    });

    it('should not let a user comment on an album they cannot access', async () => {
      const { sut, ctx } = setup();
      const { album } = await ctx.newSharedAlbum();
      const { user: outsider } = await ctx.newUser();

      await expect(
        sut.create(factory.auth({ user: outsider }), { albumId: album.id, type: ReactionType.LIKE }),
      ).rejects.toThrow('Not found or no activity.create access');
    });
  });

  describe('delete', () => {
    it('should remove a comment from an album', async () => {
      const { sut, ctx } = setup();
      const { album, owner } = await ctx.newSharedAlbum();
      const auth = factory.auth({ user: owner });
      const { value } = await sut.create(auth, {
        albumId: album.id,
        type: ReactionType.COMMENT,
        comment: 'This is a test comment',
      });

      await expect(sut.delete(auth, value.id)).resolves.toBeUndefined();
      await expect(sut.getAll(auth, { albumId: album.id })).resolves.toEqual([]);
    });

    it('should remove a like from an album', async () => {
      const { sut, ctx } = setup();
      const { album, owner } = await ctx.newSharedAlbum();
      const auth = factory.auth({ user: owner });
      const { value } = await sut.create(auth, { albumId: album.id, type: ReactionType.LIKE });

      await expect(sut.delete(auth, value.id)).resolves.toBeUndefined();
      await expect(sut.getAll(auth, { albumId: album.id })).resolves.toEqual([]);
    });

    it('should let the album owner remove a comment by another user', async () => {
      const { sut, ctx } = setup();
      const { album, owner, sharedWith } = await ctx.newSharedAlbum();
      const auth = factory.auth({ user: owner });
      const sharedWithAuth = factory.auth({ user: sharedWith });
      const { value } = await sut.create(sharedWithAuth, {
        albumId: album.id,
        type: ReactionType.COMMENT,
        comment: 'This is a test comment',
      });

      await expect(sut.delete(auth, value.id)).resolves.toBeUndefined();
      await expect(sut.getAll(auth, { albumId: album.id })).resolves.toEqual([]);
    });

    it('should not let a user remove a comment by another user', async () => {
      const { sut, ctx } = setup();
      const { album, owner, sharedWith } = await ctx.newSharedAlbum();
      const auth = factory.auth({ user: owner });
      const sharedWithAuth = factory.auth({ user: sharedWith });
      const { value } = await sut.create(auth, {
        albumId: album.id,
        type: ReactionType.COMMENT,
        comment: 'This is a test comment',
      });

      await expect(sut.delete(sharedWithAuth, value.id)).rejects.toThrow('Not found or no activity.delete access');
      await expect(sut.getAll(auth, { albumId: album.id })).resolves.toEqual([value]);
    });

    it('should let a non-owner remove their own comment', async () => {
      const { sut, ctx } = setup();
      const { album, owner, sharedWith } = await ctx.newSharedAlbum();
      const auth = factory.auth({ user: owner });
      const sharedWithAuth = factory.auth({ user: sharedWith });
      const { value } = await sut.create(sharedWithAuth, {
        albumId: album.id,
        type: ReactionType.COMMENT,
        comment: 'This is a test comment',
      });

      await expect(sut.delete(sharedWithAuth, value.id)).resolves.toBeUndefined();
      await expect(sut.getAll(auth, { albumId: album.id })).resolves.toEqual([]);
    });

    it('should drop activities when the asset is removed from the album', async () => {
      const { sut, ctx } = setup();
      const { album, asset, owner } = await ctx.newSharedAlbum();
      const auth = factory.auth({ user: owner });
      await sut.create(auth, { albumId: album.id, assetId: asset.id, type: ReactionType.LIKE });

      await ctx.database
        .deleteFrom('album_asset')
        .where('albumId', '=', album.id)
        .where('assetId', '=', asset.id)
        .execute();

      await expect(sut.getAll(auth, { albumId: album.id })).resolves.toEqual([]);
    });
  });
});

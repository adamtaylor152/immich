import { Insertable, Kysely } from 'kysely';
import { AssetType, AssetVisibility } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { LivePhotoRepository } from 'src/repositories/live-photo.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { AssetTable } from 'src/schema/tables/asset.table';
import { mediumFactory } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const database = db || defaultDatabase;
  return {
    assetRepository: new AssetRepository(database),
    database,
    sut: new LivePhotoRepository(database),
    userRepository: new UserRepository(database),
  };
};

const createUser = async (userRepository: UserRepository) => {
  const user = await mediumFactory.userWithClusterGroup(defaultDatabase);
  await userRepository.create(user);
  return user;
};

const createAsset = async (assetRepository: AssetRepository, dto: Partial<Insertable<AssetTable>>) => {
  const asset = mediumFactory.assetInsert(dto);
  await assetRepository.create(asset);
  return asset;
};

const setLivePhotoCID = (database: Kysely<DB>, assetId: string, livePhotoCID: string) =>
  database.insertInto('asset_exif').values({ assetId, livePhotoCID }).execute();

describe(LivePhotoRepository.name, () => {
  beforeEach(async () => {
    defaultDatabase = await getKyselyDB();
  });

  describe('getUnlinkedByContentId', () => {
    it('returns an unlinked image + video that share a ContentIdentifier', async () => {
      const { sut, assetRepository, userRepository, database } = setup();
      const user = await createUser(userRepository);
      const photo = await createAsset(assetRepository, {
        ownerId: user.id,
        type: AssetType.Image,
        originalFileName: 'IMG_0001.heic',
      });
      const video = await createAsset(assetRepository, {
        ownerId: user.id,
        type: AssetType.Video,
        originalFileName: 'IMG_0001.mov',
      });
      await setLivePhotoCID(database, photo.id, 'CID-1');
      await setLivePhotoCID(database, video.id, 'CID-1');

      await expect(sut.getUnlinkedByContentId(user.id)).resolves.toEqual([{ photoId: photo.id, videoId: video.id }]);
    });

    it('excludes a video that is already a live photo target', async () => {
      const { sut, assetRepository, userRepository, database } = setup();
      const user = await createUser(userRepository);
      const video = await createAsset(assetRepository, { ownerId: user.id, type: AssetType.Video });
      // An existing photo already links the video.
      await createAsset(assetRepository, { ownerId: user.id, type: AssetType.Image, livePhotoVideoId: video.id });
      // A second, unlinked photo shares the same identifier — but the video is taken.
      const photo = await createAsset(assetRepository, { ownerId: user.id, type: AssetType.Image });
      await setLivePhotoCID(database, photo.id, 'CID-2');
      await setLivePhotoCID(database, video.id, 'CID-2');

      await expect(sut.getUnlinkedByContentId(user.id)).resolves.toEqual([]);
    });

    it('ignores hidden assets', async () => {
      const { sut, assetRepository, userRepository, database } = setup();
      const user = await createUser(userRepository);
      const photo = await createAsset(assetRepository, { ownerId: user.id, type: AssetType.Image });
      const video = await createAsset(assetRepository, {
        ownerId: user.id,
        type: AssetType.Video,
        visibility: AssetVisibility.Hidden,
      });
      await setLivePhotoCID(database, photo.id, 'CID-3');
      await setLivePhotoCID(database, video.id, 'CID-3');

      await expect(sut.getUnlinkedByContentId(user.id)).resolves.toEqual([]);
    });
  });

  describe('getUnlinkedByFilename', () => {
    it('matches by filename stem within the capture-time window', async () => {
      const { sut, assetRepository, userRepository } = setup();
      const user = await createUser(userRepository);
      const photo = await createAsset(assetRepository, {
        ownerId: user.id,
        type: AssetType.Image,
        originalFileName: 'IMG_2.HEIC',
        fileCreatedAt: new Date('2024-01-01T00:00:00.000Z'),
      });
      const video = await createAsset(assetRepository, {
        ownerId: user.id,
        type: AssetType.Video,
        originalFileName: 'IMG_2.mov',
        fileCreatedAt: new Date('2024-01-01T00:00:01.000Z'),
      });

      await expect(sut.getUnlinkedByFilename(user.id, 2)).resolves.toEqual([{ photoId: photo.id, videoId: video.id }]);
    });

    it('does not match across the time window or between different stems', async () => {
      const { sut, assetRepository, userRepository } = setup();
      const user = await createUser(userRepository);
      // Same stem, but captured a minute apart.
      await createAsset(assetRepository, {
        ownerId: user.id,
        type: AssetType.Image,
        originalFileName: 'IMG_3.heic',
        fileCreatedAt: new Date('2024-01-01T00:00:00.000Z'),
      });
      await createAsset(assetRepository, {
        ownerId: user.id,
        type: AssetType.Video,
        originalFileName: 'IMG_3.mov',
        fileCreatedAt: new Date('2024-01-01T00:01:00.000Z'),
      });
      // Same capture time, but different stems.
      await createAsset(assetRepository, {
        ownerId: user.id,
        type: AssetType.Image,
        originalFileName: 'IMG_4.heic',
        fileCreatedAt: new Date('2024-01-01T00:00:00.000Z'),
      });
      await createAsset(assetRepository, {
        ownerId: user.id,
        type: AssetType.Video,
        originalFileName: 'CLIP_9.mov',
        fileCreatedAt: new Date('2024-01-01T00:00:00.000Z'),
      });

      await expect(sut.getUnlinkedByFilename(user.id, 2)).resolves.toEqual([]);
    });
  });
});

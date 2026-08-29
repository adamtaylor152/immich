import { Kysely } from 'kysely';
import { AssetFileType, AssetStatus, AssetType, AssetVisibility } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { BestPhotosRepository } from 'src/repositories/best-photos.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { mediumFactory } from 'test/medium.factory';
import { getActiveForkKyselyDB as getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const database = db || defaultDatabase;
  return {
    assetRepository: new AssetRepository(database),
    database,
    sut: new BestPhotosRepository(database),
    userRepository: new UserRepository(database),
  };
};

const createUser = async (userRepository: UserRepository) => {
  const user = await mediumFactory.userWithClusterGroup(defaultDatabase);
  await userRepository.create(user);
  return user;
};

const createAsset = async (
  assetRepository: AssetRepository,
  ownerId: string,
  options?: { visibility?: AssetVisibility; type?: AssetType },
) => {
  const asset = mediumFactory.assetInsert({
    ownerId,
    type: options?.type ?? AssetType.Image,
    visibility: options?.visibility ?? AssetVisibility.Timeline,
  });
  await assetRepository.create(asset);
  await assetRepository.upsertFiles([
    { assetId: asset.id, type: AssetFileType.Preview, path: `/preview/${asset.id}.jpg` },
  ]);
  return asset;
};

describe(BestPhotosRepository.name, () => {
  beforeEach(async () => {
    defaultDatabase = await getKyselyDB();
  });

  it('should upsert score rows by asset id', async () => {
    const { assetRepository, sut, userRepository } = setup();
    const user = await createUser(userRepository);
    const asset = await createAsset(assetRepository, user.id);

    await sut.upsertScore({
      assetId: asset.id,
      ownerId: user.id,
      score: 0.4,
      aestheticScore: 0.4,
      technicalScore: 0.4,
      subjectScore: 0.4,
      diversityScore: 0.4,
      scoreVersion: 1,
      computedAt: new Date(),
      metadata: {},
      bestFrameTimestampMs: null,
      frameScore: null,
      frameMetadata: null,
    });
    await sut.upsertScore({
      assetId: asset.id,
      ownerId: user.id,
      score: 0.9,
      aestheticScore: 0.9,
      technicalScore: 0.9,
      subjectScore: 0.9,
      diversityScore: 0.9,
      scoreVersion: 1,
      computedAt: new Date(),
      metadata: {},
      bestFrameTimestampMs: null,
      frameScore: null,
      frameMetadata: null,
    });

    await expect(sut.getScore(asset.id)).resolves.toEqual(expect.objectContaining({ score: 0.9 }));
  });

  it('should return only visible owned assets sorted by score', async () => {
    const { assetRepository, sut, userRepository } = setup();
    const user = await createUser(userRepository);
    const otherUser = await createUser(userRepository);
    const low = await createAsset(assetRepository, user.id);
    const high = await createAsset(assetRepository, user.id);
    const archived = await createAsset(assetRepository, user.id, { visibility: AssetVisibility.Archive });
    const hidden = await createAsset(assetRepository, user.id, { visibility: AssetVisibility.Hidden });
    const other = await createAsset(assetRepository, otherUser.id);

    for (const [asset, ownerId, score] of [
      [low, user.id, 0.3],
      [high, user.id, 0.8],
      [archived, user.id, 0.9],
      [hidden, user.id, 1],
      [other, otherUser.id, 0.95],
    ] as const) {
      await sut.upsertScore({
        assetId: asset.id,
        ownerId,
        score,
        aestheticScore: score,
        technicalScore: score,
        subjectScore: score,
        diversityScore: score,
        scoreVersion: 1,
        computedAt: new Date(),
        metadata: {},
        bestFrameTimestampMs: null,
        frameScore: null,
        frameMetadata: null,
      });
    }

    await defaultDatabase.updateTable('asset').set({ status: AssetStatus.Active }).execute();

    const page = await sut.getBestPhotos({ ownerId: user.id, page: 1, limit: 10 });
    expect(page.total).toBe(2);
    expect(page.items.map((asset) => asset.id)).toEqual([high.id, low.id]);

    const withArchive = await sut.getBestPhotos({ ownerId: user.id, page: 1, limit: 10, includeArchived: true });
    expect(withArchive.total).toBe(3);
    expect(withArchive.items.map((asset) => asset.id)).toEqual([archived.id, high.id, low.id]);
  });

  it('should include scored videos and persist their best-frame columns', async () => {
    const { assetRepository, sut, userRepository } = setup();
    const user = await createUser(userRepository);
    const video = await createAsset(assetRepository, user.id, { type: AssetType.Video });
    const image = await createAsset(assetRepository, user.id);

    await sut.upsertScore({
      assetId: video.id,
      ownerId: user.id,
      score: 0.7,
      aestheticScore: 0.7,
      technicalScore: 0.7,
      subjectScore: 0.5,
      diversityScore: 0.5,
      scoreVersion: 1,
      computedAt: new Date(),
      metadata: {},
      bestFrameTimestampMs: 12_345,
      frameScore: 0.66,
      frameMetadata: { durationMs: 60_000, sampledFrameCount: 5 },
    });
    await sut.upsertScore({
      assetId: image.id,
      ownerId: user.id,
      score: 0.4,
      aestheticScore: 0.4,
      technicalScore: 0.4,
      subjectScore: 0.4,
      diversityScore: 0.4,
      scoreVersion: 1,
      computedAt: new Date(),
      metadata: {},
      bestFrameTimestampMs: null,
      frameScore: null,
      frameMetadata: null,
    });

    await defaultDatabase.updateTable('asset').set({ status: AssetStatus.Active }).execute();

    await expect(sut.getScore(video.id)).resolves.toEqual(
      expect.objectContaining({
        bestFrameTimestampMs: 12_345,
        frameScore: 0.66,
        frameMetadata: expect.objectContaining({ durationMs: 60_000, sampledFrameCount: 5 }),
      }),
    );

    const page = await sut.getBestPhotos({ ownerId: user.id, page: 1, limit: 10 });
    expect(page.total).toBe(2);
    expect(page.items.map((asset) => asset.id)).toEqual([video.id, image.id]);
    expect(page.items[0]).toEqual(
      expect.objectContaining({
        type: AssetType.Video,
        bestPhotoBestFrameTimestampMs: 12_345,
        bestPhotoFrameScore: 0.66,
        bestPhotoFrameMetadata: expect.objectContaining({ sampledFrameCount: 5 }),
      }),
    );
    expect(page.items[1]).toEqual(expect.objectContaining({ bestPhotoBestFrameTimestampMs: null }));
  });

  it('should return the total match count separately from the current page size', async () => {
    const { assetRepository, sut, userRepository } = setup();
    const user = await createUser(userRepository);
    const first = await createAsset(assetRepository, user.id);
    const second = await createAsset(assetRepository, user.id);

    for (const [asset, score] of [
      [first, 0.9],
      [second, 0.8],
    ] as const) {
      await sut.upsertScore({
        assetId: asset.id,
        ownerId: user.id,
        score,
        aestheticScore: score,
        technicalScore: score,
        subjectScore: score,
        diversityScore: score,
        scoreVersion: 1,
        computedAt: new Date(),
        metadata: {},
        bestFrameTimestampMs: null,
        frameScore: null,
        frameMetadata: null,
      });
    }

    await defaultDatabase.updateTable('asset').set({ status: AssetStatus.Active }).execute();

    const page = await sut.getBestPhotos({ ownerId: user.id, page: 1, limit: 1 });
    expect(page.total).toBe(2);
    expect(page.hasNextPage).toBe(true);
    expect(page.items).toHaveLength(1);
  });
});

import { Kysely } from 'kysely';
import { AssetFileType, AssetStatus, AssetType, AssetVisibility } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { BestPhotosRepository } from 'src/repositories/best-photos.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { mediumFactory } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

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
  const user = mediumFactory.userInsert();
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
    expect(page.items.map((asset) => asset.id)).toEqual([high.id, low.id]);

    const withArchive = await sut.getBestPhotos({ ownerId: user.id, page: 1, limit: 10, includeArchived: true });
    expect(withArchive.items.map((asset) => asset.id)).toEqual([archived.id, high.id, low.id]);
  });
});

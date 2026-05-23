import { Kysely } from 'kysely';
import { AssetType } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { SmartAlbumRepository } from 'src/repositories/smart-album.repository';
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
    sut: new SmartAlbumRepository(database),
    userRepository: new UserRepository(database),
  };
};

const createUser = async (userRepository: UserRepository) => {
  const user = mediumFactory.userInsert();
  await userRepository.create(user);
  return user;
};

const createAsset = async (assetRepository: AssetRepository, ownerId: string) => {
  const asset = mediumFactory.assetInsert({ ownerId, type: AssetType.Image });
  await assetRepository.create(asset);
  return asset;
};

const KINDS = [
  { kind: 'travel', name: 'Travel' },
  { kind: 'documents', name: 'Documents' },
  { kind: 'screenshots', name: 'Screenshots' },
  { kind: 'food', name: 'Food' },
  { kind: 'pets', name: 'Pets' },
  { kind: 'nature', name: 'Nature' },
];

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(SmartAlbumRepository.name, () => {
  describe('ensureForUser', () => {
    it('should create album + album_user (owner) + smart_album for each missing kind', async () => {
      const { sut, database, userRepository } = setup();
      const user = await createUser(userRepository);

      await sut.ensureForUser(user.id, KINDS);

      const smartAlbums = await database.selectFrom('smart_album').selectAll().where('ownerId', '=', user.id).execute();
      expect(smartAlbums).toHaveLength(KINDS.length);

      // Each smart_album must have a backing album_user row with the correct owner.
      for (const sa of smartAlbums) {
        const albumUsers = await database
          .selectFrom('album_user')
          .selectAll()
          .where('albumId', '=', sa.albumId)
          .execute();
        expect(albumUsers).toHaveLength(1);
        expect(albumUsers[0].userId).toBe(user.id);
        expect(albumUsers[0].role).toBe('owner');
      }

      // Backing album rows must exist (the regression guard for the CTE-not-executed bug).
      for (const sa of smartAlbums) {
        const album = await database.selectFrom('album').selectAll().where('id', '=', sa.albumId).executeTakeFirst();
        expect(album).toBeDefined();
      }
    });

    it('should be idempotent — second call creates nothing new', async () => {
      const { sut, database, userRepository } = setup();
      const user = await createUser(userRepository);

      await sut.ensureForUser(user.id, KINDS);
      await sut.ensureForUser(user.id, KINDS);

      const smartAlbums = await database.selectFrom('smart_album').selectAll().where('ownerId', '=', user.id).execute();
      expect(smartAlbums).toHaveLength(KINDS.length);

      // Albums also should not have been duplicated.
      const allAlbums = await database
        .selectFrom('album')
        .innerJoin('album_user', 'album_user.albumId', 'album.id')
        .where('album_user.userId', '=', user.id)
        .selectAll('album')
        .execute();
      expect(allAlbums).toHaveLength(KINDS.length);
    });
  });

  describe('addAssetToSmartAlbum', () => {
    it('should mirror the membership into album_asset', async () => {
      const { sut, database, assetRepository, userRepository } = setup();
      const user = await createUser(userRepository);
      const asset = await createAsset(assetRepository, user.id);
      await sut.ensureForUser(user.id, [{ kind: 'travel', name: 'Travel' }]);

      const smartAlbumId = (await sut.getSmartAlbumIdForOwnerAndKind(user.id, 'travel')) as string;
      await sut.addAssetToSmartAlbum(smartAlbumId, asset.id, 'tag');

      const smartAlbumAssets = await database
        .selectFrom('smart_album_asset')
        .selectAll()
        .where('smartAlbumId', '=', smartAlbumId)
        .where('assetId', '=', asset.id)
        .execute();
      expect(smartAlbumAssets).toHaveLength(1);
      expect(smartAlbumAssets[0].matchReason).toBe('tag');

      // Mirror into album_asset.
      const albumId = (await database
        .selectFrom('smart_album')
        .select('albumId')
        .where('id', '=', smartAlbumId)
        .executeTakeFirst())!.albumId;
      const albumAssets = await database
        .selectFrom('album_asset')
        .selectAll()
        .where('albumId', '=', albumId)
        .where('assetId', '=', asset.id)
        .execute();
      expect(albumAssets).toHaveLength(1);
    });

    it('should be idempotent (ON CONFLICT DO NOTHING)', async () => {
      const { sut, database, assetRepository, userRepository } = setup();
      const user = await createUser(userRepository);
      const asset = await createAsset(assetRepository, user.id);
      await sut.ensureForUser(user.id, [{ kind: 'travel', name: 'Travel' }]);
      const smartAlbumId = (await sut.getSmartAlbumIdForOwnerAndKind(user.id, 'travel')) as string;

      await sut.addAssetToSmartAlbum(smartAlbumId, asset.id, 'tag');
      await sut.addAssetToSmartAlbum(smartAlbumId, asset.id, 'tag');

      const smartAlbumAssets = await database
        .selectFrom('smart_album_asset')
        .selectAll()
        .where('smartAlbumId', '=', smartAlbumId)
        .where('assetId', '=', asset.id)
        .execute();
      expect(smartAlbumAssets).toHaveLength(1);
    });
  });

  describe('removeAssetFromSmartAlbum', () => {
    it('should remove from both smart_album_asset and album_asset', async () => {
      const { sut, database, assetRepository, userRepository } = setup();
      const user = await createUser(userRepository);
      const asset = await createAsset(assetRepository, user.id);
      await sut.ensureForUser(user.id, [{ kind: 'travel', name: 'Travel' }]);
      const smartAlbumId = (await sut.getSmartAlbumIdForOwnerAndKind(user.id, 'travel')) as string;
      await sut.addAssetToSmartAlbum(smartAlbumId, asset.id, 'tag');

      await sut.removeAssetFromSmartAlbum(smartAlbumId, asset.id);

      const smartAlbumAssets = await database
        .selectFrom('smart_album_asset')
        .selectAll()
        .where('smartAlbumId', '=', smartAlbumId)
        .where('assetId', '=', asset.id)
        .execute();
      expect(smartAlbumAssets).toEqual([]);

      const albumId = (await database
        .selectFrom('smart_album')
        .select('albumId')
        .where('id', '=', smartAlbumId)
        .executeTakeFirst())!.albumId;
      const albumAssets = await database
        .selectFrom('album_asset')
        .selectAll()
        .where('albumId', '=', albumId)
        .where('assetId', '=', asset.id)
        .execute();
      expect(albumAssets).toEqual([]);
    });
  });

  describe('excludeAsset', () => {
    it('should record the exclusion and remove the asset from the smart album', async () => {
      const { sut, database, assetRepository, userRepository } = setup();
      const user = await createUser(userRepository);
      const asset = await createAsset(assetRepository, user.id);
      await sut.ensureForUser(user.id, [{ kind: 'travel', name: 'Travel' }]);
      const smartAlbumId = (await sut.getSmartAlbumIdForOwnerAndKind(user.id, 'travel')) as string;
      await sut.addAssetToSmartAlbum(smartAlbumId, asset.id, 'tag');

      await sut.excludeAsset(smartAlbumId, asset.id);

      await expect(sut.isExcluded(smartAlbumId, asset.id)).resolves.toBe(true);

      const smartAlbumAssets = await database
        .selectFrom('smart_album_asset')
        .selectAll()
        .where('smartAlbumId', '=', smartAlbumId)
        .where('assetId', '=', asset.id)
        .execute();
      expect(smartAlbumAssets).toEqual([]);
    });
  });

  describe('getAllSmartAlbumIdsForOwner', () => {
    it('should return a map keyed by kind with the bootstrapped smart-album ids', async () => {
      const { sut, userRepository } = setup();
      const user = await createUser(userRepository);
      await sut.ensureForUser(user.id, KINDS);

      const map = await sut.getAllSmartAlbumIdsForOwner(user.id);

      expect(map.size).toBe(KINDS.length);
      for (const { kind } of KINDS) {
        expect(map.get(kind)).toEqual(expect.any(String));
      }
    });
  });

  describe('getExcludedSmartAlbumIds', () => {
    it('should return only the smart-album ids that have an exclusion for the asset', async () => {
      const { sut, assetRepository, userRepository } = setup();
      const user = await createUser(userRepository);
      const asset = await createAsset(assetRepository, user.id);
      await sut.ensureForUser(user.id, [
        { kind: 'travel', name: 'Travel' },
        { kind: 'food', name: 'Food' },
      ]);
      const travelId = (await sut.getSmartAlbumIdForOwnerAndKind(user.id, 'travel')) as string;
      const foodId = (await sut.getSmartAlbumIdForOwnerAndKind(user.id, 'food')) as string;

      await sut.excludeAsset(travelId, asset.id);

      const excluded = await sut.getExcludedSmartAlbumIds(asset.id, [travelId, foodId]);

      expect(excluded.has(travelId)).toBe(true);
      expect(excluded.has(foodId)).toBe(false);
    });
  });
});

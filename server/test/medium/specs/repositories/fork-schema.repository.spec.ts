import { Kysely, sql } from 'kysely';
import { createHash, randomBytes } from 'node:crypto';
import { ForkSchemaRepository } from 'src/repositories/fork-schema.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getActiveForkKyselyDB as getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(ForkSchemaRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(ForkSchemaRepository.name, () => {
  describe('getChecksumTranslations', () => {
    it('should return nothing for an empty digest list', async () => {
      const { sut } = setup();

      await expect(sut.getChecksumTranslations(randomBytes(16).toString('hex'), [])).resolves.toEqual([]);
    });

    it('should run against the database for digests with no match', async () => {
      // Guards the bytea[] binding: this query is mocked in the service specs,
      // so a malformed array parameter would only ever surface in e2e.
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      await expect(
        sut.getChecksumTranslations(user.id, [createHash('sha1').update('nothing').digest()]),
      ).resolves.toEqual([]);
    });

    it('should translate a recorded sha1 onto the stored sha256', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const contents = randomBytes(32);
      const sha1 = createHash('sha1').update(contents).digest();
      const sha256 = createHash('sha256').update(contents).digest();
      const { asset } = await ctx.newAsset({ ownerId: user.id, checksum: sha256 });

      await sut.recordAssetChecksums({
        assetId: asset.id,
        sha1,
        sha256,
        sizeInBytes: contents.length,
        path: asset.originalPath,
        source: 'upload',
      });

      await expect(sut.getChecksumTranslations(user.id, [sha1])).resolves.toEqual([{ sha1, checksum: sha256 }]);
    });

    it('should not translate for a different owner', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const contents = randomBytes(32);
      const sha1 = createHash('sha1').update(contents).digest();
      const sha256 = createHash('sha256').update(contents).digest();
      const { asset } = await ctx.newAsset({ ownerId: user.id, checksum: sha256 });

      await sut.recordAssetChecksums({
        assetId: asset.id,
        sha1,
        sha256,
        sizeInBytes: contents.length,
        path: asset.originalPath,
        source: 'upload',
      });

      await expect(sut.getChecksumTranslations(other.id, [sha1])).resolves.toEqual([]);
    });
  });

  describe('recordAssetChecksums', () => {
    it('should not overwrite an existing row', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const sha1 = createHash('sha1').update('first').digest();
      const sha256 = createHash('sha256').update('first').digest();

      await sut.recordAssetChecksums({
        assetId: asset.id,
        sha1,
        sha256,
        sizeInBytes: 5,
        path: asset.originalPath,
        source: 'upload',
      });
      await sut.recordAssetChecksums({
        assetId: asset.id,
        sha1: createHash('sha1').update('second').digest(),
        sha256: createHash('sha256').update('second').digest(),
        sizeInBytes: 6,
        path: asset.originalPath,
        source: 'integrity',
      });

      const row = await sql<{ sha1: Buffer; evidence: string }>`
        SELECT sha1, evidence::text FROM immich_fork.asset_checksum WHERE "assetId" = ${asset.id}::uuid
      `.execute(defaultDatabase);

      expect(row.rows[0]?.sha1).toEqual(sha1);
      expect(JSON.parse(row.rows[0]!.evidence)).toEqual({ source: 'upload' });
    });
  });
});

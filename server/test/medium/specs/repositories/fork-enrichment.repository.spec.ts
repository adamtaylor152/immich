import { Kysely, sql } from 'kysely';
import { createHash, randomUUID } from 'node:crypto';
import { AssetMetadataKey } from 'src/enum';
import { ForkEnrichmentRepository } from 'src/repositories/fork-enrichment.repository';
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
  return { ctx, sut: new ForkEnrichmentRepository(db || defaultDatabase) };
};

const setPhase = (phase: string, active: boolean) =>
  sql`UPDATE immich_fork.state SET phase = ${phase}, active = ${active} WHERE id = 1`.execute(defaultDatabase);

const newEnrichedAsset = async (ctx: ReturnType<typeof setup>['ctx']) => {
  const { user } = await ctx.newUser();
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  return { user, asset };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

afterEach(async () => {
  await setPhase('active', true);
});

describe(ForkEnrichmentRepository.name, () => {
  describe('initialize', () => {
    it('should create a default sidecar row for an existing asset only', async () => {
      const { ctx, sut } = setup();
      const { asset } = await newEnrichedAsset(ctx);
      const missing = randomUUID();

      await sut.initialize([asset.id, missing]);

      await expect(sut.get(asset.id)).resolves.toEqual({
        assetId: asset.id,
        provenance: {},
        userDescription: '',
        generatedDescription: null,
        generatedTags: [],
        requiresReview: false,
      });
      await expect(sut.get(missing)).resolves.toBeUndefined();
    });

    it('should not overwrite an existing sidecar row', async () => {
      const { ctx, sut } = setup();
      const { asset } = await newEnrichedAsset(ctx);
      const provenance = { description: { status: 'success', result: { description: 'kept' } } };
      await sut.save(asset.id, provenance);

      await sut.initialize([asset.id]);

      await expect(sut.get(asset.id)).resolves.toMatchObject({ provenance, generatedDescription: 'kept' });
    });

    it('should do nothing when fork writes are disabled', async () => {
      const { ctx, sut } = setup();
      const { asset } = await newEnrichedAsset(ctx);
      await sut.delete([asset.id]);
      await setPhase('legacy', false);

      await sut.initialize([asset.id]);

      await setPhase('active', true);
      await expect(sut.get(asset.id)).resolves.toBeUndefined();
    });
  });

  describe('save', () => {
    it('should extract generated fields from the provenance document', async () => {
      const { ctx, sut } = setup();
      const { asset } = await newEnrichedAsset(ctx);
      const provenance = {
        description: { status: 'success', result: { description: 'a scene', tags: ['fallback'] } },
      };

      await sut.save(asset.id, provenance);

      await expect(sut.get(asset.id)).resolves.toEqual({
        assetId: asset.id,
        provenance,
        userDescription: '',
        generatedDescription: 'a scene',
        generatedTags: ['fallback'],
        requiresReview: false,
      });
    });

    it('should preserve the user description and review flag on upsert', async () => {
      const { ctx, sut } = setup();
      const { asset } = await newEnrichedAsset(ctx);
      await sut.save(asset.id, { description: { status: 'success', result: { description: 'old' } } });
      await sql`UPDATE immich_fork.asset_enrichment SET "userDescription" = 'mine', "requiresReview" = true
        WHERE "assetId" = ${asset.id}::uuid`.execute(defaultDatabase);
      const provenance = {
        description: { status: 'success', result: { description: 'new' }, appliedTagValues: ['applied'] },
      };

      await sut.save(asset.id, provenance);

      await expect(sut.get(asset.id)).resolves.toEqual({
        assetId: asset.id,
        provenance,
        userDescription: 'mine',
        generatedDescription: 'new',
        generatedTags: ['applied'],
        requiresReview: true,
      });
    });

    it('should do nothing when fork writes are disabled', async () => {
      const { ctx, sut } = setup();
      const { asset } = await newEnrichedAsset(ctx);
      await sut.delete([asset.id]);
      await setPhase('legacy', false);

      await sut.save(asset.id, { description: { status: 'success', result: { description: 'ignored' } } });

      await setPhase('active', true);
      await expect(sut.get(asset.id)).resolves.toBeUndefined();
    });
  });

  describe('delete', () => {
    it('should remove sidecar rows when fork writes are enabled', async () => {
      const { ctx, sut } = setup();
      const { asset } = await newEnrichedAsset(ctx);
      await sut.initialize([asset.id]);

      await sut.delete([asset.id]);

      await expect(sut.get(asset.id)).resolves.toBeUndefined();
    });

    it('should keep sidecar rows when fork writes are disabled', async () => {
      const { ctx, sut } = setup();
      const { asset } = await newEnrichedAsset(ctx);
      await sut.initialize([asset.id]);
      await setPhase('legacy', false);

      await sut.delete([asset.id]);

      await setPhase('active', true);
      await expect(sut.get(asset.id)).resolves.toBeDefined();
    });
  });

  describe('shouldReadSidecar', () => {
    it.each([
      ['active', true],
      ['dual-write', false],
      ['ready', false],
      ['legacy', false],
    ] as const)('should report %s as authoritative=%s', async (phase, expected) => {
      const { sut } = setup();
      await setPhase(phase, phase === 'active');

      await expect(sut.shouldReadSidecar()).resolves.toBe(expected);
    });
  });

  describe('mirrorFromLegacy', () => {
    it('should mirror the legacy exif description into the sidecar', async () => {
      const { ctx, sut } = setup();
      const { asset } = await newEnrichedAsset(ctx);
      await ctx.newExif({ assetId: asset.id, description: 'legacy text' });

      await sut.mirrorFromLegacy(asset.id);

      await expect(sut.get(asset.id)).resolves.toMatchObject({
        userDescription: 'legacy text',
        generatedDescription: null,
        requiresReview: false,
      });
    });

    it('should do nothing when fork writes are disabled', async () => {
      const { ctx, sut } = setup();
      const { asset } = await newEnrichedAsset(ctx);
      await ctx.newExif({ assetId: asset.id, description: 'legacy text' });
      await sut.delete([asset.id]);
      await setPhase('legacy', false);

      await sut.mirrorFromLegacy(asset.id);

      await setPhase('active', true);
      await expect(sut.get(asset.id)).resolves.toBeUndefined();
    });
  });

  describe('backfillEnrichment', () => {
    it('should return a stable digest for the empty batch', async () => {
      const { sut } = setup();

      const first = await sut.backfillEnrichment([]);
      const second = await sut.backfillEnrichment([]);

      expect(first.count).toBe(0);
      expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(second).toEqual(first);
    });

    it('should keep a plain user description without requiring review', async () => {
      const { ctx, sut } = setup();
      const { asset } = await newEnrichedAsset(ctx);
      await ctx.newExif({ assetId: asset.id, description: 'just my words' });

      const result = await sut.backfillEnrichment([asset.id]);

      expect(result.count).toBe(1);
      await expect(sut.get(asset.id)).resolves.toEqual({
        assetId: asset.id,
        provenance: {},
        userDescription: 'just my words',
        generatedDescription: null,
        generatedTags: [],
        requiresReview: false,
      });
    });

    it('should remove proven applied tags from the legacy tag table', async () => {
      const { ctx, sut } = setup();
      const { user, asset } = await newEnrichedAsset(ctx);
      const { tag: applied } = await ctx.newTag({ userId: user.id, value: 'generated-tag' });
      const { tag: kept } = await ctx.newTag({ userId: user.id, value: 'my-tag' });
      await ctx.newTagAsset({ tagIds: [applied.id, kept.id], assetIds: [asset.id] });
      await ctx.newMetadata({
        assetId: asset.id,
        key: AssetMetadataKey.MlEnrichment,
        value: {
          description: {
            status: 'success',
            result: { tags: ['generated-tag'] },
            appliedTagValues: ['generated-tag'],
            appliedTagHash: createHash('sha256')
              .update(JSON.stringify(['generated-tag']))
              .digest('hex'),
          },
        },
      });

      await sut.backfillEnrichment([asset.id]);

      await expect(sut.get(asset.id)).resolves.toMatchObject({
        generatedTags: ['generated-tag'],
        requiresReview: false,
      });
      const remaining = await defaultDatabase
        .selectFrom('tag_asset')
        .select('tagId')
        .where('assetId', '=', asset.id)
        .execute();
      expect(remaining).toEqual([{ tagId: kept.id }]);
    });

    it('should flag generated tags for review when the applied hash does not match', async () => {
      const { ctx, sut } = setup();
      const { user, asset } = await newEnrichedAsset(ctx);
      const { tag } = await ctx.newTag({ userId: user.id, value: 'generated-tag' });
      await ctx.newTagAsset({ tagIds: [tag.id], assetIds: [asset.id] });
      await ctx.newMetadata({
        assetId: asset.id,
        key: AssetMetadataKey.MlEnrichment,
        value: {
          description: {
            status: 'success',
            result: { tags: ['generated-tag'] },
            appliedTagValues: ['generated-tag'],
            appliedTagHash: 'wrong',
          },
        },
      });

      await sut.backfillEnrichment([asset.id]);

      await expect(sut.get(asset.id)).resolves.toMatchObject({ requiresReview: true });
      await expect(
        defaultDatabase.selectFrom('tag_asset').select('tagId').where('assetId', '=', asset.id).execute(),
      ).resolves.toEqual([{ tagId: tag.id }]);
    });

    it('should strip a proven generated description and repair the legacy exif row', async () => {
      const { ctx, sut } = setup();
      const { asset } = await newEnrichedAsset(ctx);
      const generated = 'A generated scene';
      await ctx.newExif({ assetId: asset.id, description: `my words\n\nAI description: ${generated}` });
      await ctx.newMetadata({
        assetId: asset.id,
        key: AssetMetadataKey.MlEnrichment,
        value: {
          description: {
            status: 'success',
            result: { description: generated },
            appliedDescriptionHash: createHash('sha256').update(JSON.stringify(generated)).digest('hex'),
          },
        },
      });

      await sut.backfillEnrichment([asset.id]);

      await expect(sut.get(asset.id)).resolves.toMatchObject({
        userDescription: 'my words',
        generatedDescription: generated,
        requiresReview: false,
      });
      await expect(
        defaultDatabase
          .selectFrom('asset_exif')
          .select('description')
          .where('assetId', '=', asset.id)
          .executeTakeFirst(),
      ).resolves.toEqual({ description: 'my words' });
    });

    it('should delete stale sidecar rows for ids that no longer resolve to assets', async () => {
      const { ctx, sut } = setup();
      const { asset } = await newEnrichedAsset(ctx);
      await sut.initialize([asset.id]);
      const stale = randomUUID();
      await sql`INSERT INTO immich_fork.asset_enrichment ("assetId") VALUES (${stale}::uuid)`.execute(defaultDatabase);

      await sut.backfillEnrichment([asset.id, stale]);

      await expect(sut.get(stale)).resolves.toBeUndefined();
      await expect(sut.get(asset.id)).resolves.toBeDefined();
    });
  });
});

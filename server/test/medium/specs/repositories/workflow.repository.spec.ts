import { Kysely } from 'kysely';
import { AssetMetadataKey, AssetVisibility } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { WorkflowRepository } from 'src/repositories/workflow.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(WorkflowRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(WorkflowRepository.name, () => {
  describe('isWorkflowEligible', () => {
    /**
     * Regression test for R1: the NSFW EXISTS subquery in `utils/database.ts`
     * was self-shadowed because the inner `FROM asset` reused the outer alias.
     * Both `asset.id` references resolved to the inner table → the EXISTS
     * effectively asked "is ANY asset NSFW in the DB" instead of "is THIS
     * asset NSFW." Effect: any deployment with ≥1 NSFW asset reported
     * isNsfw=true for every isWorkflowEligible call and ALL workflows were
     * blocked for ALL assets.
     *
     * This test creates two assets, marks one NSFW, and asserts that the
     * other one is still reported as eligible. Without the alias fix, the
     * second assertion would (incorrectly) return false.
     */
    it('reports only the NSFW asset as ineligible when the DB contains a mix', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();

      const { asset: nsfwAsset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: safeAsset } = await ctx.newAsset({ ownerId: user.id });

      // Mark only nsfwAsset as NSFW. This row triggers the inner-table
      // shadowing bug because the broken EXISTS would match for ANY asset
      // having is_nsfw=true.
      await defaultDatabase
        .updateTable('asset')
        .set({ is_nsfw: true })
        .where('id', '=', nsfwAsset.id)
        .execute();

      await ctx.newMetadata({
        assetId: nsfwAsset.id,
        key: AssetMetadataKey.MlEnrichment,
        value: { nsfwDetection: { status: 'success', result: { isNsfw: true } } },
      });
      await ctx.newMetadata({
        assetId: safeAsset.id,
        key: AssetMetadataKey.MlEnrichment,
        value: { nsfwDetection: { status: 'success', result: { isNsfw: false } } },
      });

      await expect(sut.isWorkflowEligible(nsfwAsset.id, { requireEnrichment: false })).resolves.toBe(false);
      await expect(sut.isWorkflowEligible(safeAsset.id, { requireEnrichment: false })).resolves.toBe(true);
    });

    it('returns false when the asset does not exist', async () => {
      const { sut } = setup(await getKyselyDB());
      await expect(
        sut.isWorkflowEligible('00000000-0000-4000-a000-000000000000', { requireEnrichment: false }),
      ).resolves.toBe(false);
    });

    it('returns false for Hidden and Locked assets', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      const { asset: hidden } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Hidden });
      const { asset: locked } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });

      await expect(sut.isWorkflowEligible(hidden.id, { requireEnrichment: false })).resolves.toBe(false);
      await expect(sut.isWorkflowEligible(locked.id, { requireEnrichment: false })).resolves.toBe(false);
    });

    it('respects requireEnrichment when ml-enrichment metadata is absent', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      await expect(sut.isWorkflowEligible(asset.id, { requireEnrichment: true })).resolves.toBe(false);
      await expect(sut.isWorkflowEligible(asset.id, { requireEnrichment: false })).resolves.toBe(true);
    });

    it('returns true when requireEnrichment is set and ml-enrichment metadata is present', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      await ctx.newMetadata({
        assetId: asset.id,
        key: AssetMetadataKey.MlEnrichment,
        value: { nsfwDetection: { status: 'success', result: { isNsfw: false } } },
      });

      await expect(sut.isWorkflowEligible(asset.id, { requireEnrichment: true })).resolves.toBe(true);
    });
  });
});

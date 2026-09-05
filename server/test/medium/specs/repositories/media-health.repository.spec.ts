import { Kysely } from 'kysely';
import { AssetStatus, MediaHealthCategory, MediaHealthSeverity, MediaHealthStatus } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MediaHealthRepository, UpsertMediaHealthFinding } from 'src/repositories/media-health.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getActiveForkKyselyDB as getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: new MediaHealthRepository(defaultDatabase) };
};

const findingDto = (assetId: string, originalPath: string, runId: string | null): UpsertMediaHealthFinding => ({
  assetId,
  runId,
  category: MediaHealthCategory.Missing,
  status: MediaHealthStatus.Missing,
  severity: MediaHealthSeverity.Critical,
  originalPath,
  originalFileName: 'photo.jpg',
  evidence: { reason: 'stat failed' },
  resolution: {},
  checkedAt: new Date(),
});

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(MediaHealthRepository.name, () => {
  describe('scan bookkeeping', () => {
    it('creates a running run and finishes it with counts and a finish time', async () => {
      const { sut } = setup();

      const run = await sut.createRun(MediaHealthCategory.Corrupt);
      await expect(sut.getLatestRun(MediaHealthCategory.Corrupt)).resolves.toMatchObject({
        id: run.id,
        status: 'running',
        finishedAt: null,
      });

      const finished = await sut.finishRun(run.id, {
        status: 'completed',
        totalAssets: 10,
        checkedAssets: 10,
        foundAssets: 2,
      });
      expect(finished).toMatchObject({ id: run.id, status: 'completed', totalAssets: 10, foundAssets: 2 });
      expect(finished?.finishedAt).not.toBeNull();
    });

    it('getLatestRun returns the most recent run per category', async () => {
      const { sut } = setup();

      const older = await sut.createRun(MediaHealthCategory.Missing);
      await sut.finishRun(older.id, { status: 'completed' });
      const newer = await sut.createRun(MediaHealthCategory.Missing);

      await expect(sut.getLatestRun(MediaHealthCategory.Missing)).resolves.toMatchObject({ id: newer.id });
    });

    it('returns an owner run even before it has findings and never substitutes an ownerless run', async () => {
      const { ctx, sut } = setup();
      const [{ user: firstUser }, { user: secondUser }] = await Promise.all([ctx.newUser(), ctx.newUser()]);
      const firstRun = await sut.createRun(MediaHealthCategory.Missing, firstUser.id);
      await sut.createRun(MediaHealthCategory.Missing, secondUser.id);
      await sut.createRun(MediaHealthCategory.Missing);

      await expect(sut.getLatestRun(MediaHealthCategory.Missing, firstUser.id)).resolves.toMatchObject({
        id: firstRun.id,
        ownerId: firstUser.id,
      });
    });
  });

  describe('finding state transitions', () => {
    it('scopes finding reads and dismissals to one owner', async () => {
      const { ctx, sut } = setup();
      const [{ user: firstUser }, { user: secondUser }] = await Promise.all([ctx.newUser(), ctx.newUser()]);
      const [{ asset: firstAsset }, { asset: secondAsset }] = await Promise.all([
        ctx.newAsset({ ownerId: firstUser.id }),
        ctx.newAsset({ ownerId: secondUser.id }),
      ]);
      const run = await sut.createRun(MediaHealthCategory.Missing, firstUser.id);
      const [first, second] = await Promise.all([
        sut.upsertFinding(findingDto(firstAsset.id, firstAsset.originalPath, run.id)),
        sut.upsertFinding(findingDto(secondAsset.id, secondAsset.originalPath, run.id)),
      ]);

      await expect(sut.list({ ownerId: firstUser.id, size: 10 })).resolves.toEqual([
        expect.objectContaining({ id: first.id }),
      ]);
      await expect(sut.getLatestRun(MediaHealthCategory.Missing, firstUser.id)).resolves.toEqual(
        expect.objectContaining({ id: run.id }),
      );
      await expect(sut.getByIds([first.id, second.id], firstUser.id)).resolves.toEqual([
        expect.objectContaining({ id: first.id }),
      ]);
      await sut.markDismissed([first.id, second.id], firstUser.id);

      await expect(sut.getByIds([second.id])).resolves.toEqual([
        expect.objectContaining({ id: second.id, status: MediaHealthStatus.Missing }),
      ]);
    });

    it('upserts on (assetId, category) instead of duplicating findings', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const run = await sut.createRun(MediaHealthCategory.Missing);

      const first = await sut.upsertFinding(findingDto(asset.id, asset.originalPath, run.id));
      const second = await sut.upsertFinding({
        ...findingDto(asset.id, asset.originalPath, run.id),
        status: MediaHealthStatus.Candidate,
        severity: MediaHealthSeverity.Warning,
      });

      expect(second.id).toBe(first.id);
      expect(second.status).toBe(MediaHealthStatus.Candidate);
      await expect(sut.getByIds([first.id])).resolves.toHaveLength(1);
    });

    it('filters hidden assets from finding and asset reads', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const [{ asset: visible }, { asset: hidden }] = await Promise.all([
        ctx.newAsset({ ownerId: user.id, is_nsfw: false }),
        ctx.newAsset({ ownerId: user.id, is_nsfw: true }),
      ]);
      const run = await sut.createRun(MediaHealthCategory.Missing, user.id);
      const [visibleFinding, hiddenFinding] = await Promise.all([
        sut.upsertFinding(findingDto(visible.id, visible.originalPath, run.id)),
        sut.upsertFinding(findingDto(hidden.id, hidden.originalPath, run.id)),
      ]);

      await expect(sut.list({ ownerId: user.id, privacy: { excludeNsfw: true }, size: 10 })).resolves.toEqual([
        expect.objectContaining({ id: visibleFinding.id }),
      ]);
      await expect(
        sut.getByIds([visibleFinding.id, hiddenFinding.id], user.id, { excludeNsfw: true }),
      ).resolves.toEqual([expect.objectContaining({ id: visibleFinding.id })]);
      await expect(sut.getAssets([visible.id, hidden.id], user.id, { excludeNsfw: true })).resolves.toEqual([
        expect.objectContaining({ id: visible.id }),
      ]);
    });

    it('rolls back every managed relink write when the asset checksum conflicts', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const sha1 = Buffer.alloc(20, 1);
      const sha256 = Buffer.alloc(32, 2);
      const { asset } = await ctx.newAsset({ ownerId: user.id, checksum: sha1 });
      await ctx.newAsset({ ownerId: user.id, checksum: sha256 });
      const run = await sut.createRun(MediaHealthCategory.Missing, user.id);
      const finding = await sut.upsertFinding(findingDto(asset.id, asset.originalPath, run.id));
      const recoveredPath = `/data/upload/${user.id}/recovered.jpg`;

      await expect(
        sut.relinkManagedAsset({
          assetId: asset.id,
          ownerId: user.id,
          healthId: finding.id,
          originalPath: recoveredPath,
          originalFileName: asset.originalFileName,
          expectedChecksum: sha1,
          sha1,
          sha256,
          sizeInBytes: 100,
          fileModifiedAt: new Date(),
        }),
      ).rejects.toThrow();

      await expect(
        defaultDatabase
          .selectFrom('asset')
          .select(['originalPath', 'checksum'])
          .where('id', '=', asset.id!)
          .executeTakeFirst(),
      ).resolves.toMatchObject({ originalPath: asset.originalPath, checksum: sha1 });
      await expect(
        defaultDatabase.selectFrom('physical_file').select('id').where('path', '=', recoveredPath).executeTakeFirst(),
      ).resolves.toBeUndefined();
      await expect(sut.getByIds([finding.id])).resolves.toEqual([
        expect.objectContaining({ status: MediaHealthStatus.Missing, originalFileName: 'photo.jpg' }),
      ]);
    });

    it('rejects a relink when the target asset is no longer active', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const sha1 = Buffer.alloc(20, 1);
      const sha256 = Buffer.alloc(32, 2);
      const { asset } = await ctx.newAsset({ ownerId: user.id, checksum: sha1 });
      const run = await sut.createRun(MediaHealthCategory.Missing, user.id);
      const finding = await sut.upsertFinding(findingDto(asset.id, asset.originalPath, run.id));
      await defaultDatabase
        .updateTable('asset')
        .set({ status: AssetStatus.Trashed })
        .where('id', '=', asset.id!)
        .execute();

      await expect(
        sut.relinkManagedAsset({
          assetId: asset.id,
          ownerId: user.id,
          healthId: finding.id,
          originalPath: `/data/upload/${user.id}/recovered.jpg`,
          originalFileName: asset.originalFileName,
          expectedChecksum: sha1,
          sha1,
          sha256,
          sizeInBytes: 100,
          fileModifiedAt: new Date(),
        }),
      ).resolves.toBe(false);
    });

    it('commits the asset, physical file, digest evidence, and finding together', async () => {
      const { ctx, sut } = setup();
      const [{ user: owner }, { user: candidateOwner }] = await Promise.all([ctx.newUser(), ctx.newUser()]);
      const sha1 = Buffer.alloc(20, 1);
      const sha256 = Buffer.alloc(32, 2);
      const { asset } = await ctx.newAsset({ ownerId: owner.id, checksum: sha1, originalFileName: 'photo.jpg' });
      const recoveredPath = `/data/upload/${candidateOwner.id}/recovered.jpg`;
      const { asset: candidateAsset } = await ctx.newAsset({
        ownerId: candidateOwner.id,
        checksum: sha256,
        originalPath: recoveredPath,
      });
      const run = await sut.createRun(MediaHealthCategory.Missing, owner.id);
      const finding = await sut.upsertFinding(findingDto(asset.id, asset.originalPath, run.id));
      const modifiedAt = new Date('2026-09-04T00:00:00Z');

      await expect(
        sut.relinkManagedAsset({
          assetId: asset.id,
          ownerId: owner.id,
          healthId: finding.id,
          originalPath: recoveredPath,
          originalFileName: asset.originalFileName,
          expectedChecksum: sha1,
          sha1,
          sha256,
          sizeInBytes: 100,
          fileModifiedAt: modifiedAt,
        }),
      ).resolves.toBe(true);

      const relinked = await defaultDatabase
        .selectFrom('asset')
        .innerJoin('physical_file', 'physical_file.id', 'asset.physicalOriginalFileId')
        .select(['asset.originalPath', 'asset.checksum', 'asset.fileModifiedAt', 'physical_file.canonicalAssetId'])
        .where('asset.id', '=', asset.id!)
        .executeTakeFirstOrThrow();
      expect(relinked).toMatchObject({
        originalPath: recoveredPath,
        checksum: sha256,
        fileModifiedAt: modifiedAt,
        canonicalAssetId: candidateAsset.id,
      });
      await expect(sut.getAssetChecksums([asset.id])).resolves.toEqual([
        expect.objectContaining({ assetId: asset.id, sha1, sha256, sizeInBytes: 100 }),
      ]);
      await expect(sut.getByIds([finding.id])).resolves.toEqual([
        expect.objectContaining({
          status: MediaHealthStatus.Relinked,
          originalPath: recoveredPath,
          originalFileName: 'photo.jpg',
        }),
      ]);
    });

    it('markResolved moves the finding to resolved/info and stamps resolvedAt', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const run = await sut.createRun(MediaHealthCategory.Missing);
      const finding = await sut.upsertFinding(findingDto(asset.id, asset.originalPath, run.id));

      await sut.markResolved(MediaHealthCategory.Missing, asset.id);

      const [resolved] = await sut.getByIds([finding.id]);
      expect(resolved).toMatchObject({ status: MediaHealthStatus.Resolved, severity: MediaHealthSeverity.Info });
      expect(resolved.resolvedAt).not.toBeNull();
    });

    it('markDismissed stamps dismissedAt; markStatus flips status only', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const run = await sut.createRun(MediaHealthCategory.Missing);
      const finding = await sut.upsertFinding(findingDto(asset.id, asset.originalPath, run.id));

      await sut.markDismissed([finding.id]);
      let [row] = await sut.getByIds([finding.id]);
      expect(row.status).toBe(MediaHealthStatus.Dismissed);
      expect(row.dismissedAt).not.toBeNull();

      await sut.markStatus([finding.id], MediaHealthStatus.Relinked);
      [row] = await sut.getByIds([finding.id]);
      expect(row.status).toBe(MediaHealthStatus.Relinked);
    });
  });

  describe('replaceCandidates', () => {
    it('replaces the candidate set and orders by visual match score', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const run = await sut.createRun(MediaHealthCategory.Missing);
      const finding = await sut.upsertFinding(findingDto(asset.id, asset.originalPath, run.id));
      const candidate = (candidatePath: string, visualMatchScore: number) => ({
        healthId: finding.id,
        candidatePath,
        status: MediaHealthStatus.Candidate,
        visualMatchScore,
        evidence: {},
        resolution: {},
        checkedAt: new Date(),
      });

      await sut.replaceCandidates(finding.id, [candidate('/old/a.jpg', 0.5)]);
      await sut.replaceCandidates(finding.id, [candidate('/new/low.jpg', 0.4), candidate('/new/high.jpg', 0.9)]);

      const candidates = await sut.getCandidatesByHealthIds([finding.id]);
      expect(candidates.map(({ candidatePath }) => candidatePath)).toEqual(['/new/high.jpg', '/new/low.jpg']);
    });

    it('rejects candidates that belong to a different finding', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const run = await sut.createRun(MediaHealthCategory.Missing);
      const finding = await sut.upsertFinding(findingDto(asset.id, asset.originalPath, run.id));

      await expect(
        sut.replaceCandidates(finding.id, [
          {
            healthId: '00000000-0000-4000-a000-000000000009',
            candidatePath: '/x.jpg',
            status: MediaHealthStatus.Candidate,
            visualMatchScore: 0.5,
            evidence: {},
            resolution: {},
            checkedAt: new Date(),
          },
        ]),
      ).rejects.toThrow('Cannot replace media-health candidates for multiple findings');
    });
  });
});

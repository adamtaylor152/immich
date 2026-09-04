import { Kysely } from 'kysely';
import { MediaHealthCategory, MediaHealthSeverity, MediaHealthStatus } from 'src/enum';
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
  });

  describe('finding state transitions', () => {
    it('scopes finding reads and dismissals to one owner', async () => {
      const { ctx, sut } = setup();
      const [{ user: firstUser }, { user: secondUser }] = await Promise.all([ctx.newUser(), ctx.newUser()]);
      const [{ asset: firstAsset }, { asset: secondAsset }] = await Promise.all([
        ctx.newAsset({ ownerId: firstUser.id }),
        ctx.newAsset({ ownerId: secondUser.id }),
      ]);
      const run = await sut.createRun(MediaHealthCategory.Missing);
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

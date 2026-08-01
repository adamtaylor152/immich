import { Kysely } from 'kysely';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageCore } from 'src/cores/storage.core';
import { ChecksumAlgorithm } from 'src/enum';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import {
  PhysicalFileRepository,
  PhysicalNormalizationAsset,
  PhysicalNormalizationReservation,
} from 'src/repositories/physical-file.repository';
import { DB } from 'src/schema';
import { ForkStorageNormalizationService } from 'src/services/fork-storage-normalization.service';

describe(ForkStorageNormalizationService.name, () => {
  it('returns a deterministic count and digest independent of input ordering', async () => {
    const results = [
      { assetId: 'asset-b', sha1: 'b'.repeat(40), sha256: '2'.repeat(64), linkCount: 2, verifiedPaths: ['/b'] },
      { assetId: 'asset-a', sha1: 'a'.repeat(40), sha256: '1'.repeat(64), linkCount: 2, verifiedPaths: ['/a'] },
    ];
    const service = Object.create(ForkStorageNormalizationService.prototype) as ForkStorageNormalizationService;
    vi.spyOn(service, 'normalizeAsset').mockImplementation((assetId) =>
      Promise.resolve(results.find((item) => item.assetId === assetId)!),
    );

    const forward = await service.normalizeBatch(['asset-b', 'asset-a']);
    const reverse = await service.normalizeBatch(['asset-a', 'asset-b']);

    expect(forward).toEqual(reverse);
    expect(forward.count).toBe(2);
    expect(forward.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('removes exclusively published files after a database failure and succeeds on retry during return', async () => {
    const root = await mkdtemp(join(tmpdir(), 'immich-normalization-unit-'));
    StorageCore.setMediaLocation(root);
    const bytes = Buffer.from('database retry bytes');
    const assetId = randomUUID();
    const sourcePath = join(root, 'canonical.jpg');
    const targetPath = join(root, `${assetId}.jpg`);
    await writeFile(sourcePath, bytes);
    const claim = { kind: 'storage' as const, claimToken: randomUUID(), claimedIds: [assetId] };
    const asset: PhysicalNormalizationAsset = {
      id: assetId,
      checksum: createHash('sha256').update(bytes).digest(),
      checksumAlgorithm: ChecksumAlgorithm.sha256File,
      originalPath: sourcePath,
      physicalFileId: null,
      physicalCanonicalAssetId: randomUUID(),
      physicalChecksum: null,
      physicalCreatedAt: null,
      physicalPath: sourcePath,
      physicalSizeInBytes: bytes.length,
      physicalType: null,
      physicalUpdatedAt: null,
      sharedPathCount: 2,
      libraryImportPaths: [],
      mappedUpstreamPath: null,
    };
    let failCommit = true;
    let reservationCreated = false;
    const reservation: PhysicalNormalizationReservation = {
      assetId,
      token: randomUUID(),
      sourcePath,
      upstreamPath: targetPath,
      temporaryPath: join(root, `.${assetId}.jpg.normalize`),
    };
    const repository = {
      createReturnNormalizationReservation: () => {
        const recovered = reservationCreated;
        reservationCreated = true;
        return Promise.resolve({ status: 'reserved' as const, asset, reservation, recovered });
      },
      releaseReturnNormalizationReservation: () => {
        reservationCreated = false;
        return Promise.resolve();
      },
      withLockedReturnNormalizationAsset: async (
        _assetId: string,
        _token: string,
        _claim: unknown,
        callback: (context: {
          asset: PhysicalNormalizationAsset;
          reservation: PhysicalNormalizationReservation;
          commit: () => Promise<void>;
        }) => Promise<unknown>,
      ) =>
        callback({
          asset,
          reservation,
          commit: () => (failCommit ? Promise.reject(new Error('database commit failed')) : Promise.resolve()),
        }),
    } as unknown as PhysicalFileRepository;
    const service = new ForkStorageNormalizationService({} as Kysely<DB>, new CryptoRepository(), repository);

    await expect(service.normalizeAsset(assetId, claim)).rejects.toThrow('database commit failed');
    await expect(lstat(targetPath)).rejects.toMatchObject({ code: 'ENOENT' });
    const remainingFiles = await readdir(root);
    expect(remainingFiles.filter((path) => path.endsWith('.normalize'))).toEqual([]);

    failCommit = false;
    await expect(service.normalizeAsset(assetId, claim)).resolves.toMatchObject({ assetId });
    await expect(readFile(targetPath)).resolves.toEqual(bytes);
    await rm(root, { recursive: true, force: true });
  });

  it('preserves the shared deduplicated path during steady-state normalization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'immich-normalization-unit-'));
    StorageCore.setMediaLocation(root);
    const bytes = Buffer.from('steady state shared bytes');
    const assetId = randomUUID();
    const sourcePath = join(root, 'canonical.jpg');
    await writeFile(sourcePath, bytes);
    const asset: PhysicalNormalizationAsset = {
      id: assetId,
      checksum: createHash('sha256').update(bytes).digest(),
      checksumAlgorithm: ChecksumAlgorithm.sha256File,
      originalPath: sourcePath,
      physicalFileId: randomUUID(),
      physicalCanonicalAssetId: randomUUID(),
      physicalChecksum: null,
      physicalCreatedAt: null,
      physicalPath: sourcePath,
      physicalSizeInBytes: bytes.length,
      physicalType: null,
      physicalUpdatedAt: null,
      sharedPathCount: 2,
      libraryImportPaths: [],
      mappedUpstreamPath: null,
    };
    const reservation: PhysicalNormalizationReservation = {
      assetId,
      token: randomUUID(),
      sourcePath,
      // steady-state target must be the shared canonical path itself
      upstreamPath: sourcePath,
      temporaryPath: join(root, `.canonical.jpg.${assetId}.normalize`),
    };
    const commit = vi.fn(() => Promise.resolve());
    const repository = {
      createNormalizationReservation: () =>
        Promise.resolve({ status: 'reserved' as const, asset, reservation, recovered: false }),
      releaseNormalizationReservation: () => Promise.resolve(),
      withLockedNormalizationAsset: async (
        _assetId: string,
        _token: string,
        callback: (context: {
          asset: PhysicalNormalizationAsset;
          reservation: PhysicalNormalizationReservation;
          commit: () => Promise<void>;
        }) => Promise<unknown>,
      ) => callback({ asset, reservation, commit }),
    } as unknown as PhysicalFileRepository;
    const service = new ForkStorageNormalizationService({} as Kysely<DB>, new CryptoRepository(), repository);

    await expect(service.normalizeAsset(assetId)).resolves.toMatchObject({
      assetId,
      verifiedPaths: [sourcePath],
    });
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ upstreamPath: sourcePath }));
    // no per-asset copy was materialized — the shared file is the only one left
    const remainingFiles = await readdir(root);
    expect(remainingFiles).toEqual(['canonical.jpg']);
    await rm(root, { recursive: true, force: true });
  });
});

import { Kysely } from 'kysely';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, link, lstat, open, realpath, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative } from 'node:path';
import { StorageCore } from 'src/cores/storage.core';
import { ChecksumAlgorithm } from 'src/enum';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { PhysicalFileRepository, PhysicalNormalizationAsset } from 'src/repositories/physical-file.repository';
import { DB } from 'src/schema';

export type NormalizationResult = {
  assetId: string;
  sha1: string;
  sha256: string;
  linkCount: number;
  verifiedPaths: string[];
};

export type NormalizationBatchResult = { count: number; digest: string };

class ReservationInodeProofError extends Error {}

export class ForkStorageNormalizationService {
  private readonly cryptoRepository: CryptoRepository;
  private readonly physicalFileRepository: PhysicalFileRepository;

  constructor(
    db: Kysely<DB>,
    cryptoRepository = new CryptoRepository(),
    physicalFileRepository = new PhysicalFileRepository(db),
  ) {
    this.cryptoRepository = cryptoRepository;
    this.physicalFileRepository = physicalFileRepository;
  }

  async normalizeAsset(assetId: string): Promise<NormalizationResult> {
    try {
      return await this.normalizeAssetWithReservation(assetId);
    } catch (error) {
      if (error instanceof Error && error.message.includes('durable storage reservation is missing or stale')) {
        return this.normalizeAssetWithReservation(assetId);
      }
      throw error;
    }
  }

  private async normalizeAssetWithReservation(assetId: string): Promise<NormalizationResult> {
    const prepared = await this.physicalFileRepository.createNormalizationReservation(assetId, (asset) =>
      this.getUpstreamPath(asset),
    );
    let createdPath: string | undefined;
    let metadataCommitted = false;
    try {
      const result = await this.physicalFileRepository.withLockedNormalizationAsset(
        assetId,
        prepared.reservation.token,
        async ({ asset, reservation, commit }) => {
          const sourcePath = asset.originalPath;
          const upstreamPath = reservation.upstreamPath;
          if (upstreamPath !== this.getUpstreamPath(asset)) {
            throw new Error(`Asset ${assetId} durable storage reservation target is stale`);
          }
          await this.assertSafePaths(asset, sourcePath, upstreamPath);
          const source = await this.cryptoRepository.hashFileDigests(sourcePath);
          this.verifyExpectedContent(asset, source);
          await this.ensureReservationTemp(asset, sourcePath, reservation.temporaryPath, upstreamPath, source);
          createdPath = await this.publishOrAdoptReservationTemp(
            asset,
            reservation.temporaryPath,
            upstreamPath,
            source,
          );

          await this.assertRegularFile(upstreamPath, 'normalization target');
          const target = await this.cryptoRepository.hashFileDigests(upstreamPath);
          const targetStats = await lstat(upstreamPath);
          if (
            target.sizeInBytes !== source.sizeInBytes ||
            !target.sha1.equals(source.sha1) ||
            !target.sha256.equals(source.sha256)
          ) {
            throw new Error(`Staged storage verification mismatch for asset ${assetId}`);
          }

          const verifiedPaths = [...new Set([asset.physicalPath ?? sourcePath, upstreamPath])];
          for (const verifiedPath of verifiedPaths) {
            await this.assertSafePaths(asset, verifiedPath, verifiedPath);
            await this.assertRegularFile(verifiedPath, 'verified path');
            if (verifiedPath === upstreamPath) {
              continue;
            }
            const verified = await this.cryptoRepository.hashFileDigests(verifiedPath);
            if (
              verified.sizeInBytes !== target.sizeInBytes ||
              !verified.sha1.equals(target.sha1) ||
              !verified.sha256.equals(target.sha256)
            ) {
              throw new Error(`Verified path content mismatch for asset ${assetId}: ${verifiedPath}`);
            }
          }
          await commit({
            evidence: {
              sourcePath,
              upstreamPath,
              sizeInBytes: target.sizeInBytes,
              sha1: target.sha1.toString('hex'),
              sha256: target.sha256.toString('hex'),
              device: targetStats.dev,
              inode: targetStats.ino,
            },
            linkCount: targetStats.nlink,
            sha1: target.sha1,
            sha256: target.sha256,
            sizeInBytes: target.sizeInBytes,
            upstreamPath,
            verifiedPaths,
          });

          return {
            assetId,
            sha1: target.sha1.toString('hex'),
            sha256: target.sha256.toString('hex'),
            linkCount: targetStats.nlink,
            verifiedPaths,
          };
        },
      );
      metadataCommitted = true;
      await this.removeReservationTemp(prepared.asset, prepared.reservation.temporaryPath);
      await this.physicalFileRepository.releaseNormalizationReservation(assetId, prepared.reservation.token);
      return result;
    } catch (error) {
      if (createdPath && !metadataCommitted) {
        await rm(createdPath, { force: true });
        await this.syncDirectory(dirname(createdPath));
      }
      if (
        !metadataCommitted &&
        (!prepared.recovered || createdPath || error instanceof ReservationInodeProofError)
      ) {
        await this.removeReservationTemp(prepared.asset, prepared.reservation.temporaryPath);
        await this.physicalFileRepository.releaseNormalizationReservation(assetId, prepared.reservation.token);
      }
      throw error;
    }
  }

  async normalizeBatch(ids: string[]): Promise<NormalizationBatchResult> {
    const results: NormalizationResult[] = [];
    for (const id of ids) {
      results.push(await this.normalizeAsset(id));
    }
    results.sort((left, right) => left.assetId.localeCompare(right.assetId));
    const digest = createHash('sha256').update(JSON.stringify(results)).digest('hex');
    return { count: results.length, digest };
  }

  private verifyExpectedContent(
    asset: PhysicalNormalizationAsset,
    actual: { sha1: Buffer; sha256: Buffer; sizeInBytes: number },
  ): void {
    const expectedSize = asset.physicalSizeInBytes;
    if (expectedSize !== null && expectedSize !== actual.sizeInBytes) {
      throw new Error(
        `Original size mismatch for asset ${asset.id}: expected ${expectedSize}, received ${actual.sizeInBytes}`,
      );
    }

    const expectedAssetDigest =
      asset.checksumAlgorithm === ChecksumAlgorithm.sha256File
        ? actual.sha256
        : asset.checksumAlgorithm === ChecksumAlgorithm.sha1File
          ? actual.sha1
          : undefined;
    if (expectedAssetDigest && !asset.checksum.equals(expectedAssetDigest)) {
      throw new Error(`Original checksum mismatch for asset ${asset.id}`);
    }

    if (asset.physicalChecksum) {
      const expectedPhysicalDigest = asset.physicalChecksum.length === 32 ? actual.sha256 : actual.sha1;
      if (!asset.physicalChecksum.equals(expectedPhysicalDigest)) {
        throw new Error(`Physical checksum mismatch for asset ${asset.id}`);
      }
    }
  }

  private getUpstreamPath(asset: PhysicalNormalizationAsset): string {
    const sharedForkPath = asset.sharedPathCount > 1;
    const ownsCanonicalPath = asset.physicalCanonicalAssetId === asset.id;
    if (!sharedForkPath || ownsCanonicalPath) {
      return asset.originalPath;
    }

    const parsed = parse(asset.originalPath);
    const assetPath = join(parsed.dir, `${asset.id}${parsed.ext}`);
    return assetPath === asset.originalPath ? join(parsed.dir, `${parsed.name}.${asset.id}${parsed.ext}`) : assetPath;
  }

  private async ensureReservationTemp(
    asset: PhysicalNormalizationAsset,
    sourcePath: string,
    temporaryPath: string,
    targetPath: string,
    expected: { sha1: Buffer; sha256: Buffer; sizeInBytes: number },
  ): Promise<void> {
    if (dirname(temporaryPath) !== dirname(targetPath) || !parse(temporaryPath).base.endsWith('.normalize')) {
      throw new Error(`Durable normalization reservation has an unsafe temporary path: ${temporaryPath}`);
    }
    await this.assertSafeParent(asset, temporaryPath, 'temporary normalization target');
    try {
      await this.assertRegularFile(temporaryPath, 'reserved temporary normalization target');
      const existing = await this.cryptoRepository.hashFileDigests(temporaryPath);
      if (
        existing.sizeInBytes !== expected.sizeInBytes ||
        !existing.sha1.equals(expected.sha1) ||
        !existing.sha256.equals(expected.sha256)
      ) {
        throw new Error(`Reserved temporary normalization target does not match source: ${temporaryPath}`);
      }
      return;
    } catch (error) {
      if (!this.isMissingPath(error)) {
        throw error;
      }
    }

    try {
      await link(sourcePath, temporaryPath);
    } catch (error) {
      if (!this.canFallbackToReflink(error)) {
        throw error;
      }
      await copyFile(sourcePath, temporaryPath, constants.COPYFILE_FICLONE_FORCE);
    }

    await this.assertRegularFile(temporaryPath, 'temporary normalization target');

    const handle = await open(temporaryPath, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    const staged = await this.cryptoRepository.hashFileDigests(temporaryPath);
    if (
      staged.sizeInBytes !== expected.sizeInBytes ||
      !staged.sha1.equals(expected.sha1) ||
      !staged.sha256.equals(expected.sha256)
    ) {
      throw new Error(`Temporary normalization target does not match source: ${targetPath}`);
    }
  }

  private async publishOrAdoptReservationTemp(
    asset: PhysicalNormalizationAsset,
    temporaryPath: string,
    targetPath: string,
    expected: { sha1: Buffer; sha256: Buffer; sizeInBytes: number },
  ): Promise<string | undefined> {
    await this.assertSafeParent(asset, temporaryPath, 'temporary normalization target');
    await this.assertSafeParent(asset, targetPath, 'normalization target');
    const temporaryStats = await lstat(temporaryPath);
    if (temporaryStats.isSymbolicLink() || !temporaryStats.isFile()) {
      throw new Error(`temporary normalization target must be a regular non-symlink file: ${temporaryPath}`);
    }
    try {
      await this.assertRegularFile(targetPath, 'existing normalization target');
      const targetStats = await lstat(targetPath);
      if (temporaryStats.dev !== targetStats.dev || temporaryStats.ino !== targetStats.ino) {
        throw new ReservationInodeProofError(
          `Existing normalization target lacks reservation inode proof: ${targetPath}`,
        );
      }
      await this.verifyDigestMatch(targetPath, expected, `Existing normalization target does not match source`);
      return;
    } catch (error) {
      if (!this.isMissingPath(error)) {
        throw error;
      }
    }

    let published = false;
    try {
      await link(temporaryPath, targetPath);
      published = true;
      await this.assertRegularFile(targetPath, 'normalization target');
      await this.syncDirectory(dirname(targetPath));
      const targetStats = await lstat(targetPath);
      if (temporaryStats.dev !== targetStats.dev || temporaryStats.ino !== targetStats.ino) {
        throw new ReservationInodeProofError(
          `Published normalization target lacks reservation inode proof: ${targetPath}`,
        );
      }
      await this.verifyDigestMatch(targetPath, expected, `Published normalization target does not match source`);
      return targetPath;
    } catch (error) {
      if (published) {
        await rm(targetPath, { force: true });
        await this.syncDirectory(dirname(targetPath));
      }
      throw error;
    }
  }

  private async verifyDigestMatch(
    path: string,
    expected: { sha1: Buffer; sha256: Buffer; sizeInBytes: number },
    message: string,
  ): Promise<void> {
    const actual = await this.cryptoRepository.hashFileDigests(path);
    if (
      actual.sizeInBytes !== expected.sizeInBytes ||
      !actual.sha1.equals(expected.sha1) ||
      !actual.sha256.equals(expected.sha256)
    ) {
      throw new Error(`${message}: ${path}`);
    }
  }

  private async removeReservationTemp(asset: PhysicalNormalizationAsset, temporaryPath: string): Promise<void> {
    try {
      await this.assertRegularFile(temporaryPath, 'reserved temporary normalization target');
    } catch (error) {
      if (this.isMissingPath(error)) {
        return;
      }
      return;
    }
    try {
      await this.assertSafeParent(asset, temporaryPath, 'temporary normalization target');
    } catch {
      return;
    }
    await rm(temporaryPath);
    await this.syncDirectory(dirname(temporaryPath));
  }

  private async assertSafePaths(
    asset: PhysicalNormalizationAsset,
    sourcePath: string,
    targetPath: string,
  ): Promise<void> {
    await this.assertRegularFile(sourcePath, 'normalization source');
    const roots = [StorageCore.getMediaLocation(), ...asset.libraryImportPaths];
    const resolvedRoots = await Promise.all(roots.map((root) => realpath(root).catch(() => {})));
    const resolvedSource = await realpath(sourcePath);
    if (!resolvedRoots.some((root) => root && this.isWithin(root, resolvedSource))) {
      throw new Error(`Normalization source is outside approved storage roots: ${sourcePath}`);
    }
    await this.assertSafeParent(asset, targetPath, 'normalization target');
  }

  private async assertSafeParent(asset: PhysicalNormalizationAsset, path: string, label: string): Promise<void> {
    const roots = [StorageCore.getMediaLocation(), ...asset.libraryImportPaths];
    const resolvedRoots = await Promise.all(roots.map((root) => realpath(root).catch(() => {})));
    const resolvedTargetParent = await realpath(dirname(path));
    if (!resolvedRoots.some((root) => root && this.isWithin(root, resolvedTargetParent))) {
      throw new Error(`${label} is outside approved storage roots: ${path}`);
    }
  }

  private isWithin(root: string, candidate: string): boolean {
    const path = relative(root, candidate);
    return path === '' || (!path.startsWith('..') && !isAbsolute(path));
  }

  private async assertRegularFile(path: string, label: string): Promise<void> {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`${label} must be a regular non-symlink file: ${path}`);
    }
  }

  private async syncDirectory(path: string): Promise<void> {
    const directory = await open(path, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }

  private isMissingPath(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
  }

  private canFallbackToReflink(error: unknown): boolean {
    return (
      error instanceof Error &&
      'code' in error &&
      ['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP'].includes(String(error.code))
    );
  }
}

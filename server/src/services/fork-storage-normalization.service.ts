import { Kysely } from 'kysely';
import { createHash, randomUUID } from 'node:crypto';
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
    let createdPath: string | undefined;
    try {
      return await this.physicalFileRepository.withLockedNormalizationAsset(
        assetId,
        async ({ asset, reservePath, commit }) => {
          const sourcePath = asset.originalPath;
          const upstreamPath = this.getUpstreamPath(asset);
          await this.assertSafePaths(asset, sourcePath, upstreamPath);
          const source = await this.cryptoRepository.hashFileDigests(sourcePath);
          this.verifyExpectedContent(asset, source);
          const { previouslyOwned } = await reservePath(upstreamPath);

          if (upstreamPath !== sourcePath) {
            createdPath = await this.stageVerifiedLink(sourcePath, upstreamPath, source, previouslyOwned);
          }

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
    } catch (error) {
      if (createdPath) {
        await rm(createdPath, { force: true });
        await this.syncDirectory(dirname(createdPath));
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

  private async stageVerifiedLink(
    sourcePath: string,
    targetPath: string,
    expected: { sha1: Buffer; sha256: Buffer; sizeInBytes: number },
    mayAdoptExisting: boolean,
  ): Promise<string | undefined> {
    try {
      await this.assertRegularFile(targetPath, 'existing normalization target');
      if (!mayAdoptExisting) {
        throw new Error(`Existing normalization target is not durably owned by this asset: ${targetPath}`);
      }
      const existing = await this.cryptoRepository.hashFileDigests(targetPath);
      if (
        existing.sizeInBytes !== expected.sizeInBytes ||
        !existing.sha1.equals(expected.sha1) ||
        !existing.sha256.equals(expected.sha256)
      ) {
        throw new Error(`Existing normalization target does not match source: ${targetPath}`);
      }
      return;
    } catch (error) {
      if (!this.isMissingPath(error)) {
        throw error;
      }
    }

    const temporaryPath = join(dirname(targetPath), `.${parse(targetPath).base}.${randomUUID()}.normalize`);
    let published = false;
    try {
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

      await link(temporaryPath, targetPath);
      published = true;
      await this.assertRegularFile(targetPath, 'normalization target');
      await this.syncDirectory(dirname(targetPath));
      return targetPath;
    } catch (error) {
      if (published) {
        await rm(targetPath, { force: true });
        await this.syncDirectory(dirname(targetPath));
      }
      throw error;
    } finally {
      await rm(temporaryPath, { force: true });
    }
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
    const resolvedTargetParent = await realpath(dirname(targetPath));
    if (!resolvedRoots.some((root) => root && this.isWithin(root, resolvedSource))) {
      throw new Error(`Normalization source is outside approved storage roots: ${sourcePath}`);
    }
    if (!resolvedRoots.some((root) => root && this.isWithin(root, resolvedTargetParent))) {
      throw new Error(`Normalization target is outside approved storage roots: ${targetPath}`);
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

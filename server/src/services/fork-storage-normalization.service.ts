import { Kysely } from 'kysely';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, link, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, parse } from 'node:path';
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
    const asset = await this.physicalFileRepository.getNormalizationAsset(assetId);
    if (!asset) {
      throw new Error(`Asset ${assetId} does not exist`);
    }

    const sourcePath = asset.originalPath;
    const source = await this.cryptoRepository.hashFileDigests(sourcePath);
    this.verifyExpectedContent(asset, source);

    const upstreamPath = this.getUpstreamPath(asset);
    if (upstreamPath !== sourcePath) {
      await this.stageVerifiedLink(sourcePath, upstreamPath, source);
    }

    const target = await this.cryptoRepository.hashFileDigests(upstreamPath);
    const targetStats = await stat(upstreamPath);
    if (
      target.sizeInBytes !== source.sizeInBytes ||
      !target.sha1.equals(source.sha1) ||
      !target.sha256.equals(source.sha256)
    ) {
      throw new Error(`Staged storage verification mismatch for asset ${assetId}`);
    }

    const verifiedPaths = [...new Set([asset.physicalPath ?? sourcePath, upstreamPath])];
    for (const verifiedPath of verifiedPaths) {
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
    await this.physicalFileRepository.commitNormalization({
      asset,
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
  ): Promise<void> {
    try {
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
    try {
      try {
        await link(sourcePath, temporaryPath);
      } catch (error) {
        if (!this.canFallbackToReflink(error)) {
          throw error;
        }
        await copyFile(sourcePath, temporaryPath, constants.COPYFILE_FICLONE_FORCE);
      }

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

      await rename(temporaryPath, targetPath);
      const directory = await open(dirname(targetPath), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await rm(temporaryPath, { force: true });
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

import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import {
  canonicalStorageVerificationDigest,
  ForkCutoverVerificationRepository,
  StorageVerificationBusyError,
  StorageVerificationCandidate,
  StorageVerificationEvidence,
  StorageVerificationRun,
} from 'src/repositories/fork-cutover-verification.repository';
export { canonicalStorageVerificationDigest } from 'src/repositories/fork-cutover-verification.repository';

const required = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
};

const isWithin = (root: string, candidate: string): boolean => {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
};

@Injectable()
export class ForkCutoverVerificationService {
  constructor(private repository: ForkCutoverVerificationRepository) {}

  async start(databaseBackupId: string, snapshotId: string): Promise<StorageVerificationRun> {
    return this.repository.start(
      required(databaseBackupId, 'Database backup ID'),
      required(snapshotId, 'Media snapshot ID'),
    );
  }

  async resume(runId: string, batchSize: number): Promise<StorageVerificationRun> {
    required(runId, 'Run ID');
    if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
      throw new Error('Batch size must be a positive integer');
    }
    try {
      return await this.repository.resume(
        runId,
        batchSize,
        (candidate) => this.verifyCurrentBytes(candidate),
        canonicalStorageVerificationDigest,
      );
    } catch (error) {
      if (error instanceof StorageVerificationBusyError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      await this.repository.markFailure(runId, message);
      throw error;
    }
  }

  async resumeLatest(databaseBackupId: string, snapshotId: string, batchSize: number): Promise<StorageVerificationRun> {
    const run = await this.repository.getLatest(
      required(databaseBackupId, 'Database backup ID'),
      required(snapshotId, 'Media snapshot ID'),
    );
    return this.resume(run.id, batchSize);
  }

  status(runId: string): Promise<StorageVerificationRun> {
    return this.repository.get(required(runId, 'Run ID'));
  }

  statusLatest(databaseBackupId: string, snapshotId: string): Promise<StorageVerificationRun> {
    return this.repository.getLatest(
      required(databaseBackupId, 'Database backup ID'),
      required(snapshotId, 'Media snapshot ID'),
    );
  }

  getLatestComplete(databaseBackupId: string, snapshotId: string): Promise<StorageVerificationRun | null> {
    return this.repository.getLatestComplete(
      required(databaseBackupId, 'Database backup ID'),
      required(snapshotId, 'Media snapshot ID'),
    );
  }

  private async verifyCurrentBytes(candidate: StorageVerificationCandidate): Promise<StorageVerificationEvidence> {
    if (candidate.currentPath !== candidate.path) {
      throw new Error(`Storage verification path drift for asset ${candidate.assetId}`);
    }
    if (
      candidate.approvedRoots.length !== candidate.currentApprovedRoots.length ||
      candidate.approvedRoots.some((root, index) => root !== candidate.currentApprovedRoots[index])
    ) {
      throw new Error(`Storage verification root drift for asset ${candidate.assetId}`);
    }
    const roots = candidate.approvedRoots;
    const resolvedRootCandidates = await Promise.all(roots.map((root) => realpath(root).catch(() => null)));
    const resolvedRoots = resolvedRootCandidates.filter((root): root is string => root !== null);
    const beforePath = await lstat(candidate.path, { bigint: true });
    if (beforePath.isSymbolicLink() || !beforePath.isFile()) {
      throw new Error(`Storage verification requires a regular non-symlink file: ${candidate.path}`);
    }
    const resolvedPath = await realpath(candidate.path);
    if (!resolvedRoots.some((root) => isWithin(root, resolvedPath))) {
      throw new Error(`Storage verification path is outside approved storage roots: ${candidate.path}`);
    }

    const handle = await open(candidate.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isFile() || before.dev !== beforePath.dev || before.ino !== beforePath.ino) {
        throw new Error(`Storage verification file identity changed before hashing: ${candidate.path}`);
      }
      const sha1 = createHash('sha1');
      const sha256 = createHash('sha256');
      let size = 0;
      const stream = handle.createReadStream({ autoClose: false, start: 0 });
      for await (const chunk of stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        sha1.update(bytes);
        sha256.update(bytes);
      }
      const sha1Hex = sha1.digest('hex');
      const sha256Hex = sha256.digest('hex');
      const after = await handle.stat({ bigint: true });
      const afterPath = await lstat(candidate.path, { bigint: true });
      const afterResolvedPath = await realpath(candidate.path);
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs ||
        after.dev !== afterPath.dev ||
        after.ino !== afterPath.ino ||
        resolvedPath !== afterResolvedPath
      ) {
        throw new Error(`Storage verification file changed while hashing: ${candidate.path}`);
      }
      if (
        size !== candidate.expectedSize ||
        sha1Hex !== candidate.expectedSha1.toString('hex') ||
        sha256Hex !== candidate.expectedSha256.toString('hex')
      ) {
        throw new Error(`Storage verification bytes differ from normalized evidence for asset ${candidate.assetId}`);
      }
      if (after.nlink < 1n) {
        throw new Error(`Storage verification found inconsistent link evidence for asset ${candidate.assetId}`);
      }
      return {
        assetId: candidate.assetId,
        path: candidate.path,
        size,
        sha1: sha1Hex,
        sha256: sha256Hex,
        device: after.dev.toString(),
        inode: after.ino.toString(),
        links: Number(after.nlink),
      };
    } finally {
      await handle.close();
    }
  }
}

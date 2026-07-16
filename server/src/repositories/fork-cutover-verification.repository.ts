import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { createHash, randomUUID } from 'node:crypto';
import { StorageCore } from 'src/cores/storage.core';
import { DB } from 'src/schema';

export type StorageVerificationStatus = 'running' | 'completed' | 'failed';

export type StorageVerificationRun = {
  id: string;
  databaseBackupId: string;
  mediaSnapshotId: string;
  status: StorageVerificationStatus;
  applicableAssetCount: number;
  cursor: string | null;
  verifiedCount: number;
  failureCount: number;
  aggregateDigest: string | null;
  failure: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type StorageVerificationCandidate = {
  assetId: string;
  path: string;
  expectedSize: number;
  expectedSha1: Buffer;
  expectedSha256: Buffer;
  currentPath: string | null;
  approvedRoots: string[];
  currentApprovedRoots: string[];
};

export type StorageVerificationEvidence = {
  assetId: string;
  path: string;
  size: number;
  sha1: string;
  sha256: string;
  device: string;
  inode: string;
  links: number;
};

export const canonicalStorageVerificationDigest = (rows: StorageVerificationEvidence[]): string => {
  const lines = rows
    .toSorted((left, right) => left.assetId.localeCompare(right.assetId))
    .map(({ assetId, path, size, sha1, sha256, device, inode, links }) =>
      JSON.stringify({ assetId, path, size, sha1, sha256, device, inode, links }),
    )
    .join('\n');
  return createHash('sha256').update(lines).digest('hex');
};

type RunRow = Omit<
  StorageVerificationRun,
  | 'applicableAssetCount'
  | 'completedAt'
  | 'createdAt'
  | 'mediaSnapshotId'
  | 'updatedAt'
  | 'verifiedCount'
  | 'failureCount'
> & {
  applicableAssetCount: number | string;
  snapshotId: string;
  verifiedCount: number | string;
  failureCount: number | string;
  createdAt: Date | string;
  updatedAt: Date | string;
  completedAt: Date | string | null;
};

export class StorageVerificationBusyError extends Error {}

const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();

const mapRun = (row: RunRow): StorageVerificationRun => ({
  id: row.id,
  databaseBackupId: row.databaseBackupId,
  mediaSnapshotId: row.snapshotId,
  status: row.status,
  applicableAssetCount: Number(row.applicableAssetCount),
  cursor: row.cursor,
  verifiedCount: Number(row.verifiedCount),
  failureCount: Number(row.failureCount),
  aggregateDigest: row.aggregateDigest,
  failure: row.failure,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
  completedAt: row.completedAt ? toIso(row.completedAt) : null,
});

const runColumns = sql.raw(`
  id, "databaseBackupId", "snapshotId", status, "applicableAssetCount", cursor,
  "verifiedCount", "failureCount", "aggregateDigest", failure, "createdAt", "updatedAt", "completedAt"
`);

@Injectable()
export class ForkCutoverVerificationRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  async start(databaseBackupId: string, snapshotId: string): Promise<StorageVerificationRun> {
    return this.db.transaction().execute(async (trx) => {
      const id = randomUUID();
      const applicable = await sql<{ count: number }>`SELECT count(*)::int AS count FROM public.asset`.execute(trx);
      const applicableAssetCount = applicable.rows[0]?.count ?? 0;
      await sql`
        INSERT INTO immich_fork.cutover_verification_run
          (id, "databaseBackupId", "snapshotId", status, "applicableAssetCount")
        VALUES (${id}::uuid, ${databaseBackupId}, ${snapshotId}, 'running', ${applicableAssetCount})
      `.execute(trx);
      const inserted = await sql<{ count: number }>`
        WITH inserted AS (
          INSERT INTO immich_fork.cutover_verification_asset
            ("runId", "assetId", path, "approvedRoots", "expectedSize", "expectedSha1", "expectedSha256")
          SELECT ${id}::uuid, asset.id, mapping."upstreamPath",
            ARRAY[${StorageCore.getMediaLocation()}] || coalesce(library."importPaths", ARRAY[]::text[]),
            checksum."sizeInBytes", checksum.sha1, checksum.sha256
          FROM public.asset asset
          INNER JOIN immich_fork.asset_checksum checksum ON checksum."assetId" = asset.id
          INNER JOIN immich_fork.asset_physical_file mapping ON mapping."assetId" = asset.id
          LEFT JOIN public.library library ON library.id = asset."libraryId"
          WHERE mapping."upstreamPath" = asset."originalPath"
          ORDER BY asset.id
          RETURNING 1
        )
        SELECT count(*)::int AS count FROM inserted
      `.execute(trx);
      if ((inserted.rows[0]?.count ?? 0) !== applicableAssetCount) {
        throw new Error('Storage verification cannot lock an incomplete normalized asset set');
      }
      if (applicableAssetCount === 0) {
        const emptyDigest = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        await sql`
          UPDATE immich_fork.cutover_verification_run
          SET status = 'completed', "aggregateDigest" = ${emptyDigest}, "completedAt" = now(), "updatedAt" = now()
          WHERE id = ${id}::uuid
        `.execute(trx);
      }
      return this.getFrom(trx, id);
    });
  }

  get(id: string): Promise<StorageVerificationRun> {
    return this.getFrom(this.db, id);
  }

  async getLatest(databaseBackupId: string, snapshotId: string): Promise<StorageVerificationRun> {
    const result = await sql<RunRow>`
      SELECT ${runColumns} FROM immich_fork.cutover_verification_run
      WHERE "databaseBackupId" = ${databaseBackupId} AND "snapshotId" = ${snapshotId}
      ORDER BY "createdAt" DESC, id DESC LIMIT 1
    `.execute(this.db);
    if (!result.rows[0]) {
      throw new Error('Storage verification run was not found for the supplied checkpoint IDs');
    }
    return mapRun(result.rows[0]);
  }

  async getLatestComplete(databaseBackupId: string, snapshotId: string): Promise<StorageVerificationRun | null> {
    const result = await sql<RunRow>`
      SELECT ${runColumns} FROM immich_fork.cutover_verification_run
      WHERE "databaseBackupId" = ${databaseBackupId} AND "snapshotId" = ${snapshotId} AND status = 'completed'
      ORDER BY "completedAt" DESC, id DESC LIMIT 1
    `.execute(this.db);
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  async resume(
    runId: string,
    batchSize: number,
    verify: (candidate: StorageVerificationCandidate) => Promise<StorageVerificationEvidence>,
    aggregate: (evidence: StorageVerificationEvidence[]) => string,
  ): Promise<StorageVerificationRun> {
    try {
      return await this.db.transaction().execute(async (trx) => {
        const locked = await sql<RunRow>`
          SELECT ${runColumns} FROM immich_fork.cutover_verification_run
          WHERE id = ${runId}::uuid FOR UPDATE NOWAIT
        `.execute(trx);
        const row = locked.rows[0];
        if (!row) {
          throw new Error(`Storage verification run ${runId} was not found`);
        }
        if (row.status === 'completed') {
          return mapRun(row);
        }

        const candidates = await sql<StorageVerificationCandidate>`
          SELECT verification."assetId", verification.path,
            verification."expectedSize"::float8 AS "expectedSize",
            verification."expectedSha1", verification."expectedSha256",
            asset."originalPath" AS "currentPath",
            verification."approvedRoots",
            ARRAY[${StorageCore.getMediaLocation()}] || coalesce(library."importPaths", ARRAY[]::text[])
              AS "currentApprovedRoots"
          FROM immich_fork.cutover_verification_asset verification
          LEFT JOIN public.asset asset ON asset.id = verification."assetId"
          LEFT JOIN public.library library ON library.id = asset."libraryId"
          WHERE verification."runId" = ${runId}::uuid AND verification.status = 'pending'
          ORDER BY verification."assetId" LIMIT ${batchSize}
          FOR UPDATE OF verification
        `.execute(trx);
        if (candidates.rows.length === 0) {
          throw new Error('Storage verification run has no pending batch but is not complete');
        }

        for (const candidate of candidates.rows) {
          const evidence = await verify(candidate);
          await sql`
            UPDATE immich_fork.cutover_verification_asset
            SET status = 'verified', size = ${evidence.size}, sha1 = ${evidence.sha1}, sha256 = ${evidence.sha256},
                device = ${evidence.device}::bigint, inode = ${evidence.inode}::bigint, links = ${evidence.links},
                "verifiedAt" = now()
            WHERE "runId" = ${runId}::uuid AND "assetId" = ${candidate.assetId}::uuid AND status = 'pending'
          `.execute(trx);
        }

        const counts = await sql<{ pending: number; verified: number }>`
          SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending,
                 count(*) FILTER (WHERE status = 'verified')::int AS verified
          FROM immich_fork.cutover_verification_asset WHERE "runId" = ${runId}::uuid
        `.execute(trx);
        const count = counts.rows[0]!;
        const cursor = candidates.rows.at(-1)!.assetId;
        let aggregateDigest: string | null = null;
        let completed = false;
        if (count.pending === 0 && count.verified === Number(row.applicableAssetCount)) {
          const evidence = await this.getEvidenceFrom(trx, runId);
          aggregateDigest = aggregate(evidence);
          completed = true;
        }
        await sql`
          UPDATE immich_fork.cutover_verification_run
          SET status = ${completed ? 'completed' : 'running'}, cursor = ${cursor}::uuid,
              "verifiedCount" = ${count.verified}, "failureCount" = 0, failure = NULL,
              "aggregateDigest" = ${aggregateDigest}, "completedAt" = ${completed ? sql`now()` : null}, "updatedAt" = now()
          WHERE id = ${runId}::uuid
        `.execute(trx);
        return this.getFrom(trx, runId);
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '55P03') {
        throw new StorageVerificationBusyError(`Storage verification run ${runId} is already being resumed`);
      }
      throw error;
    }
  }

  async markFailure(runId: string, error: string): Promise<void> {
    await sql`
      UPDATE immich_fork.cutover_verification_run
      SET status = 'failed', "failureCount" = "failureCount" + 1, failure = ${error}, "updatedAt" = now()
      WHERE id = ${runId}::uuid AND status <> 'completed'
    `.execute(this.db);
  }

  private async getFrom(db: Kysely<DB>, id: string): Promise<StorageVerificationRun> {
    const result = await sql<RunRow>`
      SELECT ${runColumns} FROM immich_fork.cutover_verification_run WHERE id = ${id}::uuid
    `.execute(db);
    if (!result.rows[0]) {
      throw new Error(`Storage verification run ${id} was not found`);
    }
    return mapRun(result.rows[0]);
  }

  private async getEvidenceFrom(db: Kysely<DB>, runId: string): Promise<StorageVerificationEvidence[]> {
    const result = await sql<StorageVerificationEvidence>`
      SELECT "assetId", path, size::float8 AS size, sha1, sha256, device::text, inode::text, links
      FROM immich_fork.cutover_verification_asset
      WHERE "runId" = ${runId}::uuid AND status = 'verified' ORDER BY "assetId"
    `.execute(db);
    return result.rows;
  }
}

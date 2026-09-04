import { Injectable } from '@nestjs/common';
import { Kysely, Selectable, Transaction, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, parse } from 'node:path';
import { AssetFileType, AssetStatus, ChecksumAlgorithm, PhysicalFileType } from 'src/enum';
import { DB } from 'src/schema';
import { PhysicalFileTable } from 'src/schema/tables/physical-file.table';
import { asUuid } from 'src/utils/database';

type PhysicalFile = Selectable<PhysicalFileTable>;

export type PhysicalNormalizationAsset = {
  id: string;
  checksum: Buffer;
  checksumAlgorithm: ChecksumAlgorithm;
  originalPath: string;
  physicalFileId: string | null;
  physicalCanonicalAssetId: string | null;
  physicalChecksum: Buffer | null;
  physicalCreatedAt: Date | null;
  physicalPath: string | null;
  physicalSizeInBytes: number | null;
  physicalType: string | null;
  physicalUpdatedAt: Date | null;
  sharedPathCount: number;
  libraryImportPaths: string[];
  mappedUpstreamPath: string | null;
};

export type PhysicalNormalizationCommit = {
  asset: PhysicalNormalizationAsset;
  evidence: Record<string, unknown>;
  linkCount: number;
  sha1: Buffer;
  sha256: Buffer;
  sizeInBytes: number;
  upstreamPath: string;
  verifiedPaths: string[];
};

export type PhysicalNormalizationReservation = {
  assetId: string;
  token: string;
  sourcePath: string;
  upstreamPath: string;
  temporaryPath: string;
};

export type PhysicalNormalizationCompleted = {
  upstreamPath: string;
  sha1: Buffer;
  sha256: Buffer;
  sizeInBytes: number;
  linkCount: number;
  verifiedPaths: string[];
};

export type PhysicalNormalizationPreparation =
  | {
      status: 'completed';
      asset: PhysicalNormalizationAsset;
      completed: PhysicalNormalizationCompleted;
      reservation: PhysicalNormalizationReservation | null;
    }
  | {
      status: 'reserved';
      asset: PhysicalNormalizationAsset;
      reservation: PhysicalNormalizationReservation;
      recovered: boolean;
      stale?: boolean;
    };

export type ReturnNormalizationClaim = {
  kind: 'storage' | 'checksum';
  claimToken: string;
  claimedIds: string[];
};

export interface PhysicalFileInput {
  canonicalAssetId: string | null;
  checksum: Buffer;
  path: string;
  sizeInBytes: number;
  type: PhysicalFileType;
}

@Injectable()
export class PhysicalFileRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  protected afterNormalizationAuthority(
    _transaction: Kysely<DB>,
    _action: 'reserve' | 'run' | 'release',
  ): Promise<void> {
    return Promise.resolve();
  }

  /**
   * The ordering is load-bearing: when the master account holds several copies
   * of the same file, an unordered limit lets upload-time dedup and the dedup
   * migration pick different masters for the same duplicate — the migration
   * then treats the first master's file as the duplicate's own and queues it
   * for deletion. Both callers share this query, so a stable pick keeps them
   * agreeing on one canonical master.
   */
  async getMasterOriginalCandidate(masterUserId: string, checksum: Buffer, sizeInBytes: number) {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        'asset.id',
        'asset.originalPath',
        'asset.physicalOriginalFileId',
        'asset.checksum',
        'asset_exif.fileSizeInByte as sizeInBytes',
      ])
      .where('asset.ownerId', '=', asUuid(masterUserId))
      .where('asset.libraryId', 'is', null)
      .where('asset.isExternal', '=', false)
      .where('asset.isOffline', '=', false)
      .where('asset.deletedAt', 'is', null)
      .where('asset.status', '=', AssetStatus.Active)
      .where('asset.checksum', '=', checksum)
      .where('asset_exif.fileSizeInByte', '=', sizeInBytes)
      .orderBy('asset.id', 'asc')
      .limit(1)
      .executeTakeFirst();
  }

  getPhysicalFile(id: string): Promise<PhysicalFile | undefined> {
    return this.db.selectFrom('physical_file').selectAll().where('id', '=', asUuid(id)).executeTakeFirst();
  }

  getOriginalPhysicalFile(assetId: string): Promise<PhysicalFile | undefined> {
    return this.db
      .selectFrom('asset')
      .innerJoin('physical_file', 'physical_file.id', 'asset.physicalOriginalFileId')
      .selectAll('physical_file')
      .where('asset.id', '=', asUuid(assetId))
      .executeTakeFirst();
  }

  private async getNormalizationAssetFrom(
    db: Kysely<DB> | Transaction<DB>,
    assetId: string,
  ): Promise<PhysicalNormalizationAsset | undefined> {
    const result = await sql<PhysicalNormalizationAsset>`
      SELECT
        asset.id,
        asset.checksum,
        asset."checksumAlgorithm",
        asset."originalPath",
        coalesce(asset."physicalOriginalFileId", mapping."physicalFileId") AS "physicalFileId",
        coalesce(physical."canonicalAssetId", fork_physical."canonicalAssetId") AS "physicalCanonicalAssetId",
        coalesce(physical.checksum, fork_physical.checksum) AS "physicalChecksum",
        coalesce(physical."createdAt", fork_physical."createdAt") AS "physicalCreatedAt",
        coalesce(physical.path, fork_physical."canonicalPath") AS "physicalPath",
        coalesce(physical."sizeInBytes", fork_physical."sizeInBytes")::float8 AS "physicalSizeInBytes",
        coalesce(physical.type::text, fork_physical.type) AS "physicalType",
        coalesce(physical."updatedAt", fork_physical."updatedAt") AS "physicalUpdatedAt",
        coalesce(library."importPaths", ARRAY[]::text[]) AS "libraryImportPaths",
        mapping."upstreamPath" AS "mappedUpstreamPath",
        (
          SELECT count(*)::int FROM public.asset shared
          WHERE shared."originalPath" = asset."originalPath"
             OR (
               asset."physicalOriginalFileId" IS NOT NULL
               AND shared."physicalOriginalFileId" = asset."physicalOriginalFileId"
             )
        ) AS "sharedPathCount"
      FROM public.asset asset
      LEFT JOIN public.physical_file physical ON physical.id = asset."physicalOriginalFileId"
      LEFT JOIN immich_fork.asset_physical_file mapping ON mapping."assetId" = asset.id
      LEFT JOIN immich_fork.physical_file fork_physical ON fork_physical.id = mapping."physicalFileId"
      LEFT JOIN public.library library ON library.id = asset."libraryId"
      WHERE asset.id = ${assetId}::uuid
    `.execute(db);
    return result.rows[0];
  }

  async getNormalizationAsset(assetId: string): Promise<PhysicalNormalizationAsset | undefined> {
    return this.getNormalizationAssetFrom(this.db, assetId);
  }

  async createNormalizationReservation(
    assetId: string,
    selectUpstreamPath: (asset: PhysicalNormalizationAsset) => string,
  ): Promise<PhysicalNormalizationPreparation> {
    return this.createNormalizationReservationForMode(assetId, selectUpstreamPath);
  }

  async createReturnNormalizationReservation(
    assetId: string,
    selectUpstreamPath: (asset: PhysicalNormalizationAsset) => string,
    claim: ReturnNormalizationClaim,
  ): Promise<PhysicalNormalizationPreparation> {
    return this.createNormalizationReservationForMode(assetId, selectUpstreamPath, claim);
  }

  private async createNormalizationReservationForMode(
    assetId: string,
    selectUpstreamPath: (asset: PhysicalNormalizationAsset) => string,
    claim?: ReturnNormalizationClaim,
  ): Promise<PhysicalNormalizationPreparation> {
    return this.db.transaction().execute(async (trx) => {
      await this.assertNormalizationAuthority(trx, assetId, claim, 'reserve');
      const locked = await sql`SELECT id FROM public.asset WHERE id = ${assetId}::uuid FOR UPDATE`.execute(trx);
      if (locked.rows.length === 0) {
        throw new Error(`Asset ${assetId} does not exist`);
      }
      const asset = await this.getNormalizationAssetFrom(trx, assetId);
      if (!asset) {
        throw new Error(`Asset ${assetId} does not exist`);
      }
      const completed = await sql<
        PhysicalNormalizationCompleted & {
          reservationAssetId: string | null;
          reservationToken: string | null;
          reservationSourcePath: string | null;
          reservationUpstreamPath: string | null;
          reservationTemporaryPath: string | null;
        }
      >`
        SELECT
          mapping."upstreamPath",
          checksum.sha1,
          checksum.sha256,
          checksum."sizeInBytes"::float8 AS "sizeInBytes",
          checksum."linkCount"::int AS "linkCount",
          checksum."verifiedPaths",
          reservation."assetId" AS "reservationAssetId",
          reservation.token AS "reservationToken",
          reservation."sourcePath" AS "reservationSourcePath",
          reservation."upstreamPath" AS "reservationUpstreamPath",
          reservation."temporaryPath" AS "reservationTemporaryPath"
        FROM public.asset asset
        INNER JOIN immich_fork.asset_checksum checksum ON checksum."assetId" = asset.id
        INNER JOIN immich_fork.asset_physical_file mapping ON mapping."assetId" = asset.id
        LEFT JOIN immich_fork.asset_storage_reservation reservation ON reservation."assetId" = asset.id
        WHERE asset.id = ${assetId}::uuid
          AND asset."originalPath" = mapping."upstreamPath"
          ${
            claim
              ? sql`
          AND asset.checksum = checksum.sha1
          AND asset."checksumAlgorithm" = ${ChecksumAlgorithm.sha1File}::asset_checksum_algorithm_enum
          AND asset."physicalOriginalFileId" IS NULL`
              : sql`
          AND (asset.checksum = checksum.sha1 OR asset.checksum = checksum.sha256)`
          }
      `.execute(trx);
      const committed = completed.rows[0];
      if (committed) {
        const reservation =
          committed.reservationAssetId &&
          committed.reservationToken &&
          committed.reservationSourcePath &&
          committed.reservationUpstreamPath &&
          committed.reservationTemporaryPath
            ? {
                assetId: committed.reservationAssetId,
                token: committed.reservationToken,
                sourcePath: committed.reservationSourcePath,
                upstreamPath: committed.reservationUpstreamPath,
                temporaryPath: committed.reservationTemporaryPath,
              }
            : null;
        return {
          status: 'completed',
          asset,
          completed: {
            upstreamPath: committed.upstreamPath,
            sha1: committed.sha1,
            sha256: committed.sha256,
            sizeInBytes: committed.sizeInBytes,
            linkCount: committed.linkCount,
            verifiedPaths: committed.verifiedPaths,
          },
          reservation,
        };
      }
      const upstreamPath = selectUpstreamPath(asset);
      const existing = await sql<PhysicalNormalizationReservation>`
        SELECT
          "assetId", token, "sourcePath", "upstreamPath", "temporaryPath"
        FROM immich_fork.asset_storage_reservation
        WHERE "assetId" = ${assetId}::uuid
        FOR UPDATE
      `.execute(trx);
      const reservation = existing.rows[0];
      if (reservation) {
        const reservationMatchesSource =
          reservation.sourcePath === asset.originalPath && reservation.upstreamPath === upstreamPath;
        const reservationMatchesCommittedMapping =
          asset.originalPath === reservation.upstreamPath && asset.mappedUpstreamPath === reservation.upstreamPath;
        if (!reservationMatchesSource && !reservationMatchesCommittedMapping) {
          // A reservation created by the old always-split behavior (same source,
          // different target) is stale in steady-state mode; surface it so the
          // caller can clean it up and re-reserve instead of failing forever.
          if (!claim && reservation.sourcePath === asset.originalPath) {
            return { status: 'reserved', asset, reservation, recovered: true, stale: true };
          }
          throw new Error(`Asset ${assetId} has a conflicting durable storage reservation`);
        }
        return { status: 'reserved', asset, reservation, recovered: true };
      }

      // In steady-state fork mode (no claim) the target IS the asset's own
      // (possibly shared, deduplicated) path: no file is ever created or
      // moved, so no durable reservation is needed — and the unique
      // upstreamPath constraint would forbid concurrent sharers anyway. Use an
      // ephemeral reservation instead of inserting a row.
      const sharedSteadyStateTarget = !claim && upstreamPath === asset.originalPath;
      if (sharedSteadyStateTarget) {
        const token = randomUUID();
        return {
          status: 'reserved',
          asset,
          reservation: {
            assetId: asset.id,
            token,
            sourcePath: asset.originalPath,
            upstreamPath,
            temporaryPath: this.getNormalizationTemporaryPath(upstreamPath, token),
          },
          recovered: false,
        };
      }
      {
        const conflictingReservation = await sql<{ assetId: string }>`
          SELECT "assetId" FROM immich_fork.asset_storage_reservation WHERE "upstreamPath" = ${upstreamPath}
        `.execute(trx);
        if (conflictingReservation.rows[0]) {
          throw new Error(`Normalization target is reserved by another asset: ${upstreamPath}`);
        }
      }
      // Exclusive fork-mapping ownership only applies to foreign targets. When
      // the target is the asset's own current path, other sharers' steady-state
      // mappings may still reference it until their own destructive pass
      // re-points them — that is expected, not a takeover.
      if (upstreamPath !== asset.originalPath) {
        const existingMapping = await sql<{ assetId: string }>`
          SELECT "assetId" FROM immich_fork.asset_physical_file
          WHERE "upstreamPath" = ${upstreamPath} AND "assetId" <> ${asset.id}::uuid
          LIMIT 1
        `.execute(trx);
        if (existingMapping.rows[0]) {
          throw new Error(`Normalization target is owned by another fork asset: ${upstreamPath}`);
        }
      }
      if (upstreamPath !== asset.originalPath) {
        const publicOwner = await sql<{ id: string }>`
          SELECT id FROM public.asset WHERE "originalPath" = ${upstreamPath} AND id <> ${asset.id}::uuid LIMIT 1
        `.execute(trx);
        if (publicOwner.rows[0]) {
          throw new Error(`Normalization target is owned by another public asset: ${upstreamPath}`);
        }
      }

      const token = randomUUID();
      const temporaryPath = this.getNormalizationTemporaryPath(upstreamPath, token);
      const inserted = await sql<PhysicalNormalizationReservation>`
        INSERT INTO immich_fork.asset_storage_reservation
          ("assetId", token, "sourcePath", "upstreamPath", "temporaryPath", status)
        VALUES (${asset.id}::uuid, ${token}::uuid, ${asset.originalPath}, ${upstreamPath}, ${temporaryPath}, 'reserved')
        RETURNING "assetId", token, "sourcePath", "upstreamPath", "temporaryPath"
      `.execute(trx);
      return { status: 'reserved', asset, reservation: inserted.rows[0]!, recovered: false };
    });
  }

  private getNormalizationTemporaryPath(upstreamPath: string, token: string): string {
    return join(dirname(upstreamPath), `.${parse(upstreamPath).base}.${token}.normalize`);
  }

  async releaseNormalizationReservation(assetId: string, token: string): Promise<void> {
    await this.releaseNormalizationReservationForMode(assetId, token);
  }

  async releaseReturnNormalizationReservation(
    assetId: string,
    token: string,
    claim: ReturnNormalizationClaim,
  ): Promise<void> {
    await this.releaseNormalizationReservationForMode(assetId, token, claim);
  }

  private async releaseNormalizationReservationForMode(
    assetId: string,
    token: string,
    claim?: ReturnNormalizationClaim,
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await this.assertNormalizationAuthority(trx, assetId, claim, 'release');
      await sql`
        DELETE FROM immich_fork.asset_storage_reservation
        WHERE "assetId" = ${assetId}::uuid AND token = ${token}::uuid
      `.execute(trx);
    });
  }

  async withLockedNormalizationAsset<T>(
    assetId: string,
    token: string,
    callback: (context: {
      asset: PhysicalNormalizationAsset;
      reservation: PhysicalNormalizationReservation;
      commit: (input: Omit<PhysicalNormalizationCommit, 'asset'>) => Promise<void>;
    }) => Promise<T>,
  ): Promise<T> {
    return this.withLockedNormalizationAssetForMode(assetId, token, callback);
  }

  async withLockedReturnNormalizationAsset<T>(
    assetId: string,
    token: string,
    claim: ReturnNormalizationClaim,
    callback: (context: {
      asset: PhysicalNormalizationAsset;
      reservation: PhysicalNormalizationReservation;
      commit: (input: Omit<PhysicalNormalizationCommit, 'asset'>) => Promise<void>;
    }) => Promise<T>,
  ): Promise<T> {
    return this.withLockedNormalizationAssetForMode(assetId, token, callback, claim);
  }

  private async withLockedNormalizationAssetForMode<T>(
    assetId: string,
    token: string,
    callback: (context: {
      asset: PhysicalNormalizationAsset;
      reservation: PhysicalNormalizationReservation;
      commit: (input: Omit<PhysicalNormalizationCommit, 'asset'>) => Promise<void>;
    }) => Promise<T>,
    claim?: ReturnNormalizationClaim,
  ): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      await this.assertNormalizationAuthority(trx, assetId, claim, 'run');
      const locked = await sql`SELECT id FROM public.asset WHERE id = ${assetId}::uuid FOR UPDATE`.execute(trx);
      if (locked.rows.length === 0) {
        throw new Error(`Asset ${assetId} does not exist`);
      }
      const asset = await this.getNormalizationAssetFrom(trx, assetId);
      if (!asset) {
        throw new Error(`Asset ${assetId} does not exist`);
      }
      const reservations = await sql<PhysicalNormalizationReservation>`
        SELECT "assetId", token, "sourcePath", "upstreamPath", "temporaryPath"
        FROM immich_fork.asset_storage_reservation
        WHERE "assetId" = ${assetId}::uuid AND token = ${token}::uuid
        FOR UPDATE
      `.execute(trx);
      // Steady-state reservations are ephemeral (never inserted) — reconstruct
      // one from the token when the target is the asset's own path.
      const reservation: PhysicalNormalizationReservation | undefined =
        reservations.rows[0] ??
        (claim
          ? undefined
          : {
              assetId: asset.id,
              token,
              sourcePath: asset.originalPath,
              upstreamPath: asset.originalPath,
              temporaryPath: this.getNormalizationTemporaryPath(asset.originalPath, token),
            });
      const reservationMatchesSource = reservation?.sourcePath === asset.originalPath;
      const reservationMatchesCommittedMapping =
        reservation &&
        asset.originalPath === reservation.upstreamPath &&
        asset.mappedUpstreamPath === reservation.upstreamPath;
      if (!reservation || (!reservationMatchesSource && !reservationMatchesCommittedMapping)) {
        throw new Error(`Asset ${assetId} durable storage reservation is missing or stale`);
      }
      return callback({
        asset,
        reservation,
        commit: async (input) => {
          await this.commitNormalization(trx, { ...input, asset }, claim);
        },
      });
    });
  }

  private async assertNormalizationAuthority(
    trx: Transaction<DB>,
    assetId: string,
    claim: ReturnNormalizationClaim | undefined,
    action: 'reserve' | 'run' | 'release',
  ): Promise<void> {
    if (!claim) {
      const state = await sql<{ phase: string }>`
        SELECT phase FROM immich_fork.state WHERE id = 1 FOR SHARE
      `.execute(trx);
      if (!['dual-write', 'ready', 'active'].includes(state.rows[0]?.phase ?? '')) {
        throw new Error(`Storage normalization cannot ${action} in the current phase`);
      }
      return;
    }
    const state = await sql<{ active: boolean; phase: string }>`
      SELECT active, phase FROM immich_fork.state WHERE id = 1 FOR SHARE
    `.execute(trx);
    // A destructive (upstream-form) claim is honored under exactly two
    // audited authorities: return reconciliation (inactive phase) and
    // official handoff preparation (ready phase).
    const audit = await sql<{ id: string }>`
      SELECT id::text AS id FROM immich_fork.migration_audit
      WHERE (name = 'fork-return-reconciliation' AND phase = 'inactive' AND status = 'running'
          AND ${state.rows[0]?.phase ?? ''} = 'inactive')
         OR (name = 'official-handoff-preparation' AND phase = 'ready' AND status = 'running'
          AND ${state.rows[0]?.phase ?? ''} = 'ready')
      ORDER BY id DESC LIMIT 1 FOR SHARE
    `.execute(trx);
    const progress = await sql<{ claimToken: string | null; claimedIds: string[] }>`
      SELECT "claimToken", "claimedIds" FROM immich_fork.backfill_progress
      WHERE kind = ${claim.kind} FOR SHARE
    `.execute(trx);
    const progressRow = progress.rows[0];
    const exactIds =
      progressRow?.claimedIds.length === claim.claimedIds.length &&
      progressRow.claimedIds.every((id, index) => id === claim.claimedIds[index]);
    if (
      (state.rows[0]?.phase !== 'inactive' && state.rows[0]?.phase !== 'ready') ||
      state.rows[0]?.active ||
      !audit.rows[0] ||
      progressRow?.claimToken !== claim.claimToken ||
      !exactIds ||
      !progressRow.claimedIds.includes(assetId)
    ) {
      throw new Error('Storage normalization requires the durable return storage claim');
    }
    await this.afterNormalizationAuthority(trx, action);
  }

  private async commitNormalization(
    db: Kysely<DB> | Transaction<DB>,
    input: PhysicalNormalizationCommit,
    claim?: ReturnNormalizationClaim,
  ): Promise<void> {
    const { asset, evidence, linkCount, sha1, sha256, sizeInBytes, upstreamPath, verifiedPaths } = input;
    if (asset.physicalFileId && asset.physicalPath && asset.physicalChecksum && asset.physicalType) {
      await sql`
          INSERT INTO immich_fork.physical_file
            (id, "canonicalAssetId", type, checksum, "sizeInBytes", "canonicalPath", "createdAt", "updatedAt")
          VALUES (
            ${asset.physicalFileId}::uuid,
            ${asset.physicalCanonicalAssetId}::uuid,
            ${asset.physicalType},
            ${asset.physicalChecksum},
            ${asset.physicalSizeInBytes ?? sizeInBytes},
            ${asset.physicalPath},
            ${asset.physicalCreatedAt ?? new Date()},
            ${asset.physicalUpdatedAt ?? new Date()}
          )
          ON CONFLICT (id) DO UPDATE SET
            "canonicalAssetId" = excluded."canonicalAssetId",
            type = excluded.type,
            checksum = excluded.checksum,
            "sizeInBytes" = excluded."sizeInBytes",
            "canonicalPath" = excluded."canonicalPath",
            "updatedAt" = excluded."updatedAt"
        `.execute(db);
    }

    await sql`
        INSERT INTO immich_fork.asset_checksum
          ("assetId", sha1, sha256, "sizeInBytes", "verifiedPaths", "linkCount", evidence, "verifiedAt", "updatedAt")
        VALUES (
          ${asset.id}::uuid,
          ${sha1},
          ${sha256},
          ${sizeInBytes},
          ${verifiedPaths},
          ${linkCount},
          ${JSON.stringify(evidence)}::jsonb,
          now(),
          now()
        )
        ON CONFLICT ("assetId") DO UPDATE SET
          sha1 = excluded.sha1,
          sha256 = excluded.sha256,
          "sizeInBytes" = excluded."sizeInBytes",
          "verifiedPaths" = excluded."verifiedPaths",
          "linkCount" = excluded."linkCount",
          evidence = excluded.evidence,
          "verifiedAt" = excluded."verifiedAt",
          "updatedAt" = excluded."updatedAt"
      `.execute(db);
    await sql`
        INSERT INTO immich_fork.asset_physical_file
          ("assetId", "physicalFileId", "upstreamPath", "verifiedAt", "updatedAt")
        VALUES (${asset.id}::uuid, ${asset.physicalFileId}::uuid, ${upstreamPath}, now(), now())
        ON CONFLICT ("assetId") DO UPDATE SET
          "physicalFileId" = excluded."physicalFileId",
          "upstreamPath" = excluded."upstreamPath",
          "verifiedAt" = excluded."verifiedAt",
          "updatedAt" = excluded."updatedAt"
      `.execute(db);
    // Rewriting public.asset to upstream-compatible form (SHA-1 checksum,
    // per-asset path, no physical dedup link) is destructive to the fork's
    // physical deduplication feature. Only the explicit return-to-upstream
    // flow may do it; steady-state fork normalization records evidence in the
    // immich_fork tables above and leaves public.asset untouched.
    if (claim) {
      await sql`
        UPDATE public.asset
        SET
          checksum = ${sha1},
          "checksumAlgorithm" = ${ChecksumAlgorithm.sha1File}::asset_checksum_algorithm_enum,
          "originalPath" = ${upstreamPath},
          "physicalOriginalFileId" = NULL,
          "updatedAt" = now()
        WHERE id = ${asset.id}::uuid
      `.execute(db);
    }
  }

  async upsertPhysicalFile(input: PhysicalFileInput): Promise<PhysicalFile> {
    return this.db
      .insertInto('physical_file')
      .values(input)
      .onConflict((oc) =>
        oc.column('path').doUpdateSet((eb) => ({
          checksum: eb.ref('excluded.checksum'),
          sizeInBytes: eb.ref('excluded.sizeInBytes'),
          type: eb.ref('excluded.type'),
          canonicalAssetId: eb.ref('excluded.canonicalAssetId'),
        })),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async ensureOriginalPhysicalFile(assetId: string): Promise<PhysicalFile | undefined> {
    return this.db.transaction().execute(async (trx) => {
      const asset = await trx
        .selectFrom('asset')
        .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
        .leftJoin('physical_file', 'physical_file.id', 'asset.physicalOriginalFileId')
        .select([
          'asset.id',
          'asset.originalPath',
          'asset.checksum',
          'asset.physicalOriginalFileId',
          'asset_exif.fileSizeInByte as sizeInBytes',
          'physical_file.id as existingPhysicalFileId',
        ])
        .where('asset.id', '=', asUuid(assetId))
        .where('asset.libraryId', 'is', null)
        .where('asset.isExternal', '=', false)
        .where('asset.isOffline', '=', false)
        .where('asset.deletedAt', 'is', null)
        .executeTakeFirst();

      if (!asset || !asset.sizeInBytes) {
        return;
      }

      if (asset.existingPhysicalFileId) {
        return trx
          .selectFrom('physical_file')
          .selectAll()
          .where('id', '=', asUuid(asset.existingPhysicalFileId))
          .executeTakeFirst();
      }

      const physicalFile = await trx
        .insertInto('physical_file')
        .values({
          canonicalAssetId: asset.id,
          checksum: asset.checksum,
          path: asset.originalPath,
          sizeInBytes: Number(asset.sizeInBytes),
          type: PhysicalFileType.Original,
        })
        .onConflict((oc) =>
          oc.column('path').doUpdateSet((eb) => ({
            checksum: eb.ref('excluded.checksum'),
            sizeInBytes: eb.ref('excluded.sizeInBytes'),
            canonicalAssetId: eb.ref('excluded.canonicalAssetId'),
          })),
        )
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('asset')
        .set({ physicalOriginalFileId: physicalFile.id, originalPath: physicalFile.path })
        .where('id', '=', asUuid(asset.id))
        .execute();

      return physicalFile;
    });
  }

  // Aliases an asset onto a file another asset already owns, so it takes the
  // path lock: without it this can add a reference to a path a concurrent
  // FileDelete job has already counted as unreferenced.
  async linkAssetToOriginalPhysicalFile(assetId: string, physicalFile: Pick<PhysicalFile, 'id' | 'path'>) {
    await this.withPathLock(physicalFile.path, (trx) =>
      trx
        .updateTable('asset')
        .set({ physicalOriginalFileId: physicalFile.id, originalPath: physicalFile.path })
        .where('id', '=', asUuid(assetId))
        .execute(),
    );
  }

  async linkAssetToRecoveredOriginal(assetId: string, path: string, checksum: Buffer, sizeInBytes: number) {
    return this.withPathLock(path, async (trx) => {
      const existing = await trx.selectFrom('physical_file').selectAll().where('path', '=', path).executeTakeFirst();
      const physicalFile = existing
        ? await trx
            .updateTable('physical_file')
            .set({ checksum, sizeInBytes, type: PhysicalFileType.Original })
            .where('id', '=', existing.id)
            .returningAll()
            .executeTakeFirstOrThrow()
        : await trx
            .insertInto('physical_file')
            .values({ canonicalAssetId: assetId, checksum, path, sizeInBytes, type: PhysicalFileType.Original })
            .returningAll()
            .executeTakeFirstOrThrow();

      await trx
        .updateTable('asset')
        .set({ physicalOriginalFileId: physicalFile.id, originalPath: physicalFile.path })
        .where('id', '=', asUuid(assetId))
        .execute();
      return physicalFile;
    });
  }

  async isOriginalCanonical(assetId: string, physicalFileId: string): Promise<boolean> {
    const physicalFile = await this.getPhysicalFile(physicalFileId);
    return physicalFile?.canonicalAssetId === assetId;
  }

  // Moves a physical file onto `path`, which makes that path referenced.
  async updateOriginalPhysicalPathForAsset(assetId: string, path: string) {
    await this.withPathLock(path, async (trx) => {
      const physicalFile = await trx
        .selectFrom('physical_file')
        .select(['id'])
        .where('canonicalAssetId', '=', asUuid(assetId))
        .where('type', '=', PhysicalFileType.Original)
        .executeTakeFirst();

      if (!physicalFile) {
        return;
      }

      await trx.updateTable('physical_file').set({ path }).where('id', '=', physicalFile.id).execute();
      await trx
        .updateTable('asset')
        .set({ originalPath: path })
        .where('physicalOriginalFileId', '=', physicalFile.id)
        .execute();
    });
  }

  async getCanonicalGeneratedFile(assetId: string, type: AssetFileType) {
    const physicalType = this.toPhysicalFileType(type);

    return this.db
      .selectFrom('asset as duplicateAsset')
      .innerJoin('physical_file as originalPhysical', 'originalPhysical.id', 'duplicateAsset.physicalOriginalFileId')
      .innerJoin('physical_file as generatedPhysical', (join) =>
        join
          .onRef('generatedPhysical.canonicalAssetId', '=', 'originalPhysical.canonicalAssetId')
          .on('generatedPhysical.type', '=', physicalType),
      )
      .select(['generatedPhysical.id', 'generatedPhysical.path'])
      .where('duplicateAsset.id', '=', asUuid(assetId))
      .whereRef('duplicateAsset.id', '!=', 'originalPhysical.canonicalAssetId')
      .executeTakeFirst();
  }

  // Same aliasing hazard as linkAssetToOriginalPhysicalFile, for derivatives.
  async linkGeneratedFile(assetId: string, type: AssetFileType, physicalFileId: string, path: string) {
    await this.withPathLock(path, (trx) =>
      trx
        .updateTable('asset_file')
        .set({ physicalFileId, path })
        .where('assetId', '=', asUuid(assetId))
        .where('type', '=', type)
        .where('isEdited', '=', false)
        .execute(),
    );
  }

  private async countPathReferencesIn(trx: Transaction<DB>, path: string, physicalFileId?: string): Promise<number> {
    // A path can be the live original of an asset that has no `physical_file`
    // link at all — both upload-time dedup and the dedup migration point
    // `asset.originalPath` at a file owned by another asset. Counting only
    // physical-file links misses those references entirely.
    const assetRefs = await trx
      .selectFrom('asset')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where((eb) =>
        eb.or([
          eb('asset.originalPath', '=', path),
          ...(physicalFileId ? [eb('asset.physicalOriginalFileId', '=', asUuid(physicalFileId))] : []),
        ]),
      )
      .executeTakeFirstOrThrow();

    const fileRefs = await trx
      .selectFrom('asset_file')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where((eb) =>
        eb.or([
          eb('asset_file.path', '=', path),
          ...(physicalFileId ? [eb('asset_file.physicalFileId', '=', asUuid(physicalFileId))] : []),
        ]),
      )
      .executeTakeFirstOrThrow();

    return Number(assetRefs.count) + Number(fileRefs.count);
  }

  /**
   * Advisory lock guarding one path against concurrent reference changes.
   * Transaction-scoped, so it is released on commit or rollback. The key is
   * derived in JS rather than via `hashtext` so every caller agrees on it
   * without depending on an undocumented Postgres builtin.
   */
  private async lockPath(trx: Transaction<DB>, path: string): Promise<void> {
    const key = createHash('sha1').update(path).digest().readBigInt64BE(0);
    await sql`SELECT pg_advisory_xact_lock(${key.toString()}::bigint)`.execute(trx);
  }

  private async withPathLock<T>(path: string, callback: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      await this.lockPath(trx, path);
      return callback(trx);
    });
  }

  /**
   * Unlinks `path` only while nothing references it, holding the path's
   * advisory lock across the count and the unlink so a writer cannot introduce
   * a reference in between. Every method that can point a new row at an
   * existing file takes the same lock, which is what makes the count still
   * true at the moment `unlink` runs.
   *
   * The physical_file row is cleaned up in the same transaction, so a failed
   * unlink leaves both the file and its row intact.
   */
  async deleteUnreferencedPath(
    path: string,
    unlink: () => Promise<void>,
  ): Promise<{ deleted: boolean; references: number }> {
    return this.withPathLock(path, async (trx) => {
      const physicalFile = await trx
        .selectFrom('physical_file')
        .select(['id'])
        .where('path', '=', path)
        .executeTakeFirst();

      const references = await this.countPathReferencesIn(trx, path, physicalFile?.id);
      if (references > 0) {
        return { deleted: false, references };
      }

      await unlink();

      if (physicalFile) {
        await trx.deleteFrom('physical_file').where('id', '=', physicalFile.id).execute();
      }

      return { deleted: true, references: 0 };
    });
  }

  getMigrationCandidates(masterUserId: string) {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        'asset.id',
        'asset.ownerId',
        'asset.originalPath',
        'asset.checksum',
        'asset.isExternal',
        'asset.isOffline',
        'asset.libraryId',
        'asset.physicalOriginalFileId',
        'asset_exif.fileSizeInByte as sizeInBytes',
      ])
      .where('asset.ownerId', '!=', asUuid(masterUserId))
      .where('asset.deletedAt', 'is', null)
      .where('asset.status', '=', AssetStatus.Active)
      .stream();
  }

  getGeneratedFile(assetId: string, type: AssetFileType) {
    return this.db
      .selectFrom('asset_file')
      .select(['id', 'assetId', 'type', 'path', 'physicalFileId'])
      .where('assetId', '=', asUuid(assetId))
      .where('type', '=', type)
      .where('isEdited', '=', false)
      .executeTakeFirst();
  }

  getGeneratedFiles(assetId: string) {
    return this.db
      .selectFrom('asset_file')
      .select(['id', 'assetId', 'type', 'path', 'physicalFileId'])
      .where('assetId', '=', asUuid(assetId))
      .where('type', 'in', [
        AssetFileType.Thumbnail,
        AssetFileType.Preview,
        AssetFileType.FullSize,
        AssetFileType.EncodedVideo,
      ])
      .where('isEdited', '=', false)
      .execute();
  }

  private toPhysicalFileType(type: AssetFileType) {
    switch (type) {
      case AssetFileType.Thumbnail: {
        return PhysicalFileType.Thumbnail;
      }
      case AssetFileType.Preview: {
        return PhysicalFileType.Preview;
      }
      case AssetFileType.FullSize: {
        return PhysicalFileType.FullSize;
      }
      case AssetFileType.EncodedVideo: {
        return PhysicalFileType.EncodedVideo;
      }
      default: {
        throw new Error(`Unsupported physical generated file type: ${type}`);
      }
    }
  }
}

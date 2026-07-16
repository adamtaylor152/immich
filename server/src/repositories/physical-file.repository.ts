import { Injectable } from '@nestjs/common';
import { Kysely, Selectable, Transaction, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { randomUUID } from 'node:crypto';
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
      .limit(1)
      .executeTakeFirst();
  }

  getPhysicalFile(id: string): Promise<PhysicalFile | undefined> {
    return this.db.selectFrom('physical_file').selectAll().where('id', '=', asUuid(id)).executeTakeFirst();
  }

  getPhysicalFileByPath(path: string): Promise<PhysicalFile | undefined> {
    return this.db.selectFrom('physical_file').selectAll().where('path', '=', path).executeTakeFirst();
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
    return this.db.transaction().execute(async (trx) => {
      const state = await sql<{ allowed: boolean }>`
        SELECT state.phase = 'dual-write' OR (
          state.phase = 'inactive' AND EXISTS (
            SELECT 1 FROM immich_fork.migration_audit
            WHERE name = 'fork-return-reconciliation' AND phase = 'inactive' AND status = 'running'
          )
        ) AS allowed
        FROM immich_fork.state state
        WHERE state.id = 1
        FOR SHARE
      `.execute(trx);
      if (!state.rows[0]?.allowed) {
        throw new Error('Storage normalization can only reserve in dual-write phase');
      }
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
          AND asset.checksum = checksum.sha1
          AND asset."checksumAlgorithm" = ${ChecksumAlgorithm.sha1File}::asset_checksum_algorithm_enum
          AND asset."physicalOriginalFileId" IS NULL
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
          throw new Error(`Asset ${assetId} has a conflicting durable storage reservation`);
        }
        return { status: 'reserved', asset, reservation, recovered: true };
      }

      const conflictingReservation = await sql<{ assetId: string }>`
        SELECT "assetId" FROM immich_fork.asset_storage_reservation WHERE "upstreamPath" = ${upstreamPath}
      `.execute(trx);
      if (conflictingReservation.rows[0]) {
        throw new Error(`Normalization target is reserved by another asset: ${upstreamPath}`);
      }
      const existingMapping = await sql<{ assetId: string }>`
        SELECT "assetId" FROM immich_fork.asset_physical_file WHERE "upstreamPath" = ${upstreamPath}
      `.execute(trx);
      if (existingMapping.rows[0] && existingMapping.rows[0].assetId !== asset.id) {
        throw new Error(`Normalization target is owned by another fork asset: ${upstreamPath}`);
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
      const temporaryPath = join(dirname(upstreamPath), `.${parse(upstreamPath).base}.${token}.normalize`);
      const inserted = await sql<PhysicalNormalizationReservation>`
        INSERT INTO immich_fork.asset_storage_reservation
          ("assetId", token, "sourcePath", "upstreamPath", "temporaryPath", status)
        VALUES (${asset.id}::uuid, ${token}::uuid, ${asset.originalPath}, ${upstreamPath}, ${temporaryPath}, 'reserved')
        RETURNING "assetId", token, "sourcePath", "upstreamPath", "temporaryPath"
      `.execute(trx);
      return { status: 'reserved', asset, reservation: inserted.rows[0]!, recovered: false };
    });
  }

  async releaseNormalizationReservation(assetId: string, token: string): Promise<void> {
    await sql`
      DELETE FROM immich_fork.asset_storage_reservation
      WHERE "assetId" = ${assetId}::uuid AND token = ${token}::uuid
    `.execute(this.db);
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
    return this.db.transaction().execute(async (trx) => {
      const state = await sql<{ allowed: boolean }>`
        SELECT state.phase = 'dual-write' OR (
          state.phase = 'inactive' AND EXISTS (
            SELECT 1 FROM immich_fork.migration_audit
            WHERE name = 'fork-return-reconciliation' AND phase = 'inactive' AND status = 'running'
          )
        ) AS allowed
        FROM immich_fork.state state
        WHERE state.id = 1
        FOR SHARE
      `.execute(trx);
      if (!state.rows[0]?.allowed) {
        throw new Error('Storage normalization can only run in dual-write phase');
      }
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
      const reservation = reservations.rows[0];
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
          await this.commitNormalization(trx, { ...input, asset });
        },
      });
    });
  }

  private async commitNormalization(
    db: Kysely<DB> | Transaction<DB>,
    input: PhysicalNormalizationCommit,
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

  async linkAssetToOriginalPhysicalFile(assetId: string, physicalFile: Pick<PhysicalFile, 'id' | 'path'>) {
    await this.db
      .updateTable('asset')
      .set({ physicalOriginalFileId: physicalFile.id, originalPath: physicalFile.path })
      .where('id', '=', asUuid(assetId))
      .execute();
  }

  async isOriginalCanonical(assetId: string, physicalFileId: string): Promise<boolean> {
    const physicalFile = await this.getPhysicalFile(physicalFileId);
    return physicalFile?.canonicalAssetId === assetId;
  }

  async updateOriginalPhysicalPathForAsset(assetId: string, path: string) {
    await this.db.transaction().execute(async (trx) => {
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

  async linkGeneratedFile(assetId: string, type: AssetFileType, physicalFileId: string, path: string) {
    await this.db
      .updateTable('asset_file')
      .set({ physicalFileId, path })
      .where('assetId', '=', asUuid(assetId))
      .where('type', '=', type)
      .where('isEdited', '=', false)
      .execute();
  }

  async countReferences(physicalFileId: string): Promise<number> {
    const [assetRefs, fileRefs] = await Promise.all([
      this.db
        .selectFrom('asset')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('physicalOriginalFileId', '=', asUuid(physicalFileId))
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('asset_file')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('physicalFileId', '=', asUuid(physicalFileId))
        .executeTakeFirstOrThrow(),
    ]);

    return Number(assetRefs.count) + Number(fileRefs.count);
  }

  async deletePhysicalFile(id: string) {
    await this.db.deleteFrom('physical_file').where('id', '=', asUuid(id)).execute();
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

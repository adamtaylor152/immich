import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, Selectable, sql, Updateable } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  AssetFileType,
  AssetStatus,
  ChecksumAlgorithm,
  MediaHealthCategory,
  MediaHealthSeverity,
  MediaHealthStatus,
  PhysicalFileType,
} from 'src/enum';
import {
  combineVerifications,
  DerivedBackfillResult,
  getForkSchemaPhase,
  lockForkAssetParent,
  readsForkSidecar,
  TableVerification,
  verifyRows,
  writesForkSidecar,
  writesLegacy,
} from 'src/repositories/fork-derived-results';
import { DB } from 'src/schema';
import { AssetHealthCandidateTable, AssetHealthRunTable, AssetHealthTable } from 'src/schema/tables/asset-health.table';
import { AssetTable } from 'src/schema/tables/asset.table';
import { anyUuid, asUuid, withHiddenContentFilter } from 'src/utils/database';
import type { HiddenContentQueryOptions } from 'src/utils/hidden-content';

export type MediaHealthRun = Selectable<AssetHealthRunTable>;
export type MediaHealthFinding = Selectable<AssetHealthTable>;
export type MediaHealthCandidate = Selectable<AssetHealthCandidateTable>;
export type MediaHealthChecksum = {
  assetId: string;
  sha1: Buffer;
  sha256: Buffer;
  sizeInBytes: number;
};

export type MediaHealthAsset = Pick<
  Selectable<AssetTable>,
  | 'id'
  | 'updateId'
  | 'ownerId'
  | 'type'
  | 'originalPath'
  | 'originalFileName'
  | 'isExternal'
  | 'libraryId'
  | 'thumbhash'
  | 'fileCreatedAt'
  | 'fileModifiedAt'
  | 'localDateTime'
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
  | 'duration'
  | 'checksum'
  | 'checksumAlgorithm'
  | 'isFavorite'
  | 'visibility'
  | 'livePhotoVideoId'
  | 'stackId'
  | 'duplicateId'
  | 'status'
  | 'isOffline'
  | 'width'
  | 'height'
  | 'isEdited'
> & {
  previewPath: string | null;
  thumbnailPath: string | null;
};

export type UpsertMediaHealthFinding = Omit<
  Insertable<AssetHealthTable>,
  'id' | 'createdAt' | 'updatedAt' | 'dismissedAt' | 'resolvedAt'
> & {
  dismissedAt?: Date | null;
  resolvedAt?: Date | null;
};

export type UpsertMediaHealthCandidate = Omit<Insertable<AssetHealthCandidateTable>, 'id' | 'createdAt' | 'updatedAt'>;
export type RelinkManagedAsset = {
  assetId: string;
  ownerId: string;
  healthId: string;
  originalPath: string;
  originalFileName: string;
  expectedChecksum: Buffer;
  sha1: Buffer;
  sha256: Buffer;
  sizeInBytes: number;
  fileModifiedAt: Date;
};
type HealthBackfillTables = {
  assetHealthRun: TableVerification;
  assetHealth: TableVerification;
  assetHealthCandidate: TableVerification;
};

@Injectable()
export class MediaHealthRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  async createRun(category: MediaHealthCategory, ownerId?: string): Promise<MediaHealthRun> {
    const phase = await getForkSchemaPhase(this.db);
    const run = {
      id: randomUUID(),
      ownerId: ownerId ?? null,
      category,
      status: 'running',
      startedAt: new Date(),
      finishedAt: null,
      totalAssets: 0,
      checkedAssets: 0,
      foundAssets: 0,
      error: null,
    };
    await this.db.transaction().execute(async (trx) => {
      if (writesLegacy(phase)) {
        await trx.withSchema('public').insertInto('asset_health_run').values(run).execute();
      }
      if (writesForkSidecar(phase)) {
        await trx.withSchema('immich_fork').insertInto('asset_health_run').values(run).execute();
      }
    });
    return run;
  }

  async finishRun(id: string, update: Updateable<AssetHealthRunTable>): Promise<MediaHealthRun | undefined> {
    const phase = await getForkSchemaPhase(this.db);
    const values = { ...update, finishedAt: update.finishedAt ?? new Date() };
    let result: MediaHealthRun | undefined;
    await this.db.transaction().execute(async (trx) => {
      if (writesLegacy(phase)) {
        result = await trx
          .withSchema('public')
          .updateTable('asset_health_run')
          .set(values)
          .where('id', '=', asUuid(id))
          .returningAll()
          .executeTakeFirst();
      }
      if (writesForkSidecar(phase)) {
        const sidecar = await trx
          .withSchema('immich_fork')
          .updateTable('asset_health_run')
          .set(values)
          .where('id', '=', asUuid(id))
          .returningAll()
          .executeTakeFirst();
        result ??= sidecar;
      }
    });
    return result;
  }

  async getLatestRun(category?: MediaHealthCategory, ownerId?: string): Promise<MediaHealthRun | undefined> {
    const phase = await getForkSchemaPhase(this.db);
    return this.db
      .withSchema(readsForkSidecar(phase) ? 'immich_fork' : 'public')
      .selectFrom('asset_health_run')
      .selectAll()
      .$if(!!ownerId, (qb) => qb.where('ownerId', '=', asUuid(ownerId!)))
      .$if(!!category, (qb) => qb.where('category', '=', category!))
      .orderBy('startedAt', 'desc')
      .limit(1)
      .executeTakeFirst();
  }

  async list(options: {
    category?: MediaHealthCategory;
    ownerId?: string;
    privacy?: HiddenContentQueryOptions;
    status?: MediaHealthStatus;
    size: number;
  }): Promise<MediaHealthFinding[]> {
    const phase = await getForkSchemaPhase(this.db);
    const schema = readsForkSidecar(phase) ? 'immich_fork' : 'public';
    return (this.db as Kysely<any>)
      .selectFrom(`${schema}.asset_health as asset_health`)
      .innerJoin('public.asset as asset', 'asset.id', 'asset_health.assetId')
      .selectAll('asset_health')
      .$if(!!options.ownerId, (qb) => qb.where('asset.ownerId', '=', asUuid(options.ownerId!)))
      .$call((qb) => withHiddenContentFilter(qb, options.privacy))
      .$if(!!options.category, (qb) => qb.where('category', '=', options.category!))
      .$if(!!options.status, (qb) => qb.where('status', '=', options.status!))
      .orderBy('checkedAt', 'desc')
      .limit(options.size)
      .execute() as Promise<MediaHealthFinding[]>;
  }

  async getByIds(ids: string[], ownerId?: string, privacy?: HiddenContentQueryOptions): Promise<MediaHealthFinding[]> {
    if (ids.length === 0) {
      return [];
    }
    const phase = await getForkSchemaPhase(this.db);
    const schema = readsForkSidecar(phase) ? 'immich_fork' : 'public';
    return (this.db as Kysely<any>)
      .selectFrom(`${schema}.asset_health as asset_health`)
      .innerJoin('public.asset as asset', 'asset.id', 'asset_health.assetId')
      .selectAll('asset_health')
      .where('asset_health.id', '=', anyUuid(ids))
      .$if(!!ownerId, (qb) => qb.where('asset.ownerId', '=', asUuid(ownerId!)))
      .$call((qb) => withHiddenContentFilter(qb, privacy))
      .execute() as Promise<MediaHealthFinding[]>;
  }

  async getCandidatesByHealthIds(healthIds: string[]): Promise<MediaHealthCandidate[]> {
    if (healthIds.length === 0) {
      return [];
    }
    const phase = await getForkSchemaPhase(this.db);
    return this.db
      .withSchema(readsForkSidecar(phase) ? 'immich_fork' : 'public')
      .selectFrom('asset_health_candidate')
      .selectAll()
      .where('healthId', '=', anyUuid(healthIds))
      .orderBy('visualMatchScore', 'desc')
      .execute();
  }

  async getAssetChecksums(assetIds: string[]): Promise<MediaHealthChecksum[]> {
    if (assetIds.length === 0) {
      return [];
    }

    const result = await sql<MediaHealthChecksum>`
      SELECT "assetId", sha1, sha256, "sizeInBytes"::float8 AS "sizeInBytes"
      FROM immich_fork.asset_checksum
      WHERE "assetId" = ANY(${assetIds}::uuid[])
    `.execute(this.db);
    return result.rows;
  }

  getInternalAssetByOriginalPath(originalPath: string): Promise<{ id: string } | undefined> {
    return this.db
      .withSchema('public')
      .selectFrom('asset')
      .select('id')
      .where('originalPath', '=', path.normalize(originalPath))
      .where('libraryId', 'is', null)
      .where('isExternal', '=', false)
      .where('deletedAt', 'is', null)
      .where('status', '=', AssetStatus.Active)
      .limit(1)
      .executeTakeFirst();
  }

  async getTrackedPaths(paths: string[]): Promise<Set<string>> {
    if (paths.length === 0) {
      return new Set();
    }
    const rows = await this.db
      .withSchema('public')
      .selectFrom('asset')
      .select('originalPath')
      .where('originalPath', 'in', paths)
      .execute();
    return new Set(rows.map(({ originalPath }) => originalPath));
  }

  async replaceCandidates(healthId: string, candidates: UpsertMediaHealthCandidate[]): Promise<void> {
    const phase = await getForkSchemaPhase(this.db);
    if (candidates.some((candidate) => candidate.healthId !== healthId)) {
      throw new Error(`Cannot replace media-health candidates for multiple findings`);
    }
    const now = new Date();
    const rows = candidates.map((candidate) => ({ id: randomUUID(), createdAt: now, updatedAt: now, ...candidate }));
    await this.db.transaction().execute(async (trx) => {
      if (writesForkSidecar(phase)) {
        const observedFinding = await trx
          .withSchema('immich_fork')
          .selectFrom('asset_health')
          .select(['assetId', 'runId'])
          .where('id', '=', asUuid(healthId))
          .executeTakeFirst();
        if (!observedFinding) {
          throw new Error(`Cannot write candidates for missing fork media-health finding ${healthId}`);
        }
        await lockForkAssetParent(trx, observedFinding.assetId);
        const finding = await trx
          .withSchema('immich_fork')
          .selectFrom('asset_health')
          .select(['assetId', 'runId'])
          .where('id', '=', asUuid(healthId))
          .forKeyShare()
          .executeTakeFirst();
        if (!finding || finding.assetId !== observedFinding.assetId) {
          throw new Error(`Fork media-health finding ${healthId} changed while replacing candidates`);
        }
        if (finding.runId) {
          await this.lockForkHealthRun(trx, finding.runId);
        }
      }
      for (const schema of this.writeSchemas(phase)) {
        const target = trx.withSchema(schema);
        await target.deleteFrom('asset_health_candidate').where('healthId', '=', asUuid(healthId)).execute();
        if (rows.length > 0) {
          await target.insertInto('asset_health_candidate').values(rows).execute();
        }
      }
    });
  }

  async upsertFinding(finding: UpsertMediaHealthFinding): Promise<MediaHealthFinding> {
    const phase = await getForkSchemaPhase(this.db);
    let result: MediaHealthFinding | undefined;
    await this.db.transaction().execute(async (trx) => {
      if (writesForkSidecar(phase)) {
        await lockForkAssetParent(trx, finding.assetId);
        if (finding.runId) {
          await this.lockForkHealthRun(trx, finding.runId);
        }
      }
      if (writesLegacy(phase)) {
        result = await this.upsertFindingInto(trx.withSchema('public'), finding);
      }
      if (writesForkSidecar(phase)) {
        if (writesLegacy(phase)) {
          await this.copyFindingExact(trx.withSchema('immich_fork'), result!);
        } else {
          result = await this.upsertFindingInto(trx.withSchema('immich_fork'), finding);
        }
      }
    });
    return result!;
  }

  private async lockForkHealthRun(db: Kysely<DB>, runId: string): Promise<void> {
    const run = await db
      .withSchema('immich_fork')
      .selectFrom('asset_health_run')
      .select('id')
      .where('id', '=', asUuid(runId))
      .forKeyShare()
      .executeTakeFirst();
    if (!run) {
      throw new Error(`Cannot write fork media-health result for missing run ${runId}`);
    }
  }

  private upsertFindingInto(db: Kysely<DB>, finding: UpsertMediaHealthFinding): Promise<MediaHealthFinding> {
    return db
      .insertInto('asset_health')
      .values({
        dismissedAt: null,
        resolvedAt: null,
        ...finding,
      })
      .onConflict((oc) =>
        oc.columns(['assetId', 'category']).doUpdateSet((eb) => ({
          runId: eb.ref('excluded.runId'),
          status: eb.ref('excluded.status'),
          severity: eb.ref('excluded.severity'),
          originalPath: eb.ref('excluded.originalPath'),
          originalFileName: eb.ref('excluded.originalFileName'),
          evidence: eb.ref('excluded.evidence'),
          resolution: eb.ref('excluded.resolution'),
          checkedAt: eb.ref('excluded.checkedAt'),
          dismissedAt: eb.ref('excluded.dismissedAt'),
          resolvedAt: eb.ref('excluded.resolvedAt'),
        })),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  private async copyFindingExact(db: Kysely<DB>, finding: MediaHealthFinding): Promise<void> {
    await db
      .insertInto('asset_health')
      .values(finding)
      .onConflict((oc) => oc.columns(['assetId', 'category']).doUpdateSet(finding))
      .execute();
  }

  async markResolved(category: MediaHealthCategory, assetId: string): Promise<void> {
    const phase = await getForkSchemaPhase(this.db);
    const resolvedAt = new Date();
    await this.db.transaction().execute(async (trx) => {
      for (const schema of this.writeSchemas(phase)) {
        await trx
          .withSchema(schema)
          .updateTable('asset_health')
          .set({ status: MediaHealthStatus.Resolved, severity: MediaHealthSeverity.Info, resolvedAt })
          .where('category', '=', category)
          .where('assetId', '=', asUuid(assetId))
          .execute();
      }
    });
  }

  async markResolvedMany(category: MediaHealthCategory, assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }
    const phase = await getForkSchemaPhase(this.db);
    const resolvedAt = new Date();
    await this.db.transaction().execute(async (trx) => {
      for (const schema of this.writeSchemas(phase)) {
        await trx
          .withSchema(schema)
          .updateTable('asset_health')
          .set({ status: MediaHealthStatus.Resolved, severity: MediaHealthSeverity.Info, resolvedAt })
          .where('category', '=', category)
          .where('assetId', '=', anyUuid(assetIds))
          .execute();
      }
    });
  }

  async markResolvedCategories(categories: MediaHealthCategory[], assetId: string): Promise<void> {
    if (categories.length === 0) {
      return;
    }
    const phase = await getForkSchemaPhase(this.db);
    const resolvedAt = new Date();
    await this.db.transaction().execute(async (trx) => {
      for (const schema of this.writeSchemas(phase)) {
        await trx
          .withSchema(schema)
          .updateTable('asset_health')
          .set({ status: MediaHealthStatus.Resolved, severity: MediaHealthSeverity.Info, resolvedAt })
          .where('category', 'in', categories)
          .where('assetId', '=', asUuid(assetId))
          .execute();
      }
    });
  }

  async markDismissed(ids: string[], ownerId?: string): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    const phase = await getForkSchemaPhase(this.db);
    const dismissedAt = new Date();
    await this.db.transaction().execute(async (trx) => {
      for (const schema of this.writeSchemas(phase)) {
        await trx
          .withSchema(schema)
          .updateTable('asset_health')
          .set({ status: MediaHealthStatus.Dismissed, dismissedAt })
          .where('id', '=', anyUuid(ids))
          .$if(!!ownerId, (qb) =>
            qb.where(
              sql<boolean>`EXISTS (
                SELECT 1 FROM public.asset
                WHERE asset.id = asset_health."assetId" AND asset."ownerId" = ${ownerId}::uuid
              )`,
            ),
          )
          .execute();
      }
    });
  }

  async markStatus(ids: string[], status: MediaHealthStatus): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    const phase = await getForkSchemaPhase(this.db);
    await this.db.transaction().execute(async (trx) => {
      for (const schema of this.writeSchemas(phase)) {
        await trx
          .withSchema(schema)
          .updateTable('asset_health')
          .set({ status })
          .where('id', '=', anyUuid(ids))
          .execute();
      }
    });
  }

  async *streamAssets(options: { assetIds?: string[]; ownerId?: string } = {}): AsyncGenerator<MediaHealthAsset> {
    if (options.assetIds && options.assetIds.length === 0) {
      return;
    }

    const query = this.db
      .withSchema('public')
      .selectFrom('asset')
      .select([
        'asset.id',
        'asset.updateId',
        'asset.ownerId',
        'asset.type',
        'asset.originalPath',
        'asset.originalFileName',
        'asset.isExternal',
        'asset.libraryId',
        'asset.thumbhash',
        'asset.fileCreatedAt',
        'asset.fileModifiedAt',
        'asset.localDateTime',
        'asset.createdAt',
        'asset.updatedAt',
        'asset.deletedAt',
        'asset.duration',
        'asset.checksum',
        'asset.checksumAlgorithm',
        'asset.isFavorite',
        'asset.visibility',
        'asset.livePhotoVideoId',
        'asset.stackId',
        'asset.duplicateId',
        'asset.status',
        'asset.isOffline',
        'asset.width',
        'asset.height',
        'asset.isEdited',
      ])
      .select((eb) => [
        eb
          .selectFrom('asset_file')
          .select('path')
          .whereRef('asset_file.assetId', '=', 'asset.id')
          .where('type', '=', AssetFileType.Preview)
          .where('isEdited', '=', false)
          .limit(1)
          .as('previewPath'),
        eb
          .selectFrom('asset_file')
          .select('path')
          .whereRef('asset_file.assetId', '=', 'asset.id')
          .where('type', '=', AssetFileType.Thumbnail)
          .where('isEdited', '=', false)
          .limit(1)
          .as('thumbnailPath'),
      ])
      .where('asset.deletedAt', 'is', null)
      .where('asset.status', '!=', sql.lit(AssetStatus.Deleted))
      .$if(!!options.ownerId, (qb) => qb.where('asset.ownerId', '=', asUuid(options.ownerId!)))
      .$if(!!options.assetIds, (qb) => qb.where('asset.id', '=', anyUuid(options.assetIds!)));

    for await (const asset of query.stream()) {
      yield asset;
    }
  }

  getAssets(assetIds: string[], ownerId?: string, privacy?: HiddenContentQueryOptions): Promise<MediaHealthAsset[]> {
    if (assetIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .withSchema('public')
      .selectFrom('asset')
      .selectAll('asset')
      .select((eb) => [
        eb
          .selectFrom('asset_file')
          .select('path')
          .whereRef('asset_file.assetId', '=', 'asset.id')
          .where('type', '=', AssetFileType.Preview)
          .where('isEdited', '=', false)
          .limit(1)
          .as('previewPath'),
        eb
          .selectFrom('asset_file')
          .select('path')
          .whereRef('asset_file.assetId', '=', 'asset.id')
          .where('type', '=', AssetFileType.Thumbnail)
          .where('isEdited', '=', false)
          .limit(1)
          .as('thumbnailPath'),
      ])
      .where('asset.id', '=', anyUuid(assetIds))
      .$if(!!ownerId, (qb) => qb.where('asset.ownerId', '=', asUuid(ownerId!)))
      .$call((qb) => withHiddenContentFilter(qb, privacy))
      .execute();
  }

  async relinkManagedAsset(input: RelinkManagedAsset): Promise<boolean> {
    const phase = await getForkSchemaPhase(this.db);
    const recoveredPath = path.normalize(input.originalPath);

    return this.db.transaction().execute(async (trx) => {
      const lockKey = createHash('sha1').update(recoveredPath).digest().readBigInt64BE(0);
      await sql`SELECT pg_advisory_xact_lock(${lockKey.toString()}::bigint)`.execute(trx);

      const asset = await trx
        .withSchema('public')
        .selectFrom('asset')
        .select(['id', 'ownerId', 'checksum', 'originalPath', 'isExternal', 'libraryId', 'deletedAt', 'status'])
        .where('id', '=', asUuid(input.assetId))
        .forUpdate()
        .executeTakeFirst();
      if (
        !asset ||
        asset.ownerId !== input.ownerId ||
        asset.isExternal ||
        asset.libraryId ||
        asset.deletedAt ||
        asset.status !== AssetStatus.Active ||
        !asset.checksum.equals(input.expectedChecksum)
      ) {
        return false;
      }

      const healthSchema = readsForkSidecar(phase) ? 'immich_fork' : 'public';
      const health = await (trx as Kysely<any>)
        .selectFrom(`${healthSchema}.asset_health as asset_health`)
        .select(['assetId', 'category'])
        .where('id', '=', asUuid(input.healthId))
        .forUpdate()
        .executeTakeFirst();
      if (health?.assetId !== input.assetId || health.category !== MediaHealthCategory.Missing) {
        return false;
      }

      const candidateAsset = await trx
        .withSchema('public')
        .selectFrom('asset')
        .select('id')
        .where('originalPath', '=', recoveredPath)
        .where('libraryId', 'is', null)
        .where('isExternal', '=', false)
        .where('deletedAt', 'is', null)
        .where('status', '=', AssetStatus.Active)
        .executeTakeFirst();
      const existingPhysical = await trx
        .withSchema('public')
        .selectFrom('physical_file')
        .selectAll()
        .where('path', '=', recoveredPath)
        .executeTakeFirst();
      const physical = existingPhysical
        ? await trx
            .withSchema('public')
            .updateTable('physical_file')
            .set({ checksum: input.sha256, sizeInBytes: input.sizeInBytes, type: PhysicalFileType.Original })
            .where('id', '=', existingPhysical.id)
            .returningAll()
            .executeTakeFirstOrThrow()
        : await trx
            .withSchema('public')
            .insertInto('physical_file')
            .values({
              canonicalAssetId: candidateAsset?.id ?? input.assetId,
              checksum: input.sha256,
              path: recoveredPath,
              sizeInBytes: input.sizeInBytes,
              type: PhysicalFileType.Original,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

      await trx
        .withSchema('public')
        .updateTable('asset')
        .set({
          physicalOriginalFileId: physical.id,
          originalPath: recoveredPath,
          checksum: input.sha256,
          checksumAlgorithm: ChecksumAlgorithm.sha256File,
          fileModifiedAt: input.fileModifiedAt,
          isOffline: false,
          deletedAt: null,
          status: AssetStatus.Active,
        })
        .where('id', '=', asUuid(input.assetId))
        .executeTakeFirstOrThrow();

      await sql`
        INSERT INTO immich_fork.asset_checksum
          ("assetId", sha1, sha256, "sizeInBytes", "verifiedPaths", "linkCount", evidence, "verifiedAt", "updatedAt")
        VALUES (
          ${input.assetId}::uuid, ${input.sha1}, ${input.sha256}, ${input.sizeInBytes}, ARRAY[${recoveredPath}]::text[],
          1, '{"source":"recovery"}'::jsonb, now(), now()
        )
        ON CONFLICT ("assetId") DO UPDATE SET
          sha1 = EXCLUDED.sha1, sha256 = EXCLUDED.sha256, "sizeInBytes" = EXCLUDED."sizeInBytes",
          "verifiedPaths" = EXCLUDED."verifiedPaths", evidence = EXCLUDED.evidence,
          "verifiedAt" = EXCLUDED."verifiedAt", "updatedAt" = EXCLUDED."updatedAt"
      `.execute(trx);

      const checkedAt = new Date();
      for (const schema of this.writeSchemas(phase)) {
        await trx
          .withSchema(schema)
          .updateTable('asset_health')
          .set({
            runId: null,
            status: MediaHealthStatus.Relinked,
            severity: MediaHealthSeverity.Info,
            originalPath: recoveredPath,
            originalFileName: input.originalFileName,
            evidence: { reason: 'candidate_relinked', previousPath: asset.originalPath },
            resolution: { healthId: input.healthId },
            checkedAt,
            resolvedAt: checkedAt,
          })
          .where('id', '=', asUuid(input.healthId))
          .where('assetId', '=', asUuid(input.assetId))
          .execute();
      }

      return true;
    });
  }

  async relinkExternalAsset(options: {
    assetId: string;
    originalPath: string;
    originalFileName: string;
    checksum: Buffer;
    fileModifiedAt: Date;
  }): Promise<boolean> {
    const result = await this.db
      .withSchema('public')
      .updateTable('asset')
      .set({
        originalPath: options.originalPath,
        originalFileName: options.originalFileName,
        checksum: options.checksum,
        checksumAlgorithm: ChecksumAlgorithm.sha1Path,
        fileModifiedAt: options.fileModifiedAt,
        isOffline: false,
        deletedAt: null,
        status: AssetStatus.Active,
      })
      .where('id', '=', asUuid(options.assetId))
      .where('isExternal', '=', true)
      .where('libraryId', 'is not', null)
      .execute();

    return Number(result[0]?.numUpdatedRows ?? 0) > 0;
  }

  async deleteForAssets(assetIds: string[], db: Kysely<DB> = this.db): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }
    await sql`
      DELETE FROM immich_fork.asset_health_candidate candidate
      USING immich_fork.asset_health health
      WHERE candidate."healthId" = health.id AND health."assetId" = ANY(${assetIds}::uuid[])
    `.execute(db);
    await sql`DELETE FROM immich_fork.asset_health WHERE "assetId" = ANY(${assetIds}::uuid[])`.execute(db);
  }

  async backfillHealth(ids: string[]): Promise<DerivedBackfillResult<HealthBackfillTables>> {
    return this.db.transaction().execute(async (trx) => {
      await sql`
        INSERT INTO immich_fork.orphaned_records ("sourceTable", "sourceKey", payload)
        SELECT 'asset_health', health.id::text, to_jsonb(health)
        FROM public.asset_health health
        LEFT JOIN public.asset ON asset.id = health."assetId"
        WHERE asset.id IS NULL
        ON CONFLICT ("sourceTable", "sourceKey") DO UPDATE SET payload = EXCLUDED.payload
      `.execute(trx);
      await sql`
        INSERT INTO immich_fork.orphaned_records ("sourceTable", "sourceKey", payload)
        SELECT 'asset_health_candidate', candidate.id::text, to_jsonb(candidate)
        FROM public.asset_health_candidate candidate
        LEFT JOIN public.asset_health health ON health.id = candidate."healthId"
        LEFT JOIN public.asset ON asset.id = health."assetId"
        WHERE asset.id IS NULL
        ON CONFLICT ("sourceTable", "sourceKey") DO UPDATE SET payload = EXCLUDED.payload
      `.execute(trx);
      await sql`
        DELETE FROM immich_fork.asset_health_candidate candidate
        WHERE NOT EXISTS (
          SELECT 1 FROM public.asset_health_candidate source WHERE source.id = candidate.id
        )
      `.execute(trx);
      await sql`
        DELETE FROM immich_fork.asset_health health
        WHERE NOT EXISTS (SELECT 1 FROM public.asset_health source WHERE source.id = health.id)
      `.execute(trx);
      await sql`
        DELETE FROM immich_fork.asset_health_run run
        WHERE NOT EXISTS (SELECT 1 FROM public.asset_health_run source WHERE source.id = run.id)
      `.execute(trx);
      await sql`
        INSERT INTO immich_fork.asset_health_run
        SELECT * FROM public.asset_health_run
        ON CONFLICT (id) DO UPDATE SET
          category = EXCLUDED.category, status = EXCLUDED.status, "startedAt" = EXCLUDED."startedAt",
          "finishedAt" = EXCLUDED."finishedAt", "totalAssets" = EXCLUDED."totalAssets",
          "checkedAssets" = EXCLUDED."checkedAssets", "foundAssets" = EXCLUDED."foundAssets", error = EXCLUDED.error,
          "ownerId" = EXCLUDED."ownerId"
      `.execute(trx);
      if (ids.length > 0) {
        await sql`
          DELETE FROM immich_fork.asset_health_candidate candidate
          USING immich_fork.asset_health health
          WHERE candidate."healthId" = health.id AND health."assetId" = ANY(${ids}::uuid[])
        `.execute(trx);
        await sql`DELETE FROM immich_fork.asset_health WHERE "assetId" = ANY(${ids}::uuid[])`.execute(trx);
        await sql`
          INSERT INTO immich_fork.asset_health
          SELECT health.* FROM public.asset_health health
          INNER JOIN public.asset ON asset.id = health."assetId"
          WHERE health."assetId" = ANY(${ids}::uuid[])
          ON CONFLICT ("assetId", category) DO UPDATE SET
            id = EXCLUDED.id, "runId" = EXCLUDED."runId", status = EXCLUDED.status, severity = EXCLUDED.severity,
            "originalPath" = EXCLUDED."originalPath", "originalFileName" = EXCLUDED."originalFileName",
            evidence = EXCLUDED.evidence, resolution = EXCLUDED.resolution, "checkedAt" = EXCLUDED."checkedAt",
            "dismissedAt" = EXCLUDED."dismissedAt", "resolvedAt" = EXCLUDED."resolvedAt",
            "createdAt" = EXCLUDED."createdAt", "updatedAt" = EXCLUDED."updatedAt"
        `.execute(trx);
        await sql`
          INSERT INTO immich_fork.asset_health_candidate
          SELECT candidate.* FROM public.asset_health_candidate candidate
          INNER JOIN public.asset_health health ON health.id = candidate."healthId"
          INNER JOIN public.asset ON asset.id = health."assetId"
          WHERE health."assetId" = ANY(${ids}::uuid[])
          ON CONFLICT ("healthId", "candidatePath") DO UPDATE SET
            id = EXCLUDED.id, status = EXCLUDED.status, "visualMatchScore" = EXCLUDED."visualMatchScore",
            evidence = EXCLUDED.evidence, resolution = EXCLUDED.resolution, "checkedAt" = EXCLUDED."checkedAt",
            "createdAt" = EXCLUDED."createdAt", "updatedAt" = EXCLUDED."updatedAt"
        `.execute(trx);
      }
      await sql`
        DELETE FROM immich_fork.asset_health_candidate candidate
        WHERE NOT EXISTS (SELECT 1 FROM immich_fork.asset_health health WHERE health.id = candidate."healthId")
      `.execute(trx);
      await sql`
        DELETE FROM immich_fork.asset_health health
        WHERE NOT EXISTS (SELECT 1 FROM public.asset WHERE asset.id = health."assetId")
      `.execute(trx);
      const runs = await sql<Record<string, unknown>>`
        SELECT * FROM immich_fork.asset_health_run ORDER BY id::text
      `.execute(trx);
      const health = await sql<Record<string, unknown>>`
        SELECT * FROM immich_fork.asset_health WHERE "assetId" = ANY(${ids}::uuid[])
        ORDER BY "assetId"::text, category
      `.execute(trx);
      const candidates = await sql<Record<string, unknown>>`
        SELECT candidate.* FROM immich_fork.asset_health_candidate candidate
        INNER JOIN immich_fork.asset_health health ON health.id = candidate."healthId"
        WHERE health."assetId" = ANY(${ids}::uuid[])
        ORDER BY candidate."healthId"::text, candidate."candidatePath"
      `.execute(trx);
      return combineVerifications(ids.length, {
        assetHealthRun: verifyRows(runs.rows),
        assetHealth: verifyRows(health.rows),
        assetHealthCandidate: verifyRows(candidates.rows),
      });
    });
  }

  private writeSchemas(phase: Awaited<ReturnType<typeof getForkSchemaPhase>>): Array<'public' | 'immich_fork'> {
    return [
      ...(writesLegacy(phase) ? (['public'] as const) : []),
      ...(writesForkSidecar(phase) ? (['immich_fork'] as const) : []),
    ];
  }
}

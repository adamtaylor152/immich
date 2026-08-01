import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, Updateable, sql } from 'kysely';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { DummyValue, GenerateSql } from 'src/decorators';
import { WorkflowSearchDto } from 'src/dtos/workflow.dto';
import { AssetMetadataKey, AssetVisibility } from 'src/enum';
import { DB } from 'src/schema';
import { WorkflowStepTable } from 'src/schema/tables/workflow-step.table';
import { WorkflowTable } from 'src/schema/tables/workflow.table';
import { nsfwAssetIdExists } from 'src/utils/database';

export type WorkflowStepUpsert = Omit<Insertable<WorkflowStepTable>, 'workflowId' | 'order'>;

@Injectable()
export class WorkflowRepository {
  private allowedHostsColumn: Promise<boolean> | undefined;
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  private queryBuilder(db?: Kysely<DB>) {
    return (db ?? this.db)
      .selectFrom('workflow')
      .select([
        'workflow.id',
        'workflow.name',
        'workflow.description',
        'workflow.trigger',
        'workflow.enabled',
        'workflow.createdAt',
        'workflow.updatedAt',
      ])
      .select((eb) => [
        jsonArrayFrom(
          eb
            .selectFrom('workflow_step')
            .innerJoin('plugin_method', 'plugin_method.id', 'workflow_step.pluginMethodId')
            .innerJoin('plugin', 'plugin.id', 'plugin_method.pluginId')
            .whereRef('workflow.id', '=', 'workflow_step.workflowId')
            .select([
              'plugin.name as pluginName',
              'plugin_method.name as methodName',
              'workflow_step.config',
              'workflow_step.enabled',
            ])
            .orderBy('workflow_step.order', 'asc'),
        ).as('steps'),
      ]);
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  search(dto: WorkflowSearchDto & { userId?: string }) {
    return this.queryBuilder()
      .$if(!!dto.id, (qb) => qb.where('id', '=', dto.id!))
      .$if(!!dto.userId, (qb) => qb.where('ownerId', '=', dto.userId!))
      .$if(!!dto.trigger, (qb) => qb.where('trigger', '=', dto.trigger!))
      .$if(dto.enabled !== undefined, (qb) => qb.where('enabled', '=', dto.enabled!))
      .orderBy('createdAt', 'desc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  get(id: string) {
    return this.queryBuilder().where('id', '=', id).executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getForWorkflowRun(id: string) {
    const hasAllowedHosts = await this.hasAllowedHostsColumn();
    return this.db
      .selectFrom('workflow')
      .select(['workflow.id', 'workflow.name', 'workflow.trigger'])
      .select((eb) => [
        jsonArrayFrom(
          eb
            .selectFrom('workflow_step')
            .innerJoin('plugin_method', 'plugin_method.id', 'workflow_step.pluginMethodId')
            .whereRef('workflow_step.workflowId', '=', 'workflow.id')
            .where('workflow_step.enabled', '=', true)
            .select((eb) => [
              'workflow_step.id',
              'workflow_step.config',
              'plugin_method.pluginId as pluginId',
              'plugin_method.name as methodName',
              'plugin_method.types as types',
              'plugin_method.hostFunctions',
              hasAllowedHosts
                ? eb.ref('plugin_method.allowedHosts').as('allowedHosts')
                : sql<string[]>`ARRAY[]::character varying[]`.as('allowedHosts'),
            ]),
        ).as('steps'),
      ])
      .where('id', '=', id)
      .where('enabled', '=', true)
      .executeTakeFirst();
  }

  private hasAllowedHostsColumn(): Promise<boolean> {
    return (this.allowedHostsColumn ??= sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'plugin_method'
          AND column_name = 'allowedHosts'
      ) AS "exists"
    `
      .execute(this.db)
      .then(({ rows }) => rows[0]?.exists));
  }

  create(dto: Insertable<WorkflowTable>, steps?: WorkflowStepUpsert[]) {
    return this.db.transaction().execute(async (tx) => {
      const { id } = await tx.insertInto('workflow').values(dto).returning(['id']).executeTakeFirstOrThrow();
      return this.replaceAndReturn(tx, id, steps);
    });
  }

  update(id: string, dto: Updateable<WorkflowTable>, steps?: WorkflowStepUpsert[]) {
    return this.db.transaction().execute(async (tx) => {
      if (Object.values(dto).some((prop) => prop !== undefined)) {
        await tx.updateTable('workflow').set(dto).where('id', '=', id).executeTakeFirstOrThrow();
      }
      return this.replaceAndReturn(tx, id, steps);
    });
  }

  async updateStep(id: string, dto: Updateable<WorkflowStepTable>) {
    await this.db.updateTable('workflow_step').where('workflow_step.id', '=', id).set(dto).execute();
  }

  private async replaceAndReturn(tx: Kysely<DB>, workflowId: string, steps?: WorkflowStepUpsert[]) {
    if (steps) {
      await tx.deleteFrom('workflow_step').where('workflowId', '=', workflowId).execute();
      if (steps.length > 0) {
        await tx
          .insertInto('workflow_step')
          .values(
            steps.map((step, i) => ({
              workflowId,
              enabled: step.enabled ?? true,
              pluginMethodId: step.pluginMethodId,
              config: step.config,
              order: i,
            })),
          )
          .returningAll()
          .execute();
      }
    }

    return this.queryBuilder(tx).where('id', '=', workflowId).executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async delete(id: string) {
    await this.db.deleteFrom('workflow').where('id', '=', id).execute();
  }

  /**
   * Fork privacy gate for workflow execution. Fail-closed: returns false unless
   * the asset is provably safe to expose to plugins.
   *
   * @param requireEnrichment When true, also requires that image enrichment
   *   metadata exists for the asset — used when NSFW detection is enabled so
   *   plugins never see assets whose classification has not yet completed.
   */
  async isWorkflowEligible(assetId: string, { requireEnrichment }: { requireEnrichment: boolean }): Promise<boolean> {
    const row = await this.db
      .selectFrom('asset')
      .select((eb) => [
        'asset.visibility',
        // The shared phase-aware predicate uses legacy state during legacy and
        // dual-write, then switches exclusively to the fork privacy sidecar.
        nsfwAssetIdExists(sql.ref('asset.id')).as('isNsfw'),
        eb
          .exists(
            eb
              .selectFrom('asset_metadata')
              .select('asset_metadata.assetId')
              .whereRef('asset_metadata.assetId', '=', 'asset.id')
              .where('asset_metadata.key', '=', AssetMetadataKey.MlEnrichment),
          )
          .as('hasEnrichment'),
      ])
      .where('asset.id', '=', assetId)
      .where('asset.deletedAt', 'is', null)
      .executeTakeFirst();

    if (!row) {
      return false;
    }

    if (row.visibility === AssetVisibility.Hidden || row.visibility === AssetVisibility.Locked) {
      return false;
    }

    if (row.isNsfw) {
      return false;
    }

    if (requireEnrichment && !row.hasEnrichment) {
      return false;
    }

    return true;
  }

  getForAssetV1(assetId: string) {
    return this.db
      .selectFrom('asset')
      .select((eb) => [
        ...columns.workflowAssetV1,
        jsonObjectFrom(
          eb
            .selectFrom('asset_exif')
            .select([
              'asset_exif.make',
              'asset_exif.model',
              'asset_exif.orientation',
              'asset_exif.dateTimeOriginal',
              'asset_exif.modifyDate',
              'asset_exif.exifImageWidth',
              'asset_exif.exifImageHeight',
              'asset_exif.fileSizeInByte',
              'asset_exif.lensModel',
              'asset_exif.fNumber',
              'asset_exif.focalLength',
              'asset_exif.iso',
              'asset_exif.latitude',
              'asset_exif.longitude',
              'asset_exif.city',
              'asset_exif.state',
              'asset_exif.country',
              'asset_exif.description',
              'asset_exif.fps',
              'asset_exif.exposureTime',
              'asset_exif.livePhotoCID',
              'asset_exif.timeZone',
              'asset_exif.projectionType',
              'asset_exif.profileDescription',
              'asset_exif.colorspace',
              'asset_exif.bitsPerSample',
              'asset_exif.autoStackId',
              'asset_exif.rating',
              'asset_exif.tags',
              'asset_exif.updatedAt',
            ])
            .whereRef('asset_exif.assetId', '=', 'asset.id'),
        ).as('exifInfo'),
      ])
      .where('id', '=', assetId)
      .executeTakeFirstOrThrow();
  }
}

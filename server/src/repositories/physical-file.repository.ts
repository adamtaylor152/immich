import { Injectable } from '@nestjs/common';
import { Kysely, Selectable } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { AssetFileType, AssetStatus, PhysicalFileType } from 'src/enum';
import { DB } from 'src/schema';
import { PhysicalFileTable } from 'src/schema/tables/physical-file.table';
import { asUuid } from 'src/utils/database';

type PhysicalFile = Selectable<PhysicalFileTable>;

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

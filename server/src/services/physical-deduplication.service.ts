import { Injectable } from '@nestjs/common';
import { join, parse } from 'node:path';
import { StorageCore } from 'src/cores/storage.core';
import { OnJob } from 'src/decorators';
import {
  AssetFileType,
  DatabaseLock,
  JobName,
  JobStatus,
  PhysicalFileType,
  QueueName,
  StorageFolder,
  SystemMetadataKey,
} from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { JobOf, PhysicalDeduplicationMigrationState } from 'src/types';

type MigrationSummary = PhysicalDeduplicationMigrationState;

const generatedFileTypes = new Set([
  AssetFileType.Thumbnail,
  AssetFileType.Preview,
  AssetFileType.FullSize,
  AssetFileType.EncodedVideo,
]);

@Injectable()
export class PhysicalDeduplicationService extends BaseService {
  @OnJob({ name: JobName.PhysicalDeduplicationMigrationDryRun, queue: QueueName.StorageTemplateMigration })
  async handleDryRun(_: JobOf<JobName.PhysicalDeduplicationMigrationDryRun>): Promise<JobStatus> {
    const { physicalDeduplication } = await this.getConfig({ withCache: true });
    if (!physicalDeduplication.enabled || !physicalDeduplication.masterUserId) {
      this.logger.warn('Physical deduplication dry run skipped: feature is disabled or no master user is configured');
      return JobStatus.Skipped;
    }

    await this.databaseRepository.withLock(DatabaseLock.StorageTemplateMigration, async () => {
      const summary = await this.runMigration('dry-run', physicalDeduplication.masterUserId!);
      await this.systemMetadataRepository.set(SystemMetadataKey.PhysicalDeduplicationMigration, summary);
    });

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.PhysicalDeduplicationMigrationApply, queue: QueueName.StorageTemplateMigration })
  async handleApply(_: JobOf<JobName.PhysicalDeduplicationMigrationApply>): Promise<JobStatus> {
    const { physicalDeduplication } = await this.getConfig({ withCache: true });
    if (!physicalDeduplication.enabled || !physicalDeduplication.masterUserId) {
      this.logger.warn('Physical deduplication apply skipped: feature is disabled or no master user is configured');
      return JobStatus.Skipped;
    }

    const lastRun = await this.systemMetadataRepository.get(SystemMetadataKey.PhysicalDeduplicationMigration);
    if (lastRun?.mode !== 'dry-run' || lastRun.masterUserId !== physicalDeduplication.masterUserId) {
      this.logger.warn('Physical deduplication apply requires a successful dry run first');
      return JobStatus.Failed;
    }

    await this.databaseRepository.withLock(DatabaseLock.StorageTemplateMigration, async () => {
      const summary = await this.runMigration('apply', physicalDeduplication.masterUserId!);
      await this.systemMetadataRepository.set(SystemMetadataKey.PhysicalDeduplicationMigration, summary);
    });

    return JobStatus.Success;
  }

  private async runMigration(mode: MigrationSummary['mode'], masterUserId: string): Promise<MigrationSummary> {
    const summary: MigrationSummary = {
      mode,
      ranAt: new Date().toISOString(),
      masterUserId,
      eligibleAssets: 0,
      linkedAssets: 0,
      skippedExternal: 0,
      skippedMissingMaster: 0,
      reclaimableBytes: 0,
      deletedBytes: 0,
      samples: [],
    };

    for await (const candidate of this.physicalFileRepository.getMigrationCandidates(masterUserId)) {
      if (candidate.isExternal || candidate.libraryId || candidate.isOffline) {
        summary.skippedExternal++;
        continue;
      }

      if (!candidate.sizeInBytes) {
        summary.skippedMissingMaster++;
        continue;
      }

      const master = await this.physicalFileRepository.getMasterOriginalCandidate(
        masterUserId,
        candidate.checksum,
        Number(candidate.sizeInBytes),
      );
      if (!master) {
        summary.skippedMissingMaster++;
        continue;
      }

      summary.eligibleAssets++;
      summary.reclaimableBytes += Number(candidate.sizeInBytes);
      this.addSample(summary, candidate.originalPath);

      if (mode === 'apply') {
        const physicalFile = await this.physicalFileRepository.ensureOriginalPhysicalFile(master.id);
        if (!physicalFile) {
          summary.skippedMissingMaster++;
          continue;
        }

        if (candidate.physicalOriginalFileId !== physicalFile.id) {
          const pathToDelete = candidate.originalPath === physicalFile.path ? undefined : candidate.originalPath;
          await this.migrateSidecarFile(candidate.id, candidate.ownerId, candidate.originalPath);
          await this.physicalFileRepository.linkAssetToOriginalPhysicalFile(candidate.id, physicalFile);
          summary.linkedAssets++;
          await this.queueDelete(pathToDelete);
          summary.deletedBytes += pathToDelete ? Number(candidate.sizeInBytes) : 0;
        }
      }

      await this.migrateGeneratedFiles({
        mode,
        duplicateAssetId: candidate.id,
        masterAssetId: master.id,
        summary,
      });
    }

    this.logger.log(
      `Physical deduplication ${mode} complete: ${summary.eligibleAssets} eligible, ${summary.linkedAssets} linked, ${summary.reclaimableBytes} reclaimable bytes`,
    );
    return summary;
  }

  private async migrateGeneratedFiles({
    mode,
    duplicateAssetId,
    masterAssetId,
    summary,
  }: {
    mode: MigrationSummary['mode'];
    duplicateAssetId: string;
    masterAssetId: string;
    summary: MigrationSummary;
  }) {
    const duplicateFiles = await this.physicalFileRepository.getGeneratedFiles(duplicateAssetId);

    for (const duplicateFile of duplicateFiles) {
      if (!generatedFileTypes.has(duplicateFile.type)) {
        continue;
      }

      const masterFile = await this.physicalFileRepository.getGeneratedFile(masterAssetId, duplicateFile.type);
      if (!masterFile || masterFile.path === duplicateFile.path) {
        continue;
      }

      const duplicateSize = await this.getFileSize(duplicateFile.path);
      summary.reclaimableBytes += duplicateSize;

      if (mode === 'dry-run') {
        continue;
      }

      const masterPhysicalFile = await this.ensureGeneratedPhysicalFile(
        masterAssetId,
        masterFile.type,
        masterFile.path,
      );
      if (!masterPhysicalFile) {
        continue;
      }

      await this.physicalFileRepository.linkGeneratedFile(
        duplicateAssetId,
        duplicateFile.type,
        masterPhysicalFile.id,
        masterPhysicalFile.path,
      );
      await this.queueDelete(duplicateFile.path);
      summary.deletedBytes += duplicateSize;
    }
  }

  private async migrateSidecarFile(assetId: string, ownerId: string, originalPath: string) {
    const sidecarPath = await this.findExistingSidecarPath(originalPath);
    if (!sidecarPath) {
      return;
    }

    const targetPath = StorageCore.getNestedPath(StorageFolder.Upload, ownerId, `${assetId}.xmp`);
    if (sidecarPath !== targetPath && !(await this.storageRepository.checkFileExists(targetPath))) {
      this.storageCore.ensureFolders(targetPath);
      await this.storageRepository.copyFile(sidecarPath, targetPath);
      await this.queueDelete(sidecarPath);
    }

    await this.assetRepository.upsertFile({ assetId, type: AssetFileType.Sidecar, path: targetPath });
  }

  private async findExistingSidecarPath(originalPath: string) {
    for (const candidate of this.getSidecarCandidates(originalPath)) {
      if (await this.storageRepository.checkFileExists(candidate)) {
        return candidate;
      }
    }
  }

  private getSidecarCandidates(originalPath: string) {
    const assetPath = parse(originalPath);
    return [`${originalPath}.xmp`, `${join(assetPath.dir, assetPath.name)}.xmp`];
  }

  private async ensureGeneratedPhysicalFile(assetId: string, type: AssetFileType, path: string) {
    const existing = await this.physicalFileRepository.getCanonicalGeneratedFile(assetId, type);
    if (existing) {
      return existing;
    }

    const sizeInBytes = await this.getFileSize(path);
    if (sizeInBytes === 0) {
      return;
    }

    return this.physicalFileRepository.upsertPhysicalFile({
      canonicalAssetId: assetId,
      checksum: await this.cryptoRepository.hashFile(path),
      path,
      sizeInBytes,
      type: this.toPhysicalFileType(type),
    });
  }

  private async getFileSize(path: string) {
    try {
      const stats = await this.storageRepository.stat(path);
      return stats.size;
    } catch {
      return 0;
    }
  }

  private async queueDelete(path?: string) {
    if (path) {
      await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: [path] } });
    }
  }

  private addSample(summary: MigrationSummary, path: string) {
    if (summary.samples.length < 10) {
      summary.samples.push(path);
    }
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

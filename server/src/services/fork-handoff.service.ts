import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { DatabaseLock } from 'src/enum';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { OfficialHandoffCheckpoint, ReconciliationReport } from 'src/repositories/fork-handoff.repository';
import { DB } from 'src/schema';
import { ForkSchemaMigrationService } from 'src/services/fork-schema-migration.service';

export type ForkHandoffHooks = {
  beforeActivate?: (transaction: Kysely<DB>) => Promise<void> | void;
};

@Injectable()
export class ForkHandoffService {
  constructor(
    private readonly databaseRepository: DatabaseRepository,
    private readonly migrationService: ForkSchemaMigrationService,
  ) {}

  async prepareOfficial(): Promise<OfficialHandoffCheckpoint> {
    return this.databaseRepository.prepareOfficialHandoffCheckpoint();
  }

  async prepareFork(options: { batchSize: number }, hooks: ForkHandoffHooks = {}): Promise<ReconciliationReport> {
    if (!Number.isSafeInteger(options.batchSize) || options.batchSize <= 0) {
      throw new Error('Batch size must be a positive integer');
    }

    await this.databaseRepository.getReturnEvidence();
    // The certified official provider excludes the post-certified upstream
    // residue, so re-apply it before any fork-side reconciliation writes.
    await this.databaseRepository.reapplyPostCertifiedResidue();
    const workflowSnapshot = await this.databaseRepository.getReturnWorkflowSnapshot();
    const orphanArchive = await this.databaseRepository.archiveAndDeleteOrphans();
    await this.migrationService.reconcileAfterOfficialReturn(options.batchSize);
    return this.databaseRepository.withLock(DatabaseLock.Migrations, () =>
      this.databaseRepository.activateAfterReturnReconciliation(workflowSnapshot, orphanArchive, hooks.beforeActivate),
    );
  }
}

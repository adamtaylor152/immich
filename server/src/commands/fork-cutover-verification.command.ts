import { Command, CommandRunner, Option, SubCommand } from 'nest-commander';
import { ForkCutoverVerificationService } from 'src/services/fork-cutover-verification.service';

type CheckpointOptions = { databaseBackupId?: string; mediaSnapshotId?: string };
type ResumeOptions = CheckpointOptions & { batchSize?: number };

const checkpointIds = (options: CheckpointOptions): { databaseBackupId: string; mediaSnapshotId: string } => {
  const databaseBackupId = options.databaseBackupId?.trim() ?? '';
  const mediaSnapshotId = options.mediaSnapshotId?.trim() ?? '';
  if (!databaseBackupId) {
    throw new Error('Database backup ID is required');
  }
  if (!mediaSnapshotId) {
    throw new Error('Media snapshot ID is required');
  }
  return { databaseBackupId, mediaSnapshotId };
};

abstract class CheckpointCommand extends CommandRunner {
  @Option({ flags: '--database-backup-id <id>', description: 'Immutable database backup identifier' })
  parseDatabaseBackupId(value: string): string {
    return value;
  }

  @Option({ flags: '--media-snapshot-id <id>', description: 'Immutable media snapshot identifier' })
  parseMediaSnapshotId(value: string): string {
    return value;
  }
}

@SubCommand({ name: 'start', description: 'Start a byte-level storage verification checkpoint' })
export class ForkCutoverVerificationStartCommand extends CheckpointCommand {
  constructor(private verification: ForkCutoverVerificationService) {
    super();
  }

  async run(_passedParams: string[], options: CheckpointOptions = {}): Promise<void> {
    const ids = checkpointIds(options);
    console.log(JSON.stringify(await this.verification.start(ids.databaseBackupId, ids.mediaSnapshotId), null, 2));
  }
}

@SubCommand({ name: 'resume', description: 'Resume the latest matching storage verification checkpoint' })
export class ForkCutoverVerificationResumeCommand extends CheckpointCommand {
  constructor(private verification: ForkCutoverVerificationService) {
    super();
  }

  @Option({ flags: '--batch-size <count>', description: 'Number of assets to verify atomically', defaultValue: 100 })
  parseBatchSize(value: string): number {
    const batchSize = Number(value);
    if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
      throw new Error('Batch size must be a positive integer');
    }
    return batchSize;
  }

  async run(_passedParams: string[], options: ResumeOptions = {}): Promise<void> {
    const ids = checkpointIds(options);
    const batchSize = options.batchSize ?? 100;
    if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
      throw new Error('Batch size must be a positive integer');
    }
    console.log(
      JSON.stringify(
        await this.verification.resumeLatest(ids.databaseBackupId, ids.mediaSnapshotId, batchSize),
        null,
        2,
      ),
    );
  }
}

@SubCommand({ name: 'status', description: 'Show the latest matching storage verification checkpoint' })
export class ForkCutoverVerificationStatusCommand extends CheckpointCommand {
  constructor(private verification: ForkCutoverVerificationService) {
    super();
  }

  async run(_passedParams: string[], options: CheckpointOptions = {}): Promise<void> {
    const ids = checkpointIds(options);
    console.log(
      JSON.stringify(await this.verification.statusLatest(ids.databaseBackupId, ids.mediaSnapshotId), null, 2),
    );
  }
}

@Command({
  name: 'verify-storage',
  description: 'Verify current media bytes for immutable cutover checkpoints',
  subCommands: [
    ForkCutoverVerificationStartCommand,
    ForkCutoverVerificationResumeCommand,
    ForkCutoverVerificationStatusCommand,
  ],
})
export class ForkCutoverVerificationCommand extends CommandRunner {
  run(): Promise<void> {
    this.command.outputHelp();
    return Promise.resolve();
  }
}

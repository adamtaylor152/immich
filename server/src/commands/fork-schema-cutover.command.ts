import { Command, CommandRunner, Option, SubCommand } from 'nest-commander';
import { ForkCutoverVerificationCommand } from 'src/commands/fork-cutover-verification.command';
import { ForkSchemaCutoverService } from 'src/services/fork-schema-cutover.service';

type CheckpointOptions = { databaseBackupId?: string; mediaSnapshotId?: string };
type ApplyOptions = CheckpointOptions & { reportDigest?: string };

const checkpointIds = (options: CheckpointOptions) => {
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

abstract class ForkSchemaCheckpointCommand extends CommandRunner {
  @Option({ flags: '--database-backup-id <id>', description: 'Immutable database backup identifier' })
  parseDatabaseBackupId(value: string): string {
    return value;
  }

  @Option({ flags: '--media-snapshot-id <id>', description: 'Immutable media snapshot identifier' })
  parseMediaSnapshotId(value: string): string {
    return value;
  }
}

@SubCommand({ name: 'preflight', description: 'Read and verify the legacy fork ledger cutover evidence' })
export class ForkSchemaCutoverPreflightCommand extends ForkSchemaCheckpointCommand {
  constructor(private cutover: ForkSchemaCutoverService) {
    super();
  }

  async run(_passedParams: string[], options: CheckpointOptions = {}): Promise<void> {
    const ids = checkpointIds(options);
    console.log(JSON.stringify(await this.cutover.preflight(ids.databaseBackupId, ids.mediaSnapshotId), null, 2));
  }
}

@SubCommand({ name: 'apply', description: 'Apply a previously verified cutover report digest' })
export class ForkSchemaCutoverApplyCommand extends ForkSchemaCheckpointCommand {
  constructor(private cutover: ForkSchemaCutoverService) {
    super();
  }

  @Option({ flags: '--report-digest <sha256>', description: 'Exact preflight report digest' })
  parseReportDigest(value: string): string {
    return value;
  }

  async run(_passedParams: string[], options: ApplyOptions = {}): Promise<void> {
    const expectedReportDigest = options.reportDigest?.trim() ?? '';
    if (!expectedReportDigest) {
      throw new Error('Preflight report digest is required');
    }
    const ids = checkpointIds(options);
    console.log(
      JSON.stringify(
        await this.cutover.apply(expectedReportDigest, ids.databaseBackupId, ids.mediaSnapshotId),
        null,
        2,
      ),
    );
  }
}

@Command({
  name: 'fork-schema-cutover',
  description: 'Perform the locked legacy migration-ledger cutover',
  subCommands: [ForkSchemaCutoverPreflightCommand, ForkSchemaCutoverApplyCommand, ForkCutoverVerificationCommand],
})
export class ForkSchemaCutoverCommand extends CommandRunner {
  run(): Promise<void> {
    this.command.outputHelp();
    return Promise.resolve();
  }
}

export const forkSchemaCutoverCommands = ForkSchemaCutoverCommand.registerWithSubCommands();

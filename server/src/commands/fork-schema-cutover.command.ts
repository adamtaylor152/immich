import { Command, CommandRunner, Option, SubCommand } from 'nest-commander';
import { ForkCutoverVerificationCommand } from 'src/commands/fork-cutover-verification.command';
import { canonicalCutoverJson, ForkSchemaCutoverService } from 'src/services/fork-schema-cutover.service';

type CheckpointOptions = { databaseBackupId?: string; mediaSnapshotId?: string };
type ApplyOptions = CheckpointOptions & { reportDigest?: string };
type PreflightOptions = CheckpointOptions & { format?: string };

const checkpointIds = (options: CheckpointOptions) => {
  const { databaseBackupId, mediaSnapshotId } = options;
  if (!databaseBackupId?.trim()) {
    throw new Error('Database backup ID is required');
  }
  if (!mediaSnapshotId?.trim()) {
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

  @Option({ flags: '--format <format>', description: 'Output format: json or digest', defaultValue: 'json' })
  parseFormat(value: string): string {
    return value;
  }

  async run(passedParams: string[], options: PreflightOptions = {}): Promise<void> {
    if (passedParams.length > 0) {
      throw new Error('Preflight accepts named options only');
    }
    const format = options.format ?? 'json';
    if (format !== 'json' && format !== 'digest') {
      throw new Error('Format must be json or digest');
    }
    const ids = checkpointIds(options);
    const report = await this.cutover.preflight(ids);
    process.stdout.write(`${format === 'digest' ? report.digest : canonicalCutoverJson(report)}\n`);
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

  async run(passedParams: string[], options: ApplyOptions = {}): Promise<void> {
    if (passedParams.length > 0) {
      throw new Error('Apply accepts named options only');
    }
    const expectedReportDigest = options.reportDigest ?? '';
    if (!expectedReportDigest.trim()) {
      throw new Error('Preflight report digest is required');
    }
    if (!/^[\da-f]{64}$/.test(expectedReportDigest)) {
      throw new Error('Preflight report digest must be a lowercase SHA-256 digest');
    }
    const ids = checkpointIds(options);
    const checkpoint = await this.cutover.apply({ ...ids, reportDigest: expectedReportDigest });
    process.stdout.write(`${canonicalCutoverJson(checkpoint)}\n`);
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

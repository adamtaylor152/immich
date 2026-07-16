import { Command, CommandRunner, InquirerService, Option, Question, QuestionSet, SubCommand } from 'nest-commander';
import { ForkSchemaMigrationService, ForkSchemaMigrationStatus } from 'src/services/fork-schema-migration.service';

type BatchOptions = { batchSize?: number };
const DEFAULT_BATCH_SIZE = 250;

abstract class ForkSchemaBatchCommand extends CommandRunner {
  @Option({ flags: '--batch-size <count>', description: 'Number of rows to backfill atomically', defaultValue: 250 })
  parseBatchSize(value: string): number {
    const batchSize = Number(value);
    if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
      throw new Error('Batch size must be a positive integer');
    }
    return batchSize;
  }
}

export const formatForkSchemaStatus = (status: ForkSchemaMigrationStatus): string => {
  const lines = [
    `Phase: ${status.phase}`,
    `Active: ${status.active ? 'yes' : 'no'}`,
    `Schema version: ${status.schemaVersion}`,
    `Upstream version: ${status.upstreamVersion}`,
    `Verified: ${status.verified ? 'yes' : 'no'}`,
    'Backfills:',
  ];
  for (const item of status.progress) {
    lines.push(
      `  ${item.kind}: processed=${item.processed} remaining=${item.remaining} digest=${item.digest ?? 'none'} lastError=${item.lastError ?? 'none'}`,
    );
  }
  return lines.join('\n');
};

const printStatus = (status: ForkSchemaMigrationStatus): void => console.log(formatForkSchemaStatus(status));

@SubCommand({ name: 'status', description: 'Show fork schema migration status' })
export class ForkSchemaStatusCommand extends CommandRunner {
  constructor(private migration: ForkSchemaMigrationService) {
    super();
  }

  async run(): Promise<void> {
    printStatus(await this.migration.status());
  }
}

@SubCommand({ name: 'start', description: 'Start the compatibility backfill' })
export class ForkSchemaStartCommand extends ForkSchemaBatchCommand {
  constructor(
    private migration: ForkSchemaMigrationService,
    private inquirer: InquirerService,
  ) {
    super();
  }

  async run(_passedParams: string[] = [], options: BatchOptions = {}): Promise<void> {
    const { confirmed } = await this.inquirer.ask<{ confirmed: boolean }>('confirm-fork-schema-start', {});
    if (!confirmed) {
      console.log('Fork schema backfill was not started.');
      return;
    }
    printStatus(await this.migration.start(options.batchSize ?? DEFAULT_BATCH_SIZE));
  }
}

@SubCommand({ name: 'pause', description: 'Pause the compatibility backfill after active batches finish' })
export class ForkSchemaPauseCommand extends CommandRunner {
  constructor(private migration: ForkSchemaMigrationService) {
    super();
  }

  async run(): Promise<void> {
    printStatus(await this.migration.pause());
  }
}

@SubCommand({ name: 'resume', description: 'Resume the compatibility backfill' })
export class ForkSchemaResumeCommand extends ForkSchemaBatchCommand {
  constructor(private migration: ForkSchemaMigrationService) {
    super();
  }

  async run(_passedParams: string[] = [], options: BatchOptions = {}): Promise<void> {
    printStatus(await this.migration.resume(options.batchSize ?? DEFAULT_BATCH_SIZE));
  }
}

@SubCommand({ name: 'verify', description: 'Read and verify compatibility backfill progress without changing it' })
export class ForkSchemaVerifyCommand extends CommandRunner {
  constructor(private migration: ForkSchemaMigrationService) {
    super();
  }

  async run(): Promise<void> {
    printStatus(await this.migration.verify());
  }
}

@Command({
  name: 'fork-schema',
  description: 'Manage the fork schema compatibility backfill',
  subCommands: [
    ForkSchemaStatusCommand,
    ForkSchemaStartCommand,
    ForkSchemaPauseCommand,
    ForkSchemaResumeCommand,
    ForkSchemaVerifyCommand,
  ],
})
export class ForkSchemaCommand extends CommandRunner {
  run(): Promise<void> {
    this.command.outputHelp();
    return Promise.resolve();
  }
}

@QuestionSet({ name: 'confirm-fork-schema-start' })
export class ConfirmForkSchemaStartQuestion {
  @Question({
    type: 'confirm',
    name: 'confirmed',
    message: 'Start the fork schema backfill while legacy reads remain authoritative?',
    default: false,
  })
  confirmed(value: boolean): boolean {
    return value;
  }
}

export const forkSchemaCommands = ForkSchemaCommand.registerWithSubCommands();

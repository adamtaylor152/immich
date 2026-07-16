import { Command, CommandRunner, SubCommand } from 'nest-commander';
import { ForkSchemaCutoverService } from 'src/services/fork-schema-cutover.service';

@SubCommand({ name: 'preflight', description: 'Read and verify the legacy fork ledger cutover evidence' })
export class ForkSchemaCutoverPreflightCommand extends CommandRunner {
  constructor(private cutover: ForkSchemaCutoverService) {
    super();
  }

  async run(): Promise<void> {
    console.log(JSON.stringify(await this.cutover.preflight(), null, 2));
  }
}

@SubCommand({ name: 'apply', description: 'Apply a previously verified cutover report digest' })
export class ForkSchemaCutoverApplyCommand extends CommandRunner {
  constructor(private cutover: ForkSchemaCutoverService) {
    super();
  }

  async run(passedParams: string[]): Promise<void> {
    const [expectedReportDigest] = passedParams;
    if (!expectedReportDigest) {
      throw new Error('Usage: immich-admin fork-schema-cutover apply <preflight-report-digest>');
    }
    console.log(JSON.stringify(await this.cutover.apply(expectedReportDigest), null, 2));
  }
}

@Command({
  name: 'fork-schema-cutover',
  description: 'Perform the locked legacy migration-ledger cutover',
  subCommands: [ForkSchemaCutoverPreflightCommand, ForkSchemaCutoverApplyCommand],
})
export class ForkSchemaCutoverCommand extends CommandRunner {
  run(): Promise<void> {
    this.command.outputHelp();
    return Promise.resolve();
  }
}

export const forkSchemaCutoverCommands = ForkSchemaCutoverCommand.registerWithSubCommands();

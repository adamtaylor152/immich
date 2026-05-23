import { Command, CommandRunner, InquirerService, Option, Question, QuestionSet } from 'nest-commander';
import { CliService } from 'src/services/cli.service';

interface CommandOptions {
  yes?: boolean;
}

const WARNING = `
This will roll back every fork-only DB migration so this database can be served by
the upstream immich-app/immich image.

The following will be DROPPED and their data LOST:
  - physical_file table (physical-file deduplication graph)
  - asset_video_duplicate_frame table (video duplicate frame embeddings)
  - asset_health, asset_health_run, asset_health_candidate tables (media health history)
  - asset_best_photo_score table (best-photo scores)
  - smart_search_description table (VLM description embeddings)
  - asset.physicalOriginalFileId, asset_file.physicalFileId columns
  - idx_asset_exif_description_trigram (description trigram index)

PRESERVED (lives in upstream-owned tables):
  - All assets, originals, sidecars, faces, people, albums, partners, libraries
  - Asset descriptions, tags, OCR text, EXIF, smart-search embeddings
  - Users, sessions, sharing, activity, notifications, workflows/plugins

You should take a database backup BEFORE running this command.
After it completes, stop this container and start the upstream image.
`.trimStart();

@Command({
  name: 'schema-revert-to-upstream',
  description: 'Roll back fork-only DB migrations so this database can be used by the upstream immich-app server',
})
export class SchemaRevertToUpstreamCommand extends CommandRunner {
  constructor(
    private service: CliService,
    private inquirer: InquirerService,
  ) {
    super();
  }

  @Option({
    flags: '-y, --yes',
    description: 'Skip the interactive confirmation prompt (non-interactive use)',
  })
  parseYes(): boolean {
    return true;
  }

  async run(_passed: string[], options: CommandOptions = {}): Promise<void> {
    console.log(WARNING);

    if (!options.yes) {
      const { confirm } = await this.inquirer.ask<{ confirm: string }>('prompt-schema-revert', {});
      if (confirm !== 'revert') {
        console.log('Aborted — confirmation phrase was not "revert".');
        process.exitCode = 1;
        return;
      }
    }

    try {
      const { alreadyAtUpstream, reverted, workflowAliasInserted } = await this.service.revertSchemaToUpstream();

      if (alreadyAtUpstream) {
        console.log(
          'No fork migrations detected in kysely_migrations (1779400000000-UpdateWorkflowTables is not applied).',
        );
        console.log('This database appears to already be on the upstream schema. Nothing to do.');
        return;
      }

      if (reverted.length === 0) {
        console.log('No fork migrations were reverted (Kysely reported nothing to do).');
      } else {
        console.log(`Reverted ${reverted.length} fork migration${reverted.length === 1 ? '' : 's'}:`);
        for (const name of reverted) {
          console.log(`  - ${name}`);
        }
      }

      if (workflowAliasInserted) {
        console.log('Recorded upstream "1778614946174-UpdateWorkflowTables" as applied.');
      } else {
        console.log('Upstream "1778614946174-UpdateWorkflowTables" was already recorded — left alone.');
      }

      console.log(`
Schema revert complete. To finish downgrading to upstream:
  1. Stop this container (e.g. \`docker compose stop immich-server\`).
  2. In your docker-compose.yml, set:
       image: ghcr.io/immich-app/immich-server:release
     (or a specific upstream version).
  3. \`docker compose pull && docker compose up -d\`

If anything looks wrong, restore the database backup you took above.
`);
    } catch (error) {
      console.error(error);
      console.error('Schema revert failed. The database is in a partial state — restore from backup before retrying.');
      process.exitCode = 1;
    }
  }
}

@QuestionSet({ name: 'prompt-schema-revert' })
export class PromptSchemaRevertQuestions {
  @Question({
    message: 'Type "revert" to confirm: ',
    name: 'confirm',
  })
  parseConfirm(value: string) {
    return value;
  }
}

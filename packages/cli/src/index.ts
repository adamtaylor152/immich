#! /usr/bin/env node
import { Command, Option } from 'commander';
import os from 'node:os';
import path from 'node:path';
import { upload } from 'src/commands/asset';
import { login, logout } from 'src/commands/auth';
import { migrate } from 'src/commands/migrate';
import { serverInfo } from 'src/commands/server-info';
import { version } from '../package.json';

const defaultConfigDirectory = path.join(os.homedir(), '.config/immich/');
const defaultConcurrency = Math.max(1, os.cpus().length - 1);

const program = new Command()
  .name('immich')
  .version(version)
  .description('Command line interface for Immich')
  .addOption(
    new Option('-d, --config-directory <directory>', 'Configuration directory where auth.yml will be stored')
      .env('IMMICH_CONFIG_DIR')
      .default(defaultConfigDirectory),
  )
  .addOption(new Option('-u, --url [url]', 'Immich server URL').env('IMMICH_INSTANCE_URL'))
  .addOption(new Option('-k, --key [key]', 'Immich API key').env('IMMICH_API_KEY'));

program
  .command('login')
  .alias('login-key')
  .description('Login using an API key')
  .argument('url', 'Immich server URL')
  .argument('key', 'Immich API key')
  .action((url, key) => login(url, key, program.opts()));

program
  .command('logout')
  .description('Remove stored credentials')
  .action(() => logout(program.opts()));

program
  .command('server-info')
  .description('Display server information')
  .action(() => serverInfo(program.opts()));

program
  .command('upload')
  .description('Upload assets')
  .usage('[paths...] [options]')
  .addOption(new Option('-r, --recursive', 'Recursive').env('IMMICH_RECURSIVE').default(false))
  .addOption(new Option('-i, --ignore <pattern>', 'Pattern to ignore').env('IMMICH_IGNORE_PATHS'))
  .addOption(new Option('-h, --skip-hash', "Don't hash files before upload").env('IMMICH_SKIP_HASH').default(false))
  .addOption(new Option('-H, --include-hidden', 'Include hidden folders').env('IMMICH_INCLUDE_HIDDEN').default(false))
  .addOption(
    new Option('-a, --album', 'Automatically create albums based on folder name')
      .env('IMMICH_AUTO_CREATE_ALBUM')
      .default(false),
  )
  .addOption(
    new Option('-A, --album-name <name>', 'Add all assets to specified album')
      .env('IMMICH_ALBUM_NAME')
      .conflicts('album'),
  )
  .addOption(
    new Option('-n, --dry-run', "Don't perform any actions, just show what will be done")
      .env('IMMICH_DRY_RUN')
      .default(false)
      .conflicts('skipHash'),
  )
  .addOption(
    new Option('-c, --concurrency <number>', 'Number of assets to upload at the same time')
      .env('IMMICH_UPLOAD_CONCURRENCY')
      .default(defaultConcurrency),
  )
  .addOption(
    new Option('-j, --json-output', 'Output detailed information in json format')
      .env('IMMICH_JSON_OUTPUT')
      .default(false),
  )
  .addOption(new Option('--delete', 'Delete local assets after upload').env('IMMICH_DELETE_ASSETS'))
  .addOption(
    new Option('--delete-duplicates', 'Delete local assets that are duplicates (already exist on server)').env(
      'IMMICH_DELETE_DUPLICATES',
    ),
  )
  .addOption(new Option('--no-progress', 'Hide progress bars').env('IMMICH_PROGRESS_BAR').default(true))
  .addOption(
    new Option('--watch', 'Watch for changes and upload automatically')
      .env('IMMICH_WATCH_CHANGES')
      .default(false)
      .implies({ progress: false }),
  )
  .argument('[paths...]', 'One or more paths to assets to be uploaded')
  .action((paths, options) => upload(paths, program.opts(), options));

program
  .command('migrate')
  .description("Migrate a user's entire library from one Immich server to another (server-to-server)")
  .addOption(new Option('--from-url <url>', 'Source server URL (SERVER A)').env('IMMICH_FROM_URL'))
  .addOption(
    new Option('--from-key <key>', "Source server API key (the migrated user's own key)").env('IMMICH_FROM_KEY'),
  )
  .addOption(new Option('--to-url <url>', 'Destination server URL (SERVER B)').env('IMMICH_TO_URL'))
  .addOption(
    new Option('--to-key <key>', "Destination server API key (the migrated user's own key)").env('IMMICH_TO_KEY'),
  )
  .addOption(
    new Option('-l, --ledger <path>', 'Path to the resumable SQLite ledger/audit file')
      .env('IMMICH_MIGRATE_LEDGER')
      .default('./immich-migrate.sqlite'),
  )
  .addOption(
    new Option('-c, --concurrency <number>', 'Number of assets to transfer in parallel')
      .env('IMMICH_MIGRATE_CONCURRENCY')
      .default(defaultConcurrency),
  )
  .addOption(new Option('-n, --dry-run', 'Enumerate + dedup-check + audit preview only; no writes to B').default(false))
  .addOption(new Option('--include-trashed', 'Also migrate trashed assets').default(false))
  .addOption(new Option('--retry-failed', 'Requeue assets that errored on a previous run').default(false))
  .addOption(new Option('--no-faces', "Skip person/face migration (faces are best-effort and depend on B's ML)"))
  .addOption(new Option('--serve', 'Serve a local browser dashboard to monitor/control the run').default(false))
  .addOption(
    new Option('--port <number>', 'Port for the local dashboard (127.0.0.1)').env('IMMICH_MIGRATE_PORT').default(2285),
  )
  .action((options) => migrate(options));

program.parse(process.argv);

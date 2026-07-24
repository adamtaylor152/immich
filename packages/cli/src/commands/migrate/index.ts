import { Permission } from '@immich/sdk';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { migrateAlbums } from 'src/commands/migrate/albums';
import { audit, type AuditReport } from 'src/commands/migrate/audit';
import { ServerClient } from 'src/commands/migrate/client';
import { Controller } from 'src/commands/migrate/controller';
import { dedupe } from 'src/commands/migrate/dedupe';
import { enumerate } from 'src/commands/migrate/enumerate';
import { Ledger } from 'src/commands/migrate/ledger';
import { applyMetadata } from 'src/commands/migrate/metadata';
import { migratePeople } from 'src/commands/migrate/people';
import { startDashboard } from 'src/commands/migrate/server';
import { migrateStacks } from 'src/commands/migrate/stacks';
import { migrateTags } from 'src/commands/migrate/tags';
import { transfer } from 'src/commands/migrate/transfer';
import type { MigrateOptions, MigrateRawOptions } from 'src/commands/migrate/types';

const SOURCE_REQUIRED = [Permission.AssetRead, Permission.AssetDownload, Permission.AlbumRead, Permission.TagRead];
const SOURCE_OPTIONAL = [Permission.StackRead, Permission.PersonRead];
const DEST_REQUIRED = [
  Permission.AssetUpload,
  Permission.AssetUpdate,
  Permission.AlbumCreate,
  Permission.AlbumAssetCreate,
  Permission.TagCreate,
  Permission.TagAsset,
];
const DEST_OPTIONAL = [Permission.StackCreate, Permission.PersonCreate, Permission.PersonReassign];

const die = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const normalize = (raw: MigrateRawOptions): MigrateOptions => ({
  from: { url: raw.fromUrl || die('Missing --from-url'), key: raw.fromKey || die('Missing --from-key') },
  to: { url: raw.toUrl || die('Missing --to-url'), key: raw.toKey || die('Missing --to-key') },
  ledger: raw.ledger,
  concurrency: Math.max(1, Number(raw.concurrency) || 1),
  dryRun: !!raw.dryRun,
  includeTrashed: !!raw.includeTrashed,
  retryFailed: !!raw.retryFailed,
  faces: raw.faces !== false,
  serve: !!raw.serve,
  port: Number(raw.port) || 2285,
});

const checkPermissions = (permissions: Permission[], required: Permission[], optional: Permission[], label: string) => {
  if (permissions.includes(Permission.All)) {
    return;
  }
  const missingRequired = required.filter((p) => !permissions.includes(p));
  if (missingRequired.length > 0) {
    die(`${label} API key is missing required permissions: ${missingRequired.join(', ')}`);
  }
  const missingOptional = optional.filter((p) => !permissions.includes(p));
  if (missingOptional.length > 0) {
    console.warn(`Warning: ${label} API key lacks ${missingOptional.join(', ')} — related items will be skipped.`);
  }
};

const removePartials = async (dir: string) => {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  await Promise.all(entries.filter((f) => f.endsWith('.part')).map((f) => rm(join(dir, f), { force: true })));
};

async function runPipeline(
  from: ServerClient,
  to: ServerClient,
  ledger: Ledger,
  options: MigrateOptions,
  controller: Controller,
  tmpDir: string,
  auditPath: string,
  meta: { from: string; to: string; user: string },
): Promise<AuditReport | undefined> {
  controller.running = true;
  try {
    await enumerate(from, ledger, options, controller);
    if (controller.stopped) {
      return undefined;
    }
    await dedupe(to, ledger, controller);
    if (controller.stopped) {
      return undefined;
    }

    if (!options.dryRun) {
      await transferAndOrganize(from, to, ledger, options, controller, tmpDir);
      if (controller.stopped) {
        return undefined;
      }
    }

    return await audit(to, ledger, controller, auditPath, meta);
  } finally {
    controller.running = false;
  }
}

async function transferAndOrganize(
  from: ServerClient,
  to: ServerClient,
  ledger: Ledger,
  options: MigrateOptions,
  controller: Controller,
  tmpDir: string,
) {
  await transfer(from, to, ledger, options, controller, tmpDir);
  if (controller.stopped) {
    return;
  }
  await applyMetadata(from, to, ledger, options, controller);
  if (controller.stopped) {
    return;
  }
  await migrateTags(from, to, ledger, options, controller);
  if (controller.stopped) {
    return;
  }
  await migrateAlbums(from, to, ledger, options, controller);
  if (controller.stopped) {
    return;
  }
  await migrateStacks(to, ledger, controller);
  if (controller.stopped) {
    return;
  }
  await migratePeople(from, to, ledger, options, controller);
}

const printSummary = (report: AuditReport | undefined, ledgerPath: string, auditPath: string) => {
  if (!report) {
    console.log('\nStopped. State saved — re-run the same command to resume.');
    return;
  }
  const t = report.totals;
  console.log('\n──────── Migration summary ────────');
  console.log(`Assets:  ${t.uploaded}/${t.assets} on B   (${t.failed} failed, ${t.missing} missing)`);
  console.log(`Albums:  ${t.albumsLinked}/${t.albums}   Tags: ${t.tagsAssigned}/${t.tags}`);
  console.log(`Stacks:  ${t.stacksDone}/${t.stacks}   People: ${t.peopleDone}/${t.people}`);
  console.log(`Audit report: ${auditPath}`);
  console.log(`Ledger:       ${ledgerPath}`);
  if (report.ok) {
    console.log('\n✅ PASS — every asset is present on SERVER B. SERVER A is safe to decommission.');
  } else {
    console.log(
      `\n⚠️  INCOMPLETE — ${t.missing} asset(s) missing, ${t.failed} failed. Re-run to resume; see the audit report.`,
    );
  }
};

export async function migrate(raw: MigrateRawOptions) {
  try {
    await runMigrate(raw);
  } catch (error) {
    console.error(`\nMigration error: ${error instanceof Error ? error.message : String(error)}`);
    console.error('State is saved in the ledger — fix the issue and re-run to resume.');
    process.exit(1);
  }
}

async function runMigrate(raw: MigrateRawOptions) {
  const options = normalize(raw);

  console.log('Connecting to source and destination…');
  const [{ client: from, user: fromUser }, { client: to, user: toUser }] = await Promise.all([
    ServerClient.connect(options.from.url, options.from.key),
    ServerClient.connect(options.to.url, options.to.key),
  ]);

  const [fromKey, toKey] = await Promise.all([from.getMyApiKey(), to.getMyApiKey()]);
  checkPermissions(fromKey.permissions, SOURCE_REQUIRED, SOURCE_OPTIONAL, 'Source');
  checkPermissions(toKey.permissions, DEST_REQUIRED, DEST_OPTIONAL, 'Destination');
  if (fromUser.email !== toUser.email) {
    console.warn(
      `Warning: source user (${fromUser.email}) differs from destination user (${toUser.email}). ` +
        `All migrated content will be owned by ${toUser.email} on SERVER B.`,
    );
  }

  const ledger = new Ledger(options.ledger);
  const startedAt = new Date().toISOString();
  ledger.initRun({
    fromUrl: from.baseUrl,
    toUrl: to.baseUrl,
    userEmail: toUser.email,
    startedAt,
    dryRun: options.dryRun,
  });
  if (options.retryFailed) {
    ledger.clearErrors();
  }

  const tmpDir = `${options.ledger}.tmp`;
  const auditPath = `${options.ledger}.audit.json`;
  await mkdir(tmpDir, { recursive: true });
  await removePartials(tmpDir);

  const controller = new Controller();
  controller.startedAt = startedAt;
  const meta = { from: from.baseUrl, to: to.baseUrl, user: toUser.email };

  const priorCounts = ledger.counts();
  if (priorCounts.assetsUploaded > 0) {
    console.log(`Resuming: ${priorCounts.assetsUploaded}/${priorCounts.assetsTotal} assets already on B.`);
  }

  process.on('SIGINT', () => {
    console.log('\nStopping after the current items (state is saved; re-run to resume)…');
    controller.stop();
  });

  if (options.serve) {
    startDashboard(options.port, controller, ledger, meta, auditPath, options.dryRun);
    console.log(`Dashboard: http://127.0.0.1:${options.port}  (close the browser anytime; this process keeps running)`);
  }

  const report = await runPipeline(from, to, ledger, options, controller, tmpDir, auditPath, meta);
  printSummary(report, options.ledger, auditPath);

  if (options.serve && !controller.stopped) {
    controller.phase = 'done';
    console.log('\nDashboard still running for review. Press Ctrl+C to exit.');
    return; // keep the process alive via the HTTP server
  }

  ledger.close();
  process.exit(report && report.ok ? 0 : report ? 2 : 0);
}

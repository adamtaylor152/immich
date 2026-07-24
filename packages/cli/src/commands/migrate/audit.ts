import { AssetUploadAction } from '@immich/sdk';
import { chunk } from 'lodash-es';
import { writeFile } from 'node:fs/promises';
import type { ServerClient } from 'src/commands/migrate/client';
import type { Controller } from 'src/commands/migrate/controller';
import type { Ledger } from 'src/commands/migrate/ledger';

export interface AuditReport {
  generatedAt: string;
  from: string;
  to: string;
  user: string;
  ok: boolean;
  totals: Record<string, number>;
  missing: Array<{ aId: string; filename: string; reason: string }>;
}

/**
 * Phase 9: prove every source asset is present on B (verified by the SHA-256 B stores),
 * reconcile organizational counts, and write audit-report.json. `ok` is the green light to
 * decommission SERVER A: zero missing assets and zero unresolved failures.
 */
export async function audit(
  to: ServerClient,
  ledger: Ledger,
  controller: Controller,
  reportPath: string,
  meta: { from: string; to: string; user: string },
): Promise<AuditReport> {
  controller.setPhase('audit');
  const rows = ledger.auditRows();
  const missing: AuditReport['missing'] = [];

  // Anything never transferred is definitively missing.
  const verifiable = rows.filter((r) => r.uploaded && r.bChecksum);
  for (const row of rows) {
    if (!row.uploaded || !row.bChecksum) {
      missing.push({ aId: row.aId, filename: row.filename, reason: 'not-transferred' });
    }
  }

  // Defensively confirm transferred assets really exist on B, by the checksum B stores.
  let checked = 0;
  for (const part of chunk(verifiable, 5000)) {
    await controller.gate();
    if (controller.stopped) {
      break;
    }
    const res = await to.checkBulkUpload(part.map((r) => ({ id: r.aId, checksum: r.bChecksum! })));
    const present = new Set(
      res.results.filter((r) => r.action === AssetUploadAction.Reject).map((r) => r.id),
    );
    for (const row of part) {
      if (!present.has(row.aId)) {
        missing.push({ aId: row.aId, filename: row.filename, reason: 'absent-on-B' });
      }
    }
    checked += part.length;
    controller.log(`audited ${checked}/${verifiable.length}`);
  }

  const counts = ledger.counts();
  const report: AuditReport = {
    generatedAt: new Date().toISOString(),
    from: meta.from,
    to: meta.to,
    user: meta.user,
    ok: missing.length === 0 && counts.assetsFailed === 0,
    totals: {
      assets: counts.assetsTotal,
      uploaded: counts.assetsUploaded,
      missing: missing.length,
      failed: counts.assetsFailed,
      albums: counts.albumsTotal,
      albumsLinked: counts.albumsLinked,
      tags: counts.tagsTotal,
      tagsAssigned: counts.tagsAssigned,
      stacks: counts.stacksTotal,
      stacksDone: counts.stacksDone,
      people: counts.peopleTotal,
      peopleDone: counts.peopleDone,
    },
    missing,
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  return report;
}

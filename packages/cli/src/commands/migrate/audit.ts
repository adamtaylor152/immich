import { AssetUploadAction } from '@immich/sdk';
import { chunk } from 'lodash-es';
import { writeFile } from 'node:fs/promises';
import type { ServerClient } from 'src/commands/migrate/client';
import type { Controller } from 'src/commands/migrate/controller';
import type { Ledger } from 'src/commands/migrate/ledger';

const PAGE = 20_000;
const MAX_MISSING_DETAIL = 5000;

export interface AuditReport {
  generatedAt: string;
  from: string;
  to: string;
  user: string;
  /** False when the audit was interrupted before checking every asset. */
  complete: boolean;
  /** How many transferred assets were actually verified against the destination. */
  verified: number;
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
  const missing: AuditReport['missing'] = [];
  let missingCount = 0;
  // Keep the report readable (and bounded) if a run went badly wrong; the count stays exact.
  const record = (row: { aId: string; filename: string }, reason: string) => {
    missingCount++;
    if (missing.length < MAX_MISSING_DETAIL) {
      missing.push({ aId: row.aId, filename: row.filename, reason });
    }
  };

  let checked = 0;
  let isInterrupted = false;
  let after = '';
  pages: for (;;) {
    const page = ledger.auditRows(after, PAGE);
    if (page.length === 0) {
      break;
    }
    after = page.at(-1)!.aId;

    // Anything never transferred is definitively missing.
    const verifiable = page.filter((r) => r.uploaded && r.bChecksum);
    for (const row of page) {
      if (!row.uploaded || !row.bChecksum) {
        record(row, 'not-transferred');
      }
    }

    // Defensively confirm transferred assets really exist on B, by the checksum B stores.
    for (const part of chunk(verifiable, 5000)) {
      await controller.gate();
      if (controller.stopped) {
        // Bailing out leaves the remaining rows unverified. That must never be reported as
        // a clean audit, or a partially-checked run would read as "safe to decommission".
        isInterrupted = true;
        break pages;
      }
      const res = await to.checkBulkUpload(part.map((r) => ({ id: r.aId, checksum: r.bChecksum! })));
      const present = new Set(res.results.filter((r) => r.action === AssetUploadAction.Reject).map((r) => r.id));
      for (const row of part) {
        if (!present.has(row.aId)) {
          record(row, 'absent-on-B');
        }
      }
      checked += part.length;
      controller.log(`audited ${checked}`);
    }
  }

  const counts = ledger.counts();
  const report: AuditReport = {
    generatedAt: new Date().toISOString(),
    from: meta.from,
    to: meta.to,
    user: meta.user,
    complete: !isInterrupted,
    verified: checked,
    ok: !isInterrupted && missingCount === 0 && counts.assetsFailed === 0,
    totals: {
      assets: counts.assetsTotal,
      uploaded: counts.assetsUploaded,
      missing: missingCount,
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

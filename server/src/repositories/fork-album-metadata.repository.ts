import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { createHash } from 'node:crypto';
import { DB } from 'src/schema';

export type AlbumMetadataSidecar = {
  albumId: string;
  parentId: string | null;
  icon: string | null;
  sortOrder: number | null;
};

export type AlbumClosureSidecar = { ancestorId: string; descendantId: string };
export type AlbumBatchResult = { count: number; digest: string };

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
};

const digestRows = (metadata: AlbumMetadataSidecar[], closure: AlbumClosureSidecar[]) =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize({ closure, metadata })))
    .digest('hex');

@Injectable()
export class ForkAlbumMetadataRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  async backfillAlbums(ids: string[]): Promise<AlbumBatchResult> {
    return this.db.transaction().execute((trx) => this.backfill(ids, trx));
  }

  async mirrorFromLegacy(ids: string[], kysely: Kysely<DB> = this.db): Promise<void> {
    const phase = await this.getPhase(kysely);
    if (phase === 'legacy') {
      return;
    }
    await this.backfill(ids, kysely);
  }

  async applyReadMetadata<
    T extends { id: string; icon: string | null; parentId: string | null; sortOrder: number | null },
  >(rows: T[], kysely: Kysely<DB> = this.db): Promise<T[]> {
    if (rows.length === 0 || !(await this.shouldReadSidecar(kysely))) {
      return rows;
    }
    const metadata = await this.getMany(
      rows.map(({ id }) => id),
      kysely,
    );
    const byId = new Map(metadata.map((item) => [item.albumId, item]));
    return rows.map((row) => {
      const sidecar = byId.get(row.id);
      return sidecar ? { ...row, parentId: sidecar.parentId, icon: sidecar.icon, sortOrder: sidecar.sortOrder } : row;
    });
  }

  async shouldReadSidecar(kysely: Kysely<DB> = this.db): Promise<boolean> {
    const phase = await this.getPhase(kysely);
    return phase !== 'legacy' && phase !== 'dual-write';
  }

  private async backfill(ids: string[], kysely: Kysely<DB>): Promise<AlbumBatchResult> {
    if (ids.length === 0) {
      return { count: 0, digest: digestRows([], []) };
    }

    const legacy = await sql<AlbumMetadataSidecar>`
      SELECT
        id::text AS "albumId",
        "parentId"::text AS "parentId",
        icon,
        "sortOrder"
      FROM album
      WHERE id = ANY(${ids}::uuid[])
      ORDER BY id::text
    `.execute(kysely);
    const existingIds = legacy.rows.map(({ albumId }) => albumId);

    await sql`
      DELETE FROM immich_fork.album_metadata
      WHERE "albumId" = ANY(${ids}::uuid[])
        AND NOT ("albumId" = ANY(${existingIds}::uuid[]))
    `.execute(kysely);
    for (const row of legacy.rows) {
      await sql`
        INSERT INTO immich_fork.album_metadata ("albumId", "parentId", icon, "sortOrder")
        VALUES (${row.albumId}::uuid, ${row.parentId}::uuid, ${row.icon}, ${row.sortOrder})
        ON CONFLICT ("albumId") DO UPDATE
        SET
          "parentId" = EXCLUDED."parentId",
          icon = EXCLUDED.icon,
          "sortOrder" = EXCLUDED."sortOrder",
          "updatedAt" = now()
      `.execute(kysely);
    }

    await sql`
      DELETE FROM immich_fork.album_closure
      WHERE "descendantId" = ANY(${ids}::uuid[])
    `.execute(kysely);
    await sql`
      INSERT INTO immich_fork.album_closure ("ancestorId", "descendantId")
      SELECT id_ancestor, id_descendant
      FROM album_closure
      WHERE id_descendant = ANY(${existingIds}::uuid[])
      ON CONFLICT ("ancestorId", "descendantId") DO UPDATE
      SET "ancestorId" = EXCLUDED."ancestorId"
    `.execute(kysely);

    const metadata = await this.getMany(ids, kysely);
    const closure = await this.getClosure(ids, kysely);
    return { count: ids.length, digest: digestRows(metadata, closure) };
  }

  private async getMany(ids: string[], kysely: Kysely<DB>): Promise<AlbumMetadataSidecar[]> {
    const result = await sql<AlbumMetadataSidecar>`
      SELECT "albumId"::text AS "albumId", "parentId"::text AS "parentId", icon, "sortOrder"
      FROM immich_fork.album_metadata
      WHERE "albumId" = ANY(${ids}::uuid[])
      ORDER BY "albumId"::text
    `.execute(kysely);
    return result.rows;
  }

  private async getClosure(ids: string[], kysely: Kysely<DB>): Promise<AlbumClosureSidecar[]> {
    const result = await sql<AlbumClosureSidecar>`
      SELECT "ancestorId"::text AS "ancestorId", "descendantId"::text AS "descendantId"
      FROM immich_fork.album_closure
      WHERE "descendantId" = ANY(${ids}::uuid[])
      ORDER BY "descendantId"::text, "ancestorId"::text
    `.execute(kysely);
    return result.rows;
  }

  private async getPhase(kysely: Kysely<DB>): Promise<string> {
    const schema = await sql<{ stateTable: string | null }>`
      SELECT to_regclass('immich_fork.state')::text AS "stateTable"
    `.execute(kysely);
    if (!schema.rows[0]?.stateTable) {
      return 'legacy';
    }
    const result = await sql<{ phase: string }>`SELECT phase FROM immich_fork.state WHERE id = 1`.execute(kysely);
    return result.rows[0]?.phase ?? 'inactive';
  }
}

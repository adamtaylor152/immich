import { Kysely, sql } from 'kysely';
import { POST_CERTIFIED_UPSTREAM_MIGRATIONS } from 'src/fork-schema/migration-manifest';
import {
  up as applyConvertUserPasswordEmptyStringToNull,
  down as revertConvertUserPasswordEmptyStringToNull,
} from 'src/schema/migrations/1784986754473-ConvertUserPasswordEmptyStringToNull';
import {
  up as applyAlbumDescriptionNullable,
  down as revertAlbumDescriptionNullable,
} from 'src/schema/migrations/1784986754474-AlbumDescriptionNullable';
import {
  up as applyAlbumOwnerDeleteTrigger,
  down as revertAlbumOwnerDeleteTrigger,
} from 'src/schema/migrations/1786385711807-AlbumOwnerDeleteTrigger';
import {
  up as applyAddWorkflowLogsTable,
  down as revertAddWorkflowLogsTable,
} from 'src/schema/migrations/1786741078327-AddWorkflowLogsTable';
import {
  up as applyAssetOcrUpdatedAtTrigger,
  down as revertAssetOcrUpdatedAtTrigger,
} from 'src/schema/migrations/1786972746371-AssetOcrUpdatedAtTrigger';
import { up as applyAssetOcrSyncReset } from 'src/schema/migrations/1786972746372-AssetOcrSyncReset';
import {
  up as applyClusterGroups,
  down as revertClusterGroups,
} from 'src/schema/migrations/1787148183729-ClusterGroups';
import { up as applyDeleteMismatchedMemoryAssets } from 'src/schema/migrations/1787148183730-DeleteMismatchedMemoryAssets';

/**
 * Post-certified upstream migrations whose effects the certified official tag
 * (v3.1.0) cannot represent, together with their exact reversals. The fork
 * applies these on top of the certified schema; a cutover to the official
 * container must run the registered reversal and remove the ledger row so the
 * handed-off database is byte-compatible with the certified tag, and the fork
 * return re-applies them through the normal official migration provider.
 *
 * Per-migration decisions (documented; every entry must be exactly reversible):
 * - 1784986754473-ConvertUserPasswordEmptyStringToNull — relaxes
 *   `user.password` to nullable and converts `''` to NULL. The certified
 *   official reader treats `''` as "no password", so the reversal (NULL → `''`,
 *   restore NOT NULL + default) restores the exact certified semantics.
 * - 1784986754474-AlbumDescriptionNullable — relaxes `album.description` to
 *   nullable and converts `''` to NULL. The certified official writer uses `''`
 *   for "no description", so the reversal is likewise exact.
 *
 * Fail-closed: any ledgered post-certified migration WITHOUT a registered
 * reversal blocks cutover — silently stripping a ledger row whose schema or
 * data effects remain would corrupt the certified handoff.
 *
 * Every registered apply MUST be idempotent: the fork-return reconciliation
 * (and the medium-test cutover fixtures) re-run apply against a database that
 * may already carry the migration's effects, so an up() with non-idempotent
 * statements (bare INSERTs into migration_overrides, CREATE TABLE, column
 * renames) is wrapped with a schema-presence guard that skips the re-run.
 */
const skipWhenApplied =
  (isApplied: (db: Kysely<any>) => Promise<boolean>, apply: (db: Kysely<any>) => Promise<void>) =>
  async (db: Kysely<any>): Promise<void> => {
    if (!(await isApplied(db))) {
      await apply(db);
    }
  };

const relationExists = (relation: string) => async (db: Kysely<any>) => {
  const result = await sql<{ present: boolean }>`SELECT to_regclass(${relation}) IS NOT NULL AS present`.execute(db);
  return !!result.rows[0]?.present;
};

const overrideExists = (name: string) => async (db: Kysely<any>) => {
  const result = await sql<{
    present: boolean;
  }>`SELECT EXISTS (SELECT 1 FROM public.migration_overrides WHERE name = ${name}) AS present`.execute(db);
  return !!result.rows[0]?.present;
};

export const REVERSIBLE_POST_CERTIFIED_MIGRATIONS: ReadonlyMap<
  string,
  { apply: (db: Kysely<any>) => Promise<void>; revert: (db: Kysely<any>) => Promise<void> }
> = new Map([
  [
    '1784986754473-ConvertUserPasswordEmptyStringToNull',
    { apply: applyConvertUserPasswordEmptyStringToNull, revert: revertConvertUserPasswordEmptyStringToNull },
  ],
  [
    '1784986754474-AlbumDescriptionNullable',
    { apply: applyAlbumDescriptionNullable, revert: revertAlbumDescriptionNullable },
  ],
  [
    '1786385711807-AlbumOwnerDeleteTrigger',
    // up() also deletes albums that lost their last owner — a one-time cleanup
    // of rows the certified schema tolerates either way; the trigger/function
    // (the only schema effect) reverts exactly.
    {
      apply: skipWhenApplied(overrideExists('trigger_album_user_delete'), applyAlbumOwnerDeleteTrigger),
      revert: revertAlbumOwnerDeleteTrigger,
    },
  ],
  [
    '1786741078327-AddWorkflowLogsTable',
    // Reverting drops workflow_log rows, which cannot exist under the
    // certified tag; the fork return re-creates the table empty.
    {
      apply: skipWhenApplied(relationExists('public.workflow_log'), applyAddWorkflowLogsTable),
      revert: revertAddWorkflowLogsTable,
    },
  ],
  [
    '1786972746371-AssetOcrUpdatedAtTrigger',
    {
      apply: skipWhenApplied(overrideExists('trigger_asset_ocr_updatedAt'), applyAssetOcrUpdatedAtTrigger),
      revert: revertAssetOcrUpdatedAtTrigger,
    },
  ],
  [
    '1786972746372-AssetOcrSyncReset',
    // up() only deletes AssetOcrV1 sync checkpoints (no schema change); the
    // certified reader regenerates checkpoints on the next sync, so the exact
    // reversal is a no-op.
    { apply: applyAssetOcrSyncReset, revert: () => Promise.resolve() },
  ],
  [
    '1787148183729-ClusterGroups',
    // Upstream ships a full down() that restores person.id / asset_face.personId
    // and drops the cluster/person-group tables — the certified v3.1.0 shape.
    {
      apply: skipWhenApplied(relationExists('public.cluster_group'), applyClusterGroups),
      revert: revertClusterGroups,
    },
  ],
  [
    '1787148183730-DeleteMismatchedMemoryAssets',
    // up() deletes cross-owner memory_asset rows — invalid data the certified
    // reader must never see restored; the exact reversal is a no-op.
    { apply: applyDeleteMismatchedMemoryAssets, revert: () => Promise.resolve() },
  ],
]);

/** Names in the residue set that cutover cannot revert (must block cutover). */
export const irreversiblePostCertifiedMigrations = (names: Iterable<string>): string[] =>
  [...names].filter(
    (name) => POST_CERTIFIED_UPSTREAM_MIGRATIONS.has(name) && !REVERSIBLE_POST_CERTIFIED_MIGRATIONS.has(name),
  );

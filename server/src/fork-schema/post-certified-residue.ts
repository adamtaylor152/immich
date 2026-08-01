import { Kysely } from 'kysely';
import { POST_CERTIFIED_UPSTREAM_MIGRATIONS } from 'src/fork-schema/migration-manifest';
import {
  up as applyConvertUserPasswordEmptyStringToNull,
  down as revertConvertUserPasswordEmptyStringToNull,
} from 'src/schema/migrations/1784986754473-ConvertUserPasswordEmptyStringToNull';
import {
  up as applyAlbumDescriptionNullable,
  down as revertAlbumDescriptionNullable,
} from 'src/schema/migrations/1784986754474-AlbumDescriptionNullable';

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
 */
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
]);

/** Names in the residue set that cutover cannot revert (must block cutover). */
export const irreversiblePostCertifiedMigrations = (names: Iterable<string>): string[] =>
  [...names].filter(
    (name) => POST_CERTIFIED_UPSTREAM_MIGRATIONS.has(name) && !REVERSIBLE_POST_CERTIFIED_MIGRATIONS.has(name),
  );

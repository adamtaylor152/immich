import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM public.session_sync_checkpoint WHERE type IN (
    'AssetV2',
    'PartnerAssetV2',
    'PartnerAssetBackfillV2',
    'AlbumAssetCreateV2',
    'AlbumAssetUpdateV2',
    'AlbumAssetBackfillV2'
  )`.execute(db);
}

export async function down(): Promise<void> {
  // Not implemented
}

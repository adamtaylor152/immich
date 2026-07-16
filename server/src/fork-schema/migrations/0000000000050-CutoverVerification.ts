import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE immich_fork.cutover_verification_run (
      id uuid PRIMARY KEY,
      "databaseBackupId" text NOT NULL CHECK (btrim("databaseBackupId") <> ''),
      "snapshotId" text NOT NULL CHECK (btrim("snapshotId") <> ''),
      status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
      "applicableAssetCount" integer NOT NULL CHECK ("applicableAssetCount" >= 0),
      cursor uuid,
      "verifiedCount" integer NOT NULL DEFAULT 0 CHECK ("verifiedCount" >= 0),
      "failureCount" integer NOT NULL DEFAULT 0 CHECK ("failureCount" >= 0),
      "aggregateDigest" text CHECK ("aggregateDigest" IS NULL OR "aggregateDigest" ~ '^[0-9a-f]{64}$'),
      failure text,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "completedAt" timestamptz,
      CHECK ("verifiedCount" <= "applicableAssetCount")
    )
  `.execute(db);
  await sql`
    CREATE INDEX cutover_verification_checkpoint_idx
      ON immich_fork.cutover_verification_run ("databaseBackupId", "snapshotId", "completedAt" DESC)
  `.execute(db);

  await sql`
    CREATE TABLE immich_fork.cutover_verification_asset (
      "runId" uuid NOT NULL,
      "assetId" uuid NOT NULL,
      path text NOT NULL,
      "approvedRoots" text[] NOT NULL CHECK (cardinality("approvedRoots") > 0),
      "expectedSize" bigint NOT NULL CHECK ("expectedSize" >= 0),
      "expectedSha1" bytea NOT NULL CHECK (octet_length("expectedSha1") = 20),
      "expectedSha256" bytea NOT NULL CHECK (octet_length("expectedSha256") = 32),
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified')),
      size bigint,
      sha1 text CHECK (sha1 IS NULL OR sha1 ~ '^[0-9a-f]{40}$'),
      sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
      device bigint,
      inode bigint,
      links integer CHECK (links IS NULL OR links > 0),
      "verifiedAt" timestamptz,
      PRIMARY KEY ("runId", "assetId"),
      FOREIGN KEY ("runId") REFERENCES immich_fork.cutover_verification_run(id) ON DELETE CASCADE,
      CHECK (
        (status = 'pending' AND size IS NULL AND sha1 IS NULL AND sha256 IS NULL AND device IS NULL AND inode IS NULL AND links IS NULL AND "verifiedAt" IS NULL)
        OR
        (status = 'verified' AND size IS NOT NULL AND sha1 IS NOT NULL AND sha256 IS NOT NULL AND device IS NOT NULL AND inode IS NOT NULL AND links IS NOT NULL AND "verifiedAt" IS NOT NULL)
      )
    )
  `.execute(db);
  await sql`
    CREATE INDEX cutover_verification_asset_cursor_idx
      ON immich_fork.cutover_verification_asset ("runId", status, "assetId")
  `.execute(db);

  await sql`
    CREATE FUNCTION immich_fork.prevent_cutover_verification_identity_change()
    RETURNS trigger LANGUAGE plpgsql AS $function$
    BEGIN
      IF TG_TABLE_NAME = 'cutover_verification_run' AND
         jsonb_build_array(to_jsonb(NEW)->'id', to_jsonb(NEW)->'databaseBackupId', to_jsonb(NEW)->'snapshotId',
           to_jsonb(NEW)->'applicableAssetCount', to_jsonb(NEW)->'createdAt')
         IS DISTINCT FROM
         jsonb_build_array(to_jsonb(OLD)->'id', to_jsonb(OLD)->'databaseBackupId', to_jsonb(OLD)->'snapshotId',
           to_jsonb(OLD)->'applicableAssetCount', to_jsonb(OLD)->'createdAt') THEN
        RAISE EXCEPTION 'cutover verification run identity is immutable';
      END IF;
      IF TG_TABLE_NAME = 'cutover_verification_run' AND OLD.status = 'completed' AND
         to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
        RAISE EXCEPTION 'completed cutover verification run evidence is immutable';
      END IF;
      IF TG_TABLE_NAME = 'cutover_verification_asset' AND
         jsonb_build_array(to_jsonb(NEW)->'runId', to_jsonb(NEW)->'assetId', to_jsonb(NEW)->'path',
           to_jsonb(NEW)->'approvedRoots', to_jsonb(NEW)->'expectedSize', to_jsonb(NEW)->'expectedSha1',
           to_jsonb(NEW)->'expectedSha256')
         IS DISTINCT FROM
         jsonb_build_array(to_jsonb(OLD)->'runId', to_jsonb(OLD)->'assetId', to_jsonb(OLD)->'path',
           to_jsonb(OLD)->'approvedRoots', to_jsonb(OLD)->'expectedSize', to_jsonb(OLD)->'expectedSha1',
           to_jsonb(OLD)->'expectedSha256') THEN
        RAISE EXCEPTION 'cutover verification asset identity is immutable';
      END IF;
      IF TG_TABLE_NAME = 'cutover_verification_asset' AND OLD.status = 'verified' AND
         to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
        RAISE EXCEPTION 'completed cutover verification asset evidence is immutable';
      END IF;
      RETURN NEW;
    END
    $function$
  `.execute(db);
  await sql`
    CREATE TRIGGER cutover_verification_run_identity_immutable
    BEFORE UPDATE ON immich_fork.cutover_verification_run
    FOR EACH ROW EXECUTE FUNCTION immich_fork.prevent_cutover_verification_identity_change()
  `.execute(db);
  await sql`
    CREATE TRIGGER cutover_verification_asset_identity_immutable
    BEFORE UPDATE ON immich_fork.cutover_verification_asset
    FOR EACH ROW EXECUTE FUNCTION immich_fork.prevent_cutover_verification_identity_change()
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS immich_fork.cutover_verification_asset`.execute(db);
  await sql`DROP TABLE IF EXISTS immich_fork.cutover_verification_run`.execute(db);
  await sql`DROP FUNCTION IF EXISTS immich_fork.prevent_cutover_verification_identity_change()`.execute(db);
}

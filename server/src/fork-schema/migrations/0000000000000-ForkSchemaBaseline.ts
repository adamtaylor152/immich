import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS immich_fork`.execute(db);

  await sql`
    CREATE TABLE immich_fork.state (
      id smallint PRIMARY KEY CHECK (id = 1),
      active boolean NOT NULL DEFAULT false,
      "schemaVersion" varchar(64) NOT NULL,
      "upstreamVersion" varchar(64) NOT NULL,
      phase varchar(32) NOT NULL,
      "checkpointStartedAt" timestamptz,
      "checkpointCompletedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE TABLE immich_fork.migration_audit (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name varchar(255) NOT NULL,
      phase varchar(32) NOT NULL,
      status varchar(32) NOT NULL,
      details jsonb,
      "startedAt" timestamptz NOT NULL DEFAULT now(),
      "completedAt" timestamptz
    )
  `.execute(db);

  await sql`
    CREATE TABLE immich_fork.backfill_progress (
      kind varchar(32) PRIMARY KEY,
      cursor text,
      processed bigint NOT NULL DEFAULT 0,
      remaining bigint NOT NULL DEFAULT 0,
      digest text,
      "lastError" text,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    INSERT INTO immich_fork.state (id, active, "schemaVersion", "upstreamVersion", phase)
    VALUES (1, false, '1', '3.0.3', 'inactive')
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS immich_fork.backfill_progress`.execute(db);
  await sql`DROP TABLE IF EXISTS immich_fork.migration_audit`.execute(db);
  await sql`DROP TABLE IF EXISTS immich_fork.state`.execute(db);
}

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "person" ADD "groupId" uuid NOT NULL DEFAULT uuid_generate_v4();`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "person" DROP COLUMN "groupId";`.execute(db);
}

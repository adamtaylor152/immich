import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TYPE "sharing_permission_enum" ADD VALUE 'person.update';`.execute(db);
  await sql`ALTER TYPE "sharing_permission_enum" ADD VALUE 'person.delete';`.execute(db);
}

export async function down(): Promise<void> {
}

import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import _ from 'lodash';
import { InjectKysely } from 'nestjs-kysely';
import { createHash } from 'node:crypto';
import { SystemConfig } from 'src/config';
import { SystemConfigSchema } from 'src/dtos/system-config.dto';
import { isForkAuthoritative } from 'src/fork-schema/authority';
import type { ForkSchemaPhase } from 'src/repositories/fork-schema.repository';
import { DB } from 'src/schema';

const canonicalize = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map((item) => canonicalize(item))
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonicalize(item)]),
        )
      : value;
const digest = (rows: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(rows)))
    .digest('hex');

@Injectable()
export class ForkConfigRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  async backfillConfig(
    effectiveConfig: SystemConfig,
    source: 'database' | 'file',
  ): Promise<{ count: number; digest: string }> {
    return this.db.transaction().execute(async (trx) => {
      let config: SystemConfig = _.cloneDeep(effectiveConfig);
      if (source === 'database') {
        const legacy = await sql<{
          value: Record<string, any> | null;
        }>`SELECT value FROM system_metadata WHERE key = 'system-config' FOR UPDATE`.execute(trx);
        const snapshot = legacy.rows[0]?.value ?? {};
        config = _.mergeWith(config, snapshot, (_target, source) =>
          Array.isArray(source) ? _.cloneDeep(source) : undefined,
        );
      }
      const validated = SystemConfigSchema.safeParse(config);
      if (!validated.success) {
        throw new Error(`Invalid effective configuration during fork backfill: ${validated.error.message}`);
      }
      config = validated.data;
      const values = [
        { key: 'machineLearning.runpod', value: config.machineLearning?.runpod ?? {} },
        { key: 'smartAlbums', value: config.smartAlbums ?? {} },
      ];
      for (const row of values) {
        await this.set(row.key, row.value, trx, true);
      }
      return { count: values.length, digest: digest(values) };
    });
  }

  async mirrorConfig(config: Record<string, any>, kysely: Kysely<DB> = this.db): Promise<void> {
    if ((await this.getPhase(kysely)) === 'legacy') {
      return;
    }
    await this.set('machineLearning.runpod', config.machineLearning?.runpod ?? {}, kysely, true);
    await this.set('smartAlbums', config.smartAlbums ?? {}, kysely, true);
  }

  async get(key: string, kysely: Kysely<DB> = this.db): Promise<unknown> {
    const result = await sql<{ value: unknown }>`SELECT value FROM immich_fork.config WHERE key = ${key}`.execute(
      kysely,
    );
    return result.rows[0]?.value;
  }

  async shouldReadSidecar(kysely: Kysely<DB> = this.db): Promise<boolean> {
    const phase = await this.getPhase(kysely);
    return isForkAuthoritative(phase);
  }

  private async set(key: string, value: unknown, kysely: Kysely<DB>, force: boolean) {
    if (!force && (await this.getPhase(kysely)) === 'legacy') {
      return;
    }
    await sql`INSERT INTO immich_fork.config (key, value) VALUES (${key}, ${value}::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`.execute(kysely);
  }

  private async getPhase(kysely: Kysely<DB>): Promise<ForkSchemaPhase> {
    const exists = await sql<{ table: string | null }>`SELECT to_regclass('immich_fork.state')::text AS table`.execute(
      kysely,
    );
    if (!exists.rows[0]?.table) {
      return 'legacy';
    }
    const result = await sql<{ phase: ForkSchemaPhase }>`SELECT phase FROM immich_fork.state WHERE id = 1`.execute(
      kysely,
    );
    return result.rows[0]?.phase ?? 'inactive';
  }
}

import { Kysely, sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PluginRepository } from 'src/repositories/plugin.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

const setup = (database: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database,
    real: [PluginRepository],
    mock: [LoggingRepository],
  });
  return ctx.get(PluginRepository);
};

const seedPlugin = async (database: Kysely<DB>, allowedHostsColumn: boolean) => {
  const pluginId = randomUUID();
  const methodId = randomUUID();
  await sql`
    INSERT INTO public.plugin
      (id, enabled, name, version, title, description, author, "wasmBytes")
    VALUES (${pluginId}::uuid, true, ${`plugin-${pluginId}`}, '1.0.0', 'Plugin', 'Fixture', 'Immich', decode('00', 'hex'))
  `.execute(database);
  const insertMethod = allowedHostsColumn
    ? sql`
      INSERT INTO public.plugin_method
        (id, "pluginId", name, title, description, types, "hostFunctions", "allowedHosts", "uiHints", schema)
      VALUES (${methodId}::uuid, ${pluginId}::uuid, 'webhook', 'Webhook', 'Fixture', ARRAY['AssetV1']::varchar[],
        true, ARRAY['hooks.example.test']::varchar[], ARRAY[]::varchar[], NULL)
    `
    : sql`
      INSERT INTO public.plugin_method
        (id, "pluginId", name, title, description, types, "hostFunctions", "uiHints", schema)
      VALUES (${methodId}::uuid, ${pluginId}::uuid, 'webhook', 'Webhook', 'Fixture', ARRAY['AssetV1']::varchar[],
        true, ARRAY[]::varchar[], NULL)
    `;
  await insertMethod.execute(database);
  return { methodId, pluginId };
};

describe(PluginRepository.name, () => {
  it('returns an empty allowedHosts list from plugin and method searches on the legacy schema', async () => {
    const database = await getKyselyDB();
    const sut = setup(database);
    const { methodId, pluginId } = await seedPlugin(database, false);

    const plugins = await sut.search({ id: pluginId });
    const methods = await sut.searchMethods({ id: methodId });

    expect(plugins[0]?.methods[0]).toEqual(expect.objectContaining({ allowedHosts: [] }));
    expect(methods[0]).toEqual(expect.objectContaining({ allowedHosts: [] }));
  });

  it('returns official allowedHosts from plugin and method searches after the upstream migration', async () => {
    const database = await getKyselyDB();
    await sql`
      ALTER TABLE public.plugin_method
      ADD COLUMN "allowedHosts" varchar[] NOT NULL DEFAULT '{}'
    `.execute(database);
    const sut = setup(database);
    const { methodId, pluginId } = await seedPlugin(database, true);

    const plugins = await sut.search({ id: pluginId });
    const methods = await sut.searchMethods({ id: methodId });

    expect(plugins[0]?.methods[0]).toEqual(expect.objectContaining({ allowedHosts: ['hooks.example.test'] }));
    expect(methods[0]).toEqual(expect.objectContaining({ allowedHosts: ['hooks.example.test'] }));
  });
});

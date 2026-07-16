import { PluginRepository } from 'src/repositories/plugin.repository';
import { vitest } from 'vitest';

describe(PluginRepository.name, () => {
  it.each(['plugin-id', 'plugin-id/worker'])(
    'passes host context through the %s Extism boundary',
    async (pluginKey) => {
      const plugin = {
        call: vitest.fn().mockResolvedValue({ json: () => ({ ok: true }) }),
      };
      const pool = {
        acquire: vitest.fn().mockResolvedValue(plugin),
        release: vitest.fn(),
      };
      const logger = { setContext: vitest.fn() };
      const sut = new PluginRepository({} as never, logger as never);
      (sut as unknown as { pluginMap: Map<string, unknown> }).pluginMap.set(pluginKey, { label: pluginKey, pool });
      const context = { allowedHosts: ['hooks.example.test'] };

      await (sut.callMethod as unknown as (...args: unknown[]) => Promise<unknown>)(
        { pluginKey, methodName: 'webhook' },
        { event: 'asset.create' },
        context,
      );

      expect(plugin.call).toHaveBeenCalledWith('webhook', JSON.stringify({ event: 'asset.create' }), context);
      expect(pool.release).toHaveBeenCalledWith(plugin);
    },
  );
});

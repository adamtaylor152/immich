import { AppRepository } from 'src/repositories/app.repository';
import { beforeEach, describe, expect, it, vitest } from 'vitest';

const mocks = vitest.hoisted(() => {
  const pubClient = {
    connect: vitest.fn(),
    disconnect: vitest.fn(),
    duplicate: vitest.fn(),
  };
  const subClient = {
    connect: vitest.fn(),
    disconnect: vitest.fn(),
  };
  const server = {
    adapter: vitest.fn(),
    emit: vitest.fn(),
    serverSideEmitWithAck: vitest.fn(),
    sockets: { adapter: { close: vitest.fn() } },
  };
  return { pubClient, server, subClient };
});

vitest.mock('@socket.io/redis-adapter', () => ({ createAdapter: vitest.fn(() => 'redis-adapter') }));
vitest.mock('ioredis', () => ({ default: vitest.fn(() => mocks.pubClient) }));
vitest.mock('socket.io', () => ({ Server: vitest.fn(() => mocks.server) }));
vitest.mock('src/repositories/config.repository', () => ({
  ConfigRepository: vitest.fn(() => ({ getEnv: () => ({ redis: {} }) })),
}));

describe(AppRepository.name, () => {
  beforeEach(() => {
    vitest.resetAllMocks();
    mocks.pubClient.duplicate.mockReturnValue(mocks.subClient);
    mocks.pubClient.connect.mockImplementation(() => Promise.resolve());
    mocks.subClient.connect.mockImplementation(() => Promise.resolve());
    mocks.server.sockets.adapter.close.mockImplementation(() => Promise.resolve());
  });

  it('waits for the server-side restart acknowledgement before resolving', async () => {
    let clientAcknowledgement: (() => Promise<void>) | undefined;
    mocks.server.emit.mockImplementation((_event, _state, callback) => {
      clientAcknowledgement = callback;
    });
    mocks.server.serverSideEmitWithAck.mockResolvedValue(['ok']);
    const sut = new AppRepository();
    let settled = false;

    const restart = sut.sendOneShotAppRestart({ isMaintenanceMode: false }).finally(() => (settled = true));
    await vitest.waitFor(() => expect(clientAcknowledgement).toBeDefined());
    expect(settled).toBe(false);

    await clientAcknowledgement!();
    await restart;

    expect(mocks.server.serverSideEmitWithAck).toHaveBeenCalledWith('AppRestart', { isMaintenanceMode: false });
    expect(mocks.server.sockets.adapter.close).toHaveBeenCalledOnce();
    expect(mocks.pubClient.disconnect).toHaveBeenCalledOnce();
    expect(mocks.subClient.disconnect).toHaveBeenCalledOnce();
  });

  it('rejects a non-ok server acknowledgement and closes every resource', async () => {
    mocks.server.emit.mockImplementation((_event, _state, callback) => void callback());
    mocks.server.serverSideEmitWithAck.mockResolvedValue(['not-ok']);
    const sut = new AppRepository();

    await expect(sut.sendOneShotAppRestart({ isMaintenanceMode: true })).rejects.toThrow("non-'ok'");

    expect(mocks.server.sockets.adapter.close).toHaveBeenCalledOnce();
    expect(mocks.pubClient.disconnect).toHaveBeenCalledOnce();
    expect(mocks.subClient.disconnect).toHaveBeenCalledOnce();
  });

  it('rejects an acknowledgement failure and closes every resource', async () => {
    mocks.server.emit.mockImplementation((_event, _state, callback) => void callback());
    mocks.server.serverSideEmitWithAck.mockRejectedValue(new Error('ack failed'));
    const sut = new AppRepository();

    await expect(sut.sendOneShotAppRestart({ isMaintenanceMode: true })).rejects.toThrow('ack failed');

    expect(mocks.server.sockets.adapter.close).toHaveBeenCalledOnce();
    expect(mocks.pubClient.disconnect).toHaveBeenCalledOnce();
    expect(mocks.subClient.disconnect).toHaveBeenCalledOnce();
  });
});

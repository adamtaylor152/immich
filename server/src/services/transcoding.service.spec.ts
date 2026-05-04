import { HLS_CLEANUP_INTERVAL_MS, HLS_INACTIVITY_TIMEOUT_MS, HLS_LEASE_DURATION_MS } from 'src/constants';
import { TranscodingService } from 'src/services/transcoding.service';
import { VIDEO_STREAM_SESSION_PK_CONSTRAINT } from 'src/utils/database';
import { eiffelTower } from 'test/fixtures/media.stub';
import { mockSpawn, newTestService, ServiceMocks } from 'test/utils';
import { vi } from 'vitest';

describe(TranscodingService.name, () => {
  let sut: TranscodingService;
  let mocks: ServiceMocks;

  const sessionId = 'session-1';
  const assetId = 'asset-1';
  const ownerId = 'user-1';

  beforeEach(() => {
    ({ sut, mocks } = newTestService(TranscodingService));
    mocks.systemMetadata.get.mockResolvedValue({ ffmpeg: { realtime: { enabled: true } } });
    mocks.videoStream.getForTranscoding.mockResolvedValue(eiffelTower);
  });

  describe('onSessionRequest', () => {
    it('creates the session row and emits HlsSessionResult on success', async () => {
      await sut.onSessionRequest({ sessionId, assetId, ownerId });

      expect(mocks.videoStream.createSession).toHaveBeenCalledWith({
        id: sessionId,
        assetId,
        expiresAt: expect.any(Date),
      });
      expect(mocks.websocket.serverSend).toHaveBeenCalledWith('HlsSessionResult', { sessionId });
    });

    it('treats a primary-key conflict as a no-op for replay tolerance', async () => {
      mocks.videoStream.createSession.mockRejectedValue({ constraint_name: VIDEO_STREAM_SESSION_PK_CONSTRAINT });

      await sut.onSessionRequest({ sessionId, assetId, ownerId });

      expect(mocks.websocket.serverSend).not.toHaveBeenCalled();
    });

    it('emits HlsSessionResult with an error on other DB failures', async () => {
      mocks.videoStream.createSession.mockRejectedValue(new Error('database is down'));

      await sut.onSessionRequest({ sessionId, assetId, ownerId });

      expect(mocks.websocket.serverSend).toHaveBeenCalledWith('HlsSessionResult', {
        sessionId,
        error: 'Failed to create HLS session',
      });
    });
  });

  describe('onSessionEnd', () => {
    it('removes the session, kills the transcode, and deletes the dir + DB row', async () => {
      await sut.onSessionRequest({ sessionId, assetId, ownerId });
      const process = mockSpawn(0, '', '');
      mocks.process.spawn.mockReturnValue(process);
      await sut.onSegmentRequest({ sessionId, assetId, variantIndex: 0, segmentIndex: 0 });

      await sut.onSessionEnd({ sessionId });

      expect(process.kill).toHaveBeenCalled();
      expect(mocks.storage.unlinkDir).toHaveBeenCalled();
      expect(mocks.videoStream.deleteSession).toHaveBeenCalledWith(sessionId);
    });

    it('is a no-op when the session is unknown', async () => {
      await sut.onSessionEnd({ sessionId: 'never-created' });

      expect(mocks.videoStream.deleteSession).not.toHaveBeenCalled();
      expect(mocks.storage.unlinkDir).not.toHaveBeenCalled();
    });
  });

  describe('onHeartbeat', () => {
    it('extends the DB lease when remaining time falls below half', async () => {
      vi.useFakeTimers();
      try {
        await sut.onSessionRequest({ sessionId, assetId, ownerId });
        vi.setSystemTime(Date.now() + HLS_LEASE_DURATION_MS / 2 + 1);

        await sut.onHeartbeat({ sessionId });

        expect(mocks.videoStream.extendSession).toHaveBeenCalledWith(sessionId, expect.any(Date));
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not extend the lease while it is still fresh', async () => {
      await sut.onSessionRequest({ sessionId, assetId, ownerId });

      await sut.onHeartbeat({ sessionId });

      expect(mocks.videoStream.extendSession).not.toHaveBeenCalled();
    });

    it('is a no-op when the session is unknown', async () => {
      await sut.onHeartbeat({ sessionId: 'never-created' });

      expect(mocks.videoStream.extendSession).not.toHaveBeenCalled();
    });
  });

  describe('onSegmentRequest', () => {
    beforeEach(async () => {
      await sut.onSessionRequest({ sessionId, assetId, ownerId });
      mocks.websocket.serverSend.mockClear();
    });

    it('spawns FFmpeg on the first request', async () => {
      mocks.process.spawn.mockReturnValue(mockSpawn(0, '', ''));

      await sut.onSegmentRequest({ sessionId, assetId, variantIndex: 0, segmentIndex: 0 });

      expect(mocks.process.spawn).toHaveBeenCalledTimes(1);
      expect(mocks.process.spawn).toHaveBeenCalledWith('ffmpeg', expect.any(Array), expect.any(Object));
    });

    it('kills and respawns when the variant changes', async () => {
      const first = mockSpawn(0, '', '');
      const second = mockSpawn(0, '', '');
      mocks.process.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);

      await sut.onSegmentRequest({ sessionId, assetId, variantIndex: 0, segmentIndex: 0 });
      await sut.onSegmentRequest({ sessionId, assetId, variantIndex: 1, segmentIndex: 0 });

      expect(first.kill).toHaveBeenCalled();
      expect(mocks.process.spawn).toHaveBeenCalledTimes(2);
    });

    it('kills and respawns when seeking before the start segment', async () => {
      const first = mockSpawn(0, '', '');
      const second = mockSpawn(0, '', '');
      mocks.process.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);

      await sut.onSegmentRequest({ sessionId, assetId, variantIndex: 0, segmentIndex: 5 });
      await sut.onSegmentRequest({ sessionId, assetId, variantIndex: 0, segmentIndex: 2 });

      expect(first.kill).toHaveBeenCalled();
      expect(mocks.process.spawn).toHaveBeenCalledTimes(2);
    });

    it('kills and respawns when the requested segment is too far ahead', async () => {
      const first = mockSpawn(0, '', '');
      const second = mockSpawn(0, '', '');
      mocks.process.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);

      await sut.onSegmentRequest({ sessionId, assetId, variantIndex: 0, segmentIndex: 0 });
      await sut.onSegmentRequest({ sessionId, assetId, variantIndex: 0, segmentIndex: 5 });

      expect(first.kill).toHaveBeenCalled();
      expect(mocks.process.spawn).toHaveBeenCalledTimes(2);
    });

    it('does not spawn when the session is unknown', async () => {
      await sut.onSegmentRequest({ sessionId: 'never-created', assetId, variantIndex: 0, segmentIndex: 0 });

      expect(mocks.process.spawn).not.toHaveBeenCalled();
    });
  });

  describe('inactivity sweeper', () => {
    it('reaps a session whose last activity exceeds the inactivity timeout', async () => {
      vi.useFakeTimers();
      try {
        await sut.onSessionRequest({ sessionId, assetId, ownerId });
        mocks.websocket.serverSend.mockClear();
        await vi.advanceTimersByTimeAsync(HLS_INACTIVITY_TIMEOUT_MS + HLS_CLEANUP_INTERVAL_MS);

        expect(mocks.websocket.serverSend).toHaveBeenCalledWith('HlsSessionEnd', { sessionId });
        expect(mocks.videoStream.deleteSession).toHaveBeenCalledWith(sessionId);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('onShutdown', () => {
    it('ends every active session', async () => {
      await sut.onSessionRequest({ sessionId: 'session-a', assetId, ownerId });
      await sut.onSessionRequest({ sessionId: 'session-b', assetId, ownerId });

      await sut.onShutdown();

      expect(mocks.videoStream.deleteSession).toHaveBeenCalledWith('session-a');
      expect(mocks.videoStream.deleteSession).toHaveBeenCalledWith('session-b');
    });
  });

  describe('onHlsSessionCleanup', () => {
    it('reaps DB-expired sessions under a database lock', async () => {
      mocks.database.withLock.mockImplementation(async (_, fn) => fn());
      mocks.videoStream.getExpiredSessions.mockResolvedValue([
        { id: 'expired-1', ownerId: 'user-a' },
        { id: 'expired-2', ownerId: 'user-b' },
      ]);

      await sut.onHlsSessionCleanup();

      expect(mocks.videoStream.deleteSession).toHaveBeenCalledWith('expired-1');
      expect(mocks.videoStream.deleteSession).toHaveBeenCalledWith('expired-2');
      expect(mocks.storage.unlinkDir).toHaveBeenCalledTimes(2);
    });
  });
});

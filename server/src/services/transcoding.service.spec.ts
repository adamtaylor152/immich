import { HLS_CLEANUP_INTERVAL_MS, HLS_INACTIVITY_TIMEOUT_MS, HLS_LEASE_DURATION_MS } from 'src/constants';
import { TranscodingService } from 'src/services/transcoding.service';
import { VIDEO_STREAM_SESSION_PK_CONSTRAINT } from 'src/utils/database';
import { eiffelTower, train, waterfall } from 'test/fixtures/media.stub';
import { mockSpawn, newTestService, ServiceMocks } from 'test/utils';
import { vi } from 'vitest';

const eiffelSeeks = [
  0, 1.98715, 3.994372222222222, 6.001594444444444, 8.008816666666666, 10.016038888888888, 12.023261111111111,
  14.030483333333333, 16.037705555555554, 18.044927777777776, 20.052149999999997, 22.059372222222223,
];
const waterfallSeeks = [
  0, 1.994642826321467, 4.006047357065803, 6.0174518878101395, 8.028856418554476, 10.040260949298812,
];
const trainSeeks = [
  0, 1.9916666666666667, 3.9916666666666667, 5.991666666666666, 7.991666666666666, 9.991666666666667,
  11.991666666666667, 13.991666666666667, 15.991666666666667, 17.991666666666667, 19.991666666666667,
];

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

  describe('FFmpeg full command', () => {
    const baseCommand = [
      '-nostdin',
      '-nostats',
      '-i',
      'eiffel-tower.mp4',
      '-map',
      '0:0',
      '-map_metadata',
      '-1',
      '-map',
      '0:1',
      '-g',
      '50',
      '-keyint_min',
      '50',
      '-crf',
      '23',
      '-start_at_zero',
      '-copyts',
      '-r',
      '50130000/2012441',
      '-avoid_negative_ts',
      'disabled',
      '-f',
      'hls',
      '-hls_time',
      '2',
      '-hls_list_size',
      '0',
      '-hls_segment_type',
      'fmp4',
      '-hls_fmp4_init_filename',
      'init.mp4',
      '-hls_segment_options',
      'movflags=+frag_discont',
      '-hls_flags',
      'temp_file',
      '-start_number',
      '0',
    ];

    it.each([
      {
        variantIndex: 6,
        expected: [
          ...baseCommand,
          '-c:v',
          'libsvtav1',
          '-c:a',
          'aac',
          '-preset',
          '12',
          '-svtav1-params',
          'hierarchical-levels=3:lookahead=0:enable-tf=0:mbr=4000k',
          '-hls_segment_filename',
          '/data/encoded-video/user-1/se/ss/6/seg_%d.m4s',
          '/data/encoded-video/user-1/se/ss/6/playlist.m3u8',
        ].sort(),
      },
      {
        variantIndex: 4,
        expected: [
          ...baseCommand,
          '-c:v',
          'hevc',
          '-c:a',
          'aac',
          '-tag:v',
          'hvc1',
          '-preset',
          'ultrafast',
          '-maxrate',
          '2500k',
          '-bufsize',
          '5000k',
          '-x265-params',
          'no-scenecut=1:no-open-gop=1',
          '-vf',
          'scale=720:-2',
          '-hls_segment_filename',
          '/data/encoded-video/user-1/se/ss/4/seg_%d.m4s',
          '/data/encoded-video/user-1/se/ss/4/playlist.m3u8',
        ].sort(),
      },
      {
        variantIndex: 2,
        expected: [
          ...baseCommand,
          '-c:v',
          'h264',
          '-c:a',
          'aac',
          '-preset',
          'ultrafast',
          '-maxrate',
          '2500k',
          '-bufsize',
          '5000k',
          '-sc_threshold:v',
          '0',
          '-vf',
          'scale=480:-2',
          '-hls_segment_filename',
          '/data/encoded-video/user-1/se/ss/2/seg_%d.m4s',
          '/data/encoded-video/user-1/se/ss/2/playlist.m3u8',
        ].sort(),
      },
    ])('builds the expected FFmpeg command for $codec (variant $variantIndex)', async ({ variantIndex, expected }) => {
      mocks.process.spawn.mockReturnValue(mockSpawn(0, '', ''));

      await sut.onSessionRequest({ sessionId, assetId, ownerId });
      await sut.onSegmentRequest({ sessionId, assetId, variantIndex, segmentIndex: 0 });

      expect(mocks.process.spawn.mock.calls[0][1].toSorted()).toEqual(expected);
    });
  });

  describe('FFmpeg seek per segment', () => {
    const cases = [
      ...eiffelSeeks.map((expected, segmentIndex) => ({
        name: `${eiffelTower.originalPath} K=${segmentIndex}`,
        fixture: eiffelTower,
        segmentIndex,
        expected,
      })),
      ...waterfallSeeks.map((expected, segmentIndex) => ({
        name: `${waterfall.originalPath} K=${segmentIndex}`,
        fixture: waterfall,
        segmentIndex,
        expected,
      })),
      ...trainSeeks.map((expected, segmentIndex) => ({
        name: `${train.originalPath} K=${segmentIndex}`,
        fixture: train,
        segmentIndex,
        expected,
      })),
    ];

    it.each(cases)('$name', async ({ fixture, segmentIndex, expected }) => {
      mocks.videoStream.getForTranscoding.mockResolvedValue(fixture);
      mocks.process.spawn.mockReturnValue(mockSpawn(0, '', ''));

      await sut.onSessionRequest({ sessionId, assetId, ownerId });
      await sut.onSegmentRequest({ sessionId, assetId, variantIndex: 0, segmentIndex });

      const args = mocks.process.spawn.mock.calls[0][1] as string[];
      const ssIndex = args.indexOf('-ss');
      if (expected === 0) {
        expect(ssIndex).toBe(-1);
      } else {
        expect(args[ssIndex + 1]).toBe(String(expected));
      }
    });
  });
});

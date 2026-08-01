import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { ImmichGoCompatInterceptor } from 'src/middleware/immich-go-compat.interceptor';
import { describe, expect, it } from 'vitest';

const makeContext = (userAgent?: string, optInHeader?: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        headers: {
          'user-agent': userAgent,
          ...(optInHeader !== undefined && { 'x-immich-go-compat': optInHeader }),
        },
      }),
    }),
  }) as unknown as ExecutionContext;

const makeHandler = (body: unknown): CallHandler => ({
  handle: () => of(body),
});

const run = async (
  interceptor: ImmichGoCompatInterceptor,
  userAgent: string | undefined,
  body: unknown,
  optInHeader?: string,
) => {
  return firstValueFrom(interceptor.intercept(makeContext(userAgent, optInHeader), makeHandler(body)));
};

describe('ImmichGoCompatInterceptor', () => {
  const interceptor = new ImmichGoCompatInterceptor();

  describe('without immich-go User-Agent', () => {
    it('passes response through unchanged when User-Agent is absent', async () => {
      const body = { duration: 42_123 };
      const result = await run(interceptor, undefined, body);
      expect(result).toBe(body);
      expect((result as { duration: unknown }).duration).toBe(42_123);
    });

    it('passes response through unchanged for non-legacy clients', async () => {
      const body = { duration: 42_123 };
      const result = await run(interceptor, 'Mozilla/5.0', body);
      expect((result as { duration: unknown }).duration).toBe(42_123);
    });
  });

  describe('with immich-go User-Agent', () => {
    it('converts integer duration to hh:mm:ss.SSS string', async () => {
      const result = await run(interceptor, 'immich-go/0.24.0', { id: 'a', duration: 42_123 });
      expect(result).toEqual({ id: 'a', duration: '00:00:42.123' });
    });

    it('preserves null duration', async () => {
      const result = await run(interceptor, 'immich-go/0.24.0', { id: 'a', duration: null });
      expect(result).toEqual({ id: 'a', duration: null });
    });

    it('handles paginated asset list shape', async () => {
      const body = {
        albums: { items: [] },
        assets: {
          items: [
            { id: 'a', duration: 0 },
            { id: 'b', duration: 3_661_500 },
            { id: 'c', duration: null },
          ],
        },
      };
      const result = (await run(interceptor, 'immich-go/0.24.0', body)) as {
        assets: { items: Array<{ duration: unknown }> };
      };
      expect(result.assets.items[0].duration).toBe('00:00:00.000');
      expect(result.assets.items[1].duration).toBe('01:01:01.500');
      expect(result.assets.items[2].duration).toBeNull();
    });

    it('handles time-bucket array of durations', async () => {
      const body = { duration: [0, 42_123, null] };
      const result = (await run(interceptor, 'immich-go/0.24.0', body)) as { duration: unknown[] };
      expect(result.duration).toEqual(['00:00:00.000', '00:00:42.123', null]);
    });

    it('clamps hours-only values that exceed a day', async () => {
      // 25h 30m 15s 999ms
      const totalMs = 25 * 3_600_000 + 30 * 60_000 + 15 * 1000 + 999;
      const result = await run(interceptor, 'immich-go/0.24.0', { duration: totalMs });
      expect((result as { duration: string }).duration).toBe('25:30:15.999');
    });

    it('matches User-Agent case-insensitively', async () => {
      const result = await run(interceptor, 'Immich-Go/0.24.0', { duration: 1000 });
      expect((result as { duration: string }).duration).toBe('00:00:01.000');
    });

    it("does NOT match Go's default HTTP client User-Agent (avoids breaking other Go clients)", async () => {
      const result = await run(interceptor, 'Go-http-client/1.1', { duration: 1000 });
      // No conversion — duration stays as integer ms.
      expect((result as { duration: number }).duration).toBe(1000);
    });

    it('matches via explicit X-Immich-Go-Compat header', async () => {
      const result = await run(interceptor, 'Go-http-client/1.1', { duration: 1000 }, '1');
      expect((result as { duration: string }).duration).toBe('00:00:01.000');
    });

    it('accepts X-Immich-Go-Compat: true', async () => {
      const result = await run(interceptor, undefined, { duration: 1000 }, 'true');
      expect((result as { duration: string }).duration).toBe('00:00:01.000');
    });

    it('leaves unrelated fields untouched', async () => {
      const body = { id: 'a', duration: 5000, originalFileName: 'video.mp4', height: 1080 };
      const result = await run(interceptor, 'immich-go/0.24.0', body);
      expect(result).toEqual({ id: 'a', duration: '00:00:05.000', originalFileName: 'video.mp4', height: 1080 });
    });
  });
});

import { NextFunction, Request, Response } from 'express';
import { ImmichGoUploadCompatMiddleware } from 'src/middleware/immich-go-upload-compat.middleware';
import { describe, expect, it, vi } from 'vitest';

const makeReq = (userAgent: string | undefined, body: Record<string, unknown> | undefined): Request =>
  ({ headers: { 'user-agent': userAgent }, body }) as unknown as Request;

const run = (userAgent: string | undefined, body?: Record<string, unknown>) => {
  const middleware = new ImmichGoUploadCompatMiddleware();
  const req = makeReq(userAgent, body);
  const next = vi.fn() as unknown as NextFunction;
  middleware.use(req, {} as Response, next);
  return { req, next };
};

describe('ImmichGoUploadCompatMiddleware', () => {
  describe('without immich-go User-Agent', () => {
    it('leaves duration untouched and calls next', () => {
      const body = { duration: '00:00:42.123' };
      const { next } = run(undefined, body);
      expect(body.duration).toBe('00:00:42.123');
      expect(next).toHaveBeenCalledOnce();
    });

    it('leaves duration untouched for non-legacy clients', () => {
      const body = { duration: '00:00:42.123' };
      run('Mozilla/5.0', body);
      expect(body.duration).toBe('00:00:42.123');
    });
  });

  describe('with immich-go User-Agent', () => {
    it('converts hh:mm:ss.SSS string to integer milliseconds', () => {
      const body: Record<string, unknown> = { duration: '00:00:42.123' };
      run('immich-go/0.24.0', body);
      expect(body.duration).toBe(42_123);
    });

    it('handles missing milliseconds', () => {
      const body: Record<string, unknown> = { duration: '01:02:03' };
      run('immich-go/0.24.0', body);
      expect(body.duration).toBe(3_723_000);
    });

    it('handles padded millisecond fragments', () => {
      const body: Record<string, unknown> = { duration: '00:00:01.5' };
      run('immich-go/0.24.0', body);
      expect(body.duration).toBe(1500);
    });

    it('handles hour values greater than 23', () => {
      const body: Record<string, unknown> = { duration: '25:30:15.999' };
      run('immich-go/0.24.0', body);
      expect(body.duration).toBe(25 * 3_600_000 + 30 * 60_000 + 15 * 1000 + 999);
    });

    it('leaves unparseable strings untouched (zod will reject)', () => {
      const body: Record<string, unknown> = { duration: 'banana' };
      run('immich-go/0.24.0', body);
      expect(body.duration).toBe('banana');
    });

    it('leaves integer durations untouched', () => {
      const body: Record<string, unknown> = { duration: 42_123 };
      run('immich-go/0.24.0', body);
      expect(body.duration).toBe(42_123);
    });

    it('is a no-op when body is missing', () => {
      const { next } = run('immich-go/0.24.0');
      expect(next).toHaveBeenCalledOnce();
    });

    it('is a no-op when duration is missing from body', () => {
      const body: Record<string, unknown> = { filename: 'video.mp4' };
      run('immich-go/0.24.0', body);
      expect(body).toEqual({ filename: 'video.mp4' });
    });

    it('matches User-Agent case-insensitively', () => {
      const body: Record<string, unknown> = { duration: '00:00:01.000' };
      run('Immich-Go/0.24.0', body);
      expect(body.duration).toBe(1000);
    });
  });
});

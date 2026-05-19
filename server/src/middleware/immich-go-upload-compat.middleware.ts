import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

// Counterpart to ImmichGoCompatInterceptor: converts `duration` on incoming
// asset upload bodies from the legacy `hh:mm:ss.SSS` string format to the
// integer milliseconds format the post-#28003 zod schema expects.
const LEGACY_USER_AGENT = /^immich-go\//i;
const HMS_FORMAT = /^(\d+):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;

function hmsStringToMilliseconds(input: string): number | null {
  const match = HMS_FORMAT.exec(input);
  if (!match) {
    return null;
  }
  const milli = match[4] ? Number(match[4].padEnd(3, '0').slice(0, 3)) : 0;
  return Number(match[1]) * 3_600_000 + Number(match[2]) * 60_000 + Number(match[3]) * 1000 + milli;
}

@Injectable()
export class ImmichGoUploadCompatMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const userAgent = req.headers['user-agent'];
    if (userAgent && LEGACY_USER_AGENT.test(userAgent)) {
      const body = req.body as Record<string, unknown> | undefined;
      if (body && typeof body.duration === 'string') {
        const ms = hmsStringToMilliseconds(body.duration);
        if (ms !== null) {
          body.duration = ms;
        }
      }
    }
    next();
  }
}

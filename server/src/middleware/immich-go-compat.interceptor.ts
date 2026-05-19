import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, map } from 'rxjs';

// Fork-only compatibility shim for legacy immich-go clients that predate
// upstream PR #28003 (duration → integer ms). Converts response `duration`
// fields back to the pre-3.0 `hh:mm:ss.SSS` string format when the request
// User-Agent identifies as immich-go.
const LEGACY_USER_AGENT = /^immich-go\//i;

function millisecondsToHmsString(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const milli = total % 1000;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}.${String(milli).padStart(3, '0')}`;
}

function rewriteDurations(node: unknown, depth = 0): void {
  if (node === null || typeof node !== 'object' || depth > 16) {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      rewriteDurations(item, depth + 1);
    }
    return;
  }
  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (key === 'duration') {
      if (typeof value === 'number') {
        obj[key] = millisecondsToHmsString(value);
      } else if (Array.isArray(value)) {
        // time-bucket responses: `duration` is (number | null)[]
        obj[key] = value.map((entry) => (typeof entry === 'number' ? millisecondsToHmsString(entry) : entry));
      }
    } else if (value !== null && typeof value === 'object') {
      rewriteDurations(value, depth + 1);
    }
  }
}

@Injectable()
export class ImmichGoCompatInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const userAgent = context.switchToHttp().getRequest<Request>().headers['user-agent'];
    if (!userAgent || !LEGACY_USER_AGENT.test(userAgent)) {
      return next.handle();
    }
    return next.handle().pipe(
      map((body) => {
        rewriteDurations(body);
        return body;
      }),
    );
  }
}

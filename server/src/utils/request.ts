import { IncomingHttpHeaders } from 'node:http';
import { UAParser } from 'ua-parser-js';

/**
 * Decode a hex- or base64-encoded checksum string to a Buffer.
 *
 * Supports both SHA-1 (20 bytes) and SHA-256 (32 bytes) digests; the algorithm
 * is detected solely by encoded-string length:
 * - SHA-1:   20 bytes ⇒ 40 hex chars  | 28 base64 chars (with `=` padding)
 * - SHA-256: 32 bytes ⇒ 64 hex chars  | 44 base64 chars (with `=` padding)
 *
 * Any other length still attempts a hex decode (which yields a shorter Buffer
 * for invalid input) — callers should compare the resulting Buffer by exact
 * byte equality against a stored checksum, so spurious decodes harmlessly fail
 * the equality check.
 */
export const fromChecksum = (checksum: string): Buffer => {
  const isBase64 = checksum.length === 28 || checksum.length === 44;
  return Buffer.from(checksum, isBase64 ? 'base64' : 'hex');
};

export const fromMaybeArray = <T>(param: T | T[]) => (Array.isArray(param) ? param[0] : param);

export const getAppVersionFromUA = (ua: string) =>
  ua.match(/^immich-(?:android|ios|unknown)\/(?<appVersion>.+)$/)?.groups?.appVersion ??
  // legacy format
  ua.match(/^Immich_(?:Android|iOS|Unknown)_(?<appVersion>.+)$/)?.groups?.appVersion ??
  null;

export const getUserAgentDetails = (headers: IncomingHttpHeaders) => {
  const userAgent = UAParser(headers['user-agent']);
  const appVersion = getAppVersionFromUA(headers['user-agent'] ?? '');

  return {
    deviceType: userAgent.browser.name || userAgent.device.type || (headers['devicemodel'] as string) || '',
    deviceOS: userAgent.os.name || (headers['devicetype'] as string) || '',
    appVersion,
  };
};

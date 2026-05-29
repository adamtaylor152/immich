import { createHash } from 'node:crypto';
import { fromChecksum, getAppVersionFromUA } from 'src/utils/request';

describe(fromChecksum.name, () => {
  const sha1Buffer = createHash('sha1').update('hello').digest();
  const sha256Buffer = createHash('sha256').update('hello').digest();

  it('decodes a SHA-1 hex string (40 chars) into a 20-byte buffer', () => {
    const result = fromChecksum(sha1Buffer.toString('hex'));
    expect(result.equals(sha1Buffer)).toBe(true);
    expect(result.length).toBe(20);
  });

  it('decodes a SHA-1 base64 string (28 chars) into a 20-byte buffer', () => {
    const result = fromChecksum(sha1Buffer.toString('base64'));
    expect(result.equals(sha1Buffer)).toBe(true);
    expect(result.length).toBe(20);
  });

  it('decodes a SHA-256 hex string (64 chars) into a 32-byte buffer', () => {
    const result = fromChecksum(sha256Buffer.toString('hex'));
    expect(result.equals(sha256Buffer)).toBe(true);
    expect(result.length).toBe(32);
  });

  it('decodes a SHA-256 base64 string (44 chars) into a 32-byte buffer', () => {
    const result = fromChecksum(sha256Buffer.toString('base64'));
    expect(result.equals(sha256Buffer)).toBe(true);
    expect(result.length).toBe(32);
  });

  it('does not confuse SHA-1 and SHA-256 digests', () => {
    expect(fromChecksum(sha1Buffer.toString('hex')).equals(sha256Buffer)).toBe(false);
    expect(fromChecksum(sha256Buffer.toString('hex')).equals(sha1Buffer)).toBe(false);
  });
});

describe(getAppVersionFromUA.name, () => {
  it('should get the app version for android', () => {
    expect(getAppVersionFromUA('immich-android/1.123.4')).toEqual('1.123.4');
  });

  it('should get the app version for ios', () => {
    expect(getAppVersionFromUA('immich-ios/1.123.4')).toEqual('1.123.4');
  });

  it('should get the app version for unknown', () => {
    expect(getAppVersionFromUA('immich-unknown/1.123.4')).toEqual('1.123.4');
  });

  describe('legacy format', () => {
    it('should get the app version from the old android format', () => {
      expect(getAppVersionFromUA('Immich_Android_1.123.4')).toEqual('1.123.4');
    });

    it('should get the app version from the old ios format', () => {
      expect(getAppVersionFromUA('Immich_iOS_1.123.4')).toEqual('1.123.4');
    });

    it('should get the app version from the old unknown format', () => {
      expect(getAppVersionFromUA('Immich_Unknown_1.123.4')).toEqual('1.123.4');
    });
  });
});

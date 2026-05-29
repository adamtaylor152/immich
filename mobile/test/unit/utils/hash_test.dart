import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/utils/hash.dart';

void main() {
  group('detectChecksumAlgorithm', () {
    test('detects SHA-1 from 28-char base64', () {
      // 20 random bytes → 28 base64 chars including `=` padding.
      const sha1Base64 = '2jmj7l5rSw0yVb/vlWAYkK/YBwk=';
      expect(sha1Base64.length, 28);
      expect(detectChecksumAlgorithm(sha1Base64), AssetChecksumAlgorithm.sha1);
    });

    test('detects SHA-1 from 40-char hex', () {
      const sha1Hex = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';
      expect(sha1Hex.length, 40);
      expect(detectChecksumAlgorithm(sha1Hex), AssetChecksumAlgorithm.sha1);
    });

    test('detects SHA-256 from 44-char base64', () {
      // 32 random bytes → 44 base64 chars including `=` padding.
      const sha256Base64 = '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=';
      expect(sha256Base64.length, 44);
      expect(
        detectChecksumAlgorithm(sha256Base64),
        AssetChecksumAlgorithm.sha256,
      );
    });

    test('detects SHA-256 from 64-char hex', () {
      const sha256Hex = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      expect(sha256Hex.length, 64);
      expect(
        detectChecksumAlgorithm(sha256Hex),
        AssetChecksumAlgorithm.sha256,
      );
    });

    test('returns unknown for other lengths', () {
      expect(detectChecksumAlgorithm(''), AssetChecksumAlgorithm.unknown);
      expect(detectChecksumAlgorithm('abc'), AssetChecksumAlgorithm.unknown);
      // 32 chars — neither 28 nor 40 nor 44 nor 64.
      expect(
        detectChecksumAlgorithm('a' * 32),
        AssetChecksumAlgorithm.unknown,
      );
    });
  });
}

/// FNV-1a 64bit hash algorithm optimized for Dart Strings
int fastHash(String string) {
  var hash = 0xcbf29ce484222325;

  var i = 0;
  while (i < string.length) {
    final codeUnit = string.codeUnitAt(i++);
    hash ^= codeUnit >> 8;
    hash *= 0x100000001b3;
    hash ^= codeUnit & 0xFF;
    hash *= 0x100000001b3;
  }

  return hash;
}

/// Server-side asset checksum algorithms.
///
/// As of commit `3dbbb1e6e` the server computes SHA-256 for all new uploads.
/// SHA-1 rows from before the transition remain in `remote_asset_entity` and
/// `assets.checksum`. Both algorithms ship in the same column as a
/// variable-length bytea, and the API exposes them as base64-encoded strings
/// of either 28 chars (SHA-1) or 44 chars (SHA-256).
enum AssetChecksumAlgorithm {
  /// 20 bytes / 40 hex chars / 28 base64 chars (with `=` padding).
  sha1,

  /// 32 bytes / 64 hex chars / 44 base64 chars (with `=` padding).
  sha256,

  /// Length doesn't match any known algorithm.
  unknown,
}

/// Detect the algorithm of a server-supplied checksum string by length.
///
/// Mirrors the server's `fromChecksum` (`server/src/utils/request.ts`):
/// hex strings are 2 chars per byte (40 or 64), base64 strings are
/// `ceil(bytes / 3) * 4` (28 or 44, padded).
///
/// Use this when reading a server checksum (e.g. `AssetResponseDto.checksum`,
/// `SyncAssetV1.checksum`) and you need to know whether to compare against a
/// SHA-1 or SHA-256 digest locally.
///
/// **Caveat:** mobile only computes SHA-1 today (iOS `Insecure.SHA1()` +
/// Android `MessageDigest.getInstance("SHA-1")`). A returned [sha256] means
/// the asset was uploaded by a SHA-256-capable client, and a SHA-1 local
/// digest will not match it — see `hash.service.dart` for the full impact
/// analysis.
AssetChecksumAlgorithm detectChecksumAlgorithm(String checksum) {
  switch (checksum.length) {
    case 28:
    case 40:
      return AssetChecksumAlgorithm.sha1;
    case 44:
    case 64:
      return AssetChecksumAlgorithm.sha256;
    default:
      return AssetChecksumAlgorithm.unknown;
  }
}

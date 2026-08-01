import 'dart:async';

import 'package:flutter/services.dart';
import 'package:immich_mobile/constants/constants.dart';
import 'package:immich_mobile/domain/models/album/local_album.model.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/extensions/platform_extensions.dart';
import 'package:immich_mobile/infrastructure/repositories/local_album.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/local_asset.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/trashed_local_asset.repository.dart';
import 'package:immich_mobile/platform/native_sync_api.g.dart';
import 'package:logging/logging.dart';

const String _kHashCancelledCode = "HASH_CANCELLED";

/// Hashes local assets and persists the digest into
/// `local_asset_entity.checksum`.
///
/// Algorithm: **SHA-1**, base64-encoded (28 chars including `=` padding).
/// - iOS: `Insecure.SHA1()` in `mobile/ios/Runner/Sync/MessagesImpl.swift`.
/// - Android: `MessageDigest.getInstance("SHA-1")` in
///   `mobile/android/app/src/main/kotlin/app/alextran/immich/sync/MessagesImplBase.kt`.
///
/// Encoding is `Base64.NO_WRAP` on Android and `base64EncodedString()` on
/// iOS — both produce 28-char strings with `=` padding for a 20-byte digest.
///
/// ### Usage
///
/// The hash is the **only** local-to-remote join key — `local_asset_entity`
/// has no explicit `remoteId` column. Sites that link local + remote assets
/// do so via `local.checksum.equalsExp(remote.checksum)` (see
/// `local_asset.repository.dart`, `remote_asset.repository.dart`,
/// `backup.repository.dart`, `timeline.repository.dart`,
/// `remote_album.repository.dart`, `trashed_local_asset.repository.dart`).
///
/// The hash is **not** sent to the server on upload — the server computes
/// its own digest from the uploaded byte stream (`file-upload.interceptor.ts`).
///
/// ### SHA-256 server-side transition (commit `3dbbb1e6e`)
///
/// As of commit `3dbbb1e6e`, the server computes **SHA-256** (32 bytes,
/// 44-char base64) for all new uploads and stores it in
/// `remote_asset_entity.checksum`. Legacy SHA-1 rows (28-char base64) remain.
///
/// **Consequence:** for any asset uploaded after the server transition, the
/// local hash (SHA-1) will never equal the remote hash (SHA-256), so the
/// `local.checksum.equalsExp(remote.checksum)` join silently fails. The
/// asset will then:
///   - Show as "not yet backed up" in `getBackupCounts` /
///     `DriftBackupRepository.getAllCounts` (UI breaks).
///   - Be re-included in `getCandidates` on every backup cycle (wasted
///     bandwidth — the server returns `AssetMediaStatus.DUPLICATE` on the
///     unique-constraint violation, but mobile still re-uploads the bytes).
///   - Never resolve a `remoteId` in the LEFT JOIN-derived
///     `LocalAsset.toDto(remoteId: ...)` path, so timeline + troubleshoot
///     UI cannot follow the asset to its server-side record.
///
/// The proper fix is dual-hash native code (compute both SHA-1 and SHA-256
/// in one stream pass) + a new `localAssetEntity.sha256` column + JOIN
/// updates to match on either column. This is a coordinated change across
/// Swift, Kotlin, Pigeon API, and a Drift migration. Tracked separately;
/// see `.claude/review/mobile-sha256-audit.md`.
class HashService {
  final int _batchSize;
  final DriftLocalAlbumRepository _localAlbumRepository;
  final DriftLocalAssetRepository _localAssetRepository;
  final DriftTrashedLocalAssetRepository _trashedLocalAssetRepository;
  final NativeSyncApi _nativeSyncApi;
  final Completer<void>? _cancellation;
  final _log = Logger('HashService');

  HashService({
    required this._localAlbumRepository,
    required this._localAssetRepository,
    required this._trashedLocalAssetRepository,
    required this._nativeSyncApi,
    this._cancellation,
    int? batchSize,
  }) : _batchSize = batchSize ?? kBatchHashFileLimit {
    // Stop the in-flight native hash call promptly on cancellation; the loops
    // below also observe [isCancelled] to bail between batches.
    unawaited(_cancellation?.future.then((_) => _nativeSyncApi.cancelHashing().onError(_log.warning)));
  }

  bool get isCancelled => _cancellation?.isCompleted ?? false;

  Future<void> hashAssets() async {
    _log.info("Starting hashing of assets");
    final Stopwatch stopwatch = Stopwatch()..start();
    try {
      // Migrate hashes from cloud ID to local ID so we don't have to re-hash them
      // await _localAssetRepository.reconcileHashesFromCloudId();

      // Sorted by backupSelection followed by isCloud
      final localAlbums = await _localAlbumRepository.getBackupAlbums();

      for (final album in localAlbums) {
        if (isCancelled) {
          _log.warning("Hashing cancelled. Stopped processing albums.");
          break;
        }

        final assetsToHash = await _localAlbumRepository.getAssetsToHash(album.id);
        if (assetsToHash.isNotEmpty) {
          await _hashAssets(album, assetsToHash);
        }
      }
      if (CurrentPlatform.isAndroid && localAlbums.isNotEmpty) {
        final backupAlbumIds = localAlbums.map((e) => e.id);
        final trashedToHash = await _trashedLocalAssetRepository.getAssetsToHash(backupAlbumIds);
        if (trashedToHash.isNotEmpty) {
          final pseudoAlbum = LocalAlbum(id: '-pseudoAlbum', name: 'Trash', updatedAt: DateTime.now());
          await _hashAssets(pseudoAlbum, trashedToHash, isTrashed: true);
        }
      }
    } on PlatformException catch (e) {
      if (e.code == _kHashCancelledCode) {
        _log.warning("Hashing cancelled by platform");
        return;
      }
    } catch (e, s) {
      _log.severe("Error during hashing", e, s);
    }

    stopwatch.stop();
    _log.info("Hashing took - ${stopwatch.elapsedMilliseconds}ms");
  }

  /// Processes a list of [LocalAsset]s, storing their hash and updating the assets in the DB
  /// with hash for those that were successfully hashed. Hashes are looked up in a table
  /// [LocalAssetHashEntity] by local id. Only missing entries are newly hashed and added to the DB.
  Future<void> _hashAssets(LocalAlbum album, List<LocalAsset> assetsToHash, {bool isTrashed = false}) async {
    final toHash = <String, LocalAsset>{};

    for (final asset in assetsToHash) {
      if (isCancelled) {
        _log.warning("Hashing cancelled. Stopped processing assets.");
        return;
      }

      toHash[asset.id] = asset;
      if (toHash.length == _batchSize) {
        await _processBatch(album, toHash, isTrashed);
        toHash.clear();
      }
    }

    await _processBatch(album, toHash, isTrashed);
  }

  /// Processes a batch of assets.
  Future<void> _processBatch(LocalAlbum album, Map<String, LocalAsset> toHash, bool isTrashed) async {
    if (toHash.isEmpty) {
      return;
    }

    _log.fine("Hashing ${toHash.length} files");

    final hashed = <String, String>{};
    final hashResults = await _nativeSyncApi.hashAssets(
      toHash.keys.toList(),
      allowNetworkAccess: album.backupSelection == BackupSelection.selected,
    );
    assert(
      hashResults.length == toHash.length,
      "Hashes length does not match toHash length: ${hashResults.length} != ${toHash.length}",
    );

    for (int i = 0; i < hashResults.length; i++) {
      if (isCancelled) {
        _log.warning("Hashing cancelled. Stopped processing batch.");
        return;
      }

      final hashResult = hashResults[i];
      if (hashResult.hash != null) {
        hashed[hashResult.assetId] = hashResult.hash!;
      } else {
        final asset = toHash[hashResult.assetId];
        _log.warning(
          "Failed to hash asset with id: ${hashResult.assetId}, name: ${asset?.name}, createdAt: ${asset?.createdAt}, from album: ${album.name}. Error: ${hashResult.error ?? "unknown"}",
        );
      }
    }

    _log.fine("Hashed ${hashed.length}/${toHash.length} assets");
    if (isTrashed) {
      await _trashedLocalAssetRepository.updateHashes(hashed);
    } else {
      await _localAssetRepository.updateHashes(hashed);
    }
  }
}

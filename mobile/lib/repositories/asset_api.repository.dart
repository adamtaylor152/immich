import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/domain/models/asset_edit.model.dart' hide AssetEditAction;
import 'package:immich_mobile/domain/models/stack.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:maplibre_gl/maplibre_gl.dart';
import 'package:openapi/api.dart';

final assetApiRepositoryProvider = Provider(
  (ref) => AssetApiRepository(
    ref.watch(apiServiceProvider).assetsApi,
    ref.watch(apiServiceProvider).stacksApi,
    ref.watch(apiServiceProvider).trashApi,
  ),
);

class AssetApiRepository extends ApiRepository {
  final AssetsApi _api;
  final StacksApi _stacksApi;
  final TrashApi _trashApi;

  AssetApiRepository(this._api, this._stacksApi, this._trashApi);

  Future<void> delete(List<String> ids, bool force) async {
    return _api.deleteAssets(AssetBulkDeleteDto(ids: ids, force: force));
  }

  Future<void> restoreTrash(List<String> ids) async {
    await _trashApi.restoreAssets(BulkIdsDto(ids: ids));
  }

  Future<int> emptyTrash() async {
    final response = await _trashApi.emptyTrash();
    return response?.count ?? 0;
  }

  Future<int> restoreAllTrash() async {
    final response = await _trashApi.restoreTrash();
    return response?.count ?? 0;
  }

  Future<void> updateVisibility(List<String> ids, AssetVisibilityEnum visibility) async {
    return _api.updateAssets(AssetBulkUpdateDto(ids: ids, visibility: _mapVisibility(visibility)));
  }

  Future<void> updateFavorite(List<String> ids, bool isFavorite) async {
    return _api.updateAssets(AssetBulkUpdateDto(ids: ids, isFavorite: isFavorite));
  }

  // TODO(server): replace per-asset POSTs with a bulk endpoint
  // (mirrors AssetBulkUpdateDto) once the API supports it.
  static const int _imageEnrichmentChunkSize = 16;

  Future<AssetEnrichmentResult> markNsfw(List<String> ids) async {
    return _runImageEnrichment(ids, AssetImageEnrichmentAction.markNsfw);
  }

  Future<AssetEnrichmentResult> markSafe(List<String> ids) async {
    return _runImageEnrichment(ids, AssetImageEnrichmentAction.markSafe);
  }

  Future<AssetEnrichmentResult> _runImageEnrichment(List<String> ids, AssetImageEnrichmentAction action) async {
    final dto = AssetImageEnrichmentActionRequestDto(action: action);
    final succeeded = <String>[];
    final failed = <String>[];
    for (var i = 0; i < ids.length; i += _imageEnrichmentChunkSize) {
      final end = (i + _imageEnrichmentChunkSize) > ids.length ? ids.length : (i + _imageEnrichmentChunkSize);
      final chunk = ids.sublist(i, end);
      final results = await Future.wait(
        chunk.map((id) async {
          try {
            await _api.updateAssetImageEnrichment(id, dto);
            return _IdResult(id, true);
          } catch (_) {
            return _IdResult(id, false);
          }
        }),
      );
      for (final r in results) {
        if (r.success) {
          succeeded.add(r.id);
        } else {
          failed.add(r.id);
        }
      }
    }
    return AssetEnrichmentResult(succeeded: succeeded, failed: failed);
  }

  Future<void> updateLocation(List<String> ids, LatLng location) async {
    return _api.updateAssets(AssetBulkUpdateDto(ids: ids, latitude: location.latitude, longitude: location.longitude));
  }

  Future<void> updateDateTime(List<String> ids, DateTime dateTime) async {
    return _api.updateAssets(AssetBulkUpdateDto(ids: ids, dateTimeOriginal: dateTime.toIso8601String()));
  }

  Future<StackResponse> stack(List<String> ids) async {
    final responseDto = await checkNull(_stacksApi.createStack(StackCreateDto(assetIds: ids)));

    return responseDto.toStack();
  }

  Future<void> unStack(List<String> ids) async {
    return _stacksApi.deleteStacks(BulkIdsDto(ids: ids));
  }

  Future<Response> downloadAsset(String id, {required bool edited}) {
    return _api.downloadAssetWithHttpInfo(id, edited: edited);
  }

  _mapVisibility(AssetVisibilityEnum visibility) => switch (visibility) {
    AssetVisibilityEnum.timeline => AssetVisibility.timeline,
    AssetVisibilityEnum.hidden => AssetVisibility.hidden,
    AssetVisibilityEnum.locked => AssetVisibility.locked,
    AssetVisibilityEnum.archive => AssetVisibility.archive,
  };

  Future<String?> getAssetMIMEType(String assetId) async {
    final response = await checkNull(_api.getAssetInfo(assetId));

    // we need to get the MIME of the thumbnail once that gets added to the API
    return response.originalMimeType;
  }

  Future<void> updateDescription(String assetId, String description) {
    return _api.updateAsset(assetId, UpdateAssetDto(description: description));
  }

  Future<void> updateRating(String assetId, int rating) {
    return _api.updateAsset(assetId, UpdateAssetDto(rating: rating));
  }

  Future<AssetEditsResponseDto?> editAsset(String assetId, List<AssetEdit> edits) {
    return _api.editAsset(assetId, AssetEditsCreateDto(edits: edits.map((e) => e.toApi()).toList()));
  }

  Future<void> removeEdits(String assetId) async {
    return _api.removeAssetEdits(assetId);
  }
}

extension on StackResponseDto {
  StackResponse toStack() {
    return StackResponse(id: id, primaryAssetId: primaryAssetId, assetIds: assets.map((asset) => asset.id).toList());
  }
}

extension on AssetEdit {
  AssetEditActionItemDto toApi() {
    return switch (this) {
      CropEdit(:final parameters) => AssetEditActionItemDto(
        action: AssetEditAction.crop,
        parameters: parameters.toJson(),
      ),
      RotateEdit(:final parameters) => AssetEditActionItemDto(
        action: AssetEditAction.rotate,
        parameters: parameters.toJson(),
      ),
      MirrorEdit(:final parameters) => AssetEditActionItemDto(
        action: AssetEditAction.mirror,
        parameters: parameters.toJson(),
      ),
    };
  }
}

/// Per-asset outcome for batched image-enrichment actions.
class AssetEnrichmentResult {
  final List<String> succeeded;
  final List<String> failed;

  const AssetEnrichmentResult({required this.succeeded, required this.failed});

  int get total => succeeded.length + failed.length;
  bool get allSucceeded => failed.isEmpty && succeeded.isNotEmpty;
  bool get anyFailed => failed.isNotEmpty;
}

class _IdResult {
  final String id;
  final bool success;
  const _IdResult(this.id, this.success);
}

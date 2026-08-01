import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/asset_edit.model.dart' hide AssetEditAction;
import 'package:immich_mobile/domain/models/stack.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:immich_mobile/utils/option.dart';
import 'package:maplibre_gl/maplibre_gl.dart';
import 'package:openapi/api.dart' as api show AssetVisibility;
import 'package:openapi/api.dart' hide AssetVisibility;

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
    return _api.deleteAssets(AssetBulkDeleteDto(ids: ids, force: Optional.present(force)));
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

  // TODO(shenlong): remove after action migration
  Future<void> updateVisibility(List<String> ids, AssetVisibility visibility) async {
    return _api.updateAssets(AssetBulkUpdateDto(ids: ids, visibility: Optional.present(_mapVisibility(visibility))));
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

  api.AssetVisibility _mapVisibility(AssetVisibility visibility) => switch (visibility) {
    AssetVisibility.timeline => api.AssetVisibility.timeline,
    AssetVisibility.hidden => api.AssetVisibility.hidden,
    AssetVisibility.locked => api.AssetVisibility.locked,
    AssetVisibility.archive => api.AssetVisibility.archive,
  };

  Future<String?> getAssetMIMEType(String assetId) async {
    final response = await checkNull(_api.getAssetInfo(assetId));

    // we need to get the MIME of the thumbnail once that gets added to the API
    return response.originalMimeType.orElse(null);
  }

  Future<void> updateDescription(String assetId, String description) {
    return _api.updateAsset(assetId, UpdateAssetDto(description: Optional.present(description)));
  }

  Future<void> updateRating(String assetId, int? rating) {
    return _api.updateAsset(assetId, UpdateAssetDto(rating: Optional.present(rating)));
  }

  Future<AssetEditsResponseDto?> editAsset(String assetId, List<AssetEdit> edits) {
    return _api.editAsset(assetId, AssetEditsCreateDto(edits: edits.map((e) => e.toApi()).toList()));
  }

  Future<void> removeEdits(String assetId) async {
    return _api.removeAssetEdits(assetId);
  }

  Future<void> update(
    List<String> remoteIds, {
    Option<bool> isFavorite = const .none(),
    Option<AssetVisibility> visibility = const .none(),
    Option<String> dateTimeOriginal = const .none(),
    Option<LatLng> location = const .none(),
  }) {
    return _api.updateAssets(
      AssetBulkUpdateDto(
        ids: remoteIds,
        isFavorite: isFavorite.toOptional(),
        visibility: visibility.map(_mapVisibility).toOptional(),
        dateTimeOriginal: dateTimeOriginal.toOptional(),
        latitude: location.map((loc) => loc.latitude).toOptional(),
        longitude: location.map((loc) => loc.longitude).toOptional(),
      ),
    );
  }

  Future<void> updateLocation(List<String> ids, LatLng location) async {
    return _api.updateAssets(
      AssetBulkUpdateDto(
        ids: ids,
        latitude: Optional.present(location.latitude),
        longitude: Optional.present(location.longitude),
      ),
    );
  }

  Future<void> updateDateTime(List<String> ids, String dateTime) async {
    return _api.updateAssets(AssetBulkUpdateDto(ids: ids, dateTimeOriginal: Optional.present(dateTime)));
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

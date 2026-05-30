//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class LivePhotoApi {
  LivePhotoApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// List live photo relink candidates
  ///
  /// Find separated live photos (a still image and its motion video that are not linked) that can be reassembled.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getLivePhotoCandidatesWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final apiPath = r'/live-photo/candidates';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
    );
  }

  /// List live photo relink candidates
  ///
  /// Find separated live photos (a still image and its motion video that are not linked) that can be reassembled.
  Future<LivePhotoCandidatesResponseDto?> getLivePhotoCandidates() async {
    final response = await getLivePhotoCandidatesWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'LivePhotoCandidatesResponseDto',) as LivePhotoCandidatesResponseDto;
    
    }
    return null;
  }

  /// Relink live photos
  ///
  /// Reassemble the selected still + video pairs into live photos, hiding the standalone videos.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [LivePhotoRelinkDto] livePhotoRelinkDto (required):
  Future<Response> relinkLivePhotosWithHttpInfo(LivePhotoRelinkDto livePhotoRelinkDto,) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/live-photo/relink';

    // ignore: prefer_final_locals
    Object? postBody = livePhotoRelinkDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
    );
  }

  /// Relink live photos
  ///
  /// Reassemble the selected still + video pairs into live photos, hiding the standalone videos.
  ///
  /// Parameters:
  ///
  /// * [LivePhotoRelinkDto] livePhotoRelinkDto (required):
  Future<LivePhotoRelinkResponseDto?> relinkLivePhotos(LivePhotoRelinkDto livePhotoRelinkDto,) async {
    final response = await relinkLivePhotosWithHttpInfo(livePhotoRelinkDto,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'LivePhotoRelinkResponseDto',) as LivePhotoRelinkResponseDto;
    
    }
    return null;
  }
}

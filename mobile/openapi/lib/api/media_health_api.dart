//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class MediaHealthApi {
  MediaHealthApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Move confirmed corrupt media to trash
  ///
  /// Move recently confirmed corrupt media findings to trash after revalidation.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [MediaHealthDeleteCorruptDto] mediaHealthDeleteCorruptDto (required):
  Future<Response> deleteCorruptWithHttpInfo(MediaHealthDeleteCorruptDto mediaHealthDeleteCorruptDto,) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/media-health/corrupt';

    // ignore: prefer_final_locals
    Object? postBody = mediaHealthDeleteCorruptDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'DELETE',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
    );
  }

  /// Move confirmed corrupt media to trash
  ///
  /// Move recently confirmed corrupt media findings to trash after revalidation.
  ///
  /// Parameters:
  ///
  /// * [MediaHealthDeleteCorruptDto] mediaHealthDeleteCorruptDto (required):
  Future<MediaHealthBulkResponseDto?> deleteCorrupt(MediaHealthDeleteCorruptDto mediaHealthDeleteCorruptDto,) async {
    final response = await deleteCorruptWithHttpInfo(mediaHealthDeleteCorruptDto,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'MediaHealthBulkResponseDto',) as MediaHealthBulkResponseDto;
    
    }
    return null;
  }

  /// Dismiss media health findings
  ///
  /// Dismiss selected media health findings without modifying assets.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [MediaHealthBulkActionDto] mediaHealthBulkActionDto (required):
  Future<Response> dismissWithHttpInfo(MediaHealthBulkActionDto mediaHealthBulkActionDto,) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/media-health/dismiss';

    // ignore: prefer_final_locals
    Object? postBody = mediaHealthBulkActionDto;

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

  /// Dismiss media health findings
  ///
  /// Dismiss selected media health findings without modifying assets.
  ///
  /// Parameters:
  ///
  /// * [MediaHealthBulkActionDto] mediaHealthBulkActionDto (required):
  Future<void> dismiss(MediaHealthBulkActionDto mediaHealthBulkActionDto,) async {
    final response = await dismissWithHttpInfo(mediaHealthBulkActionDto,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// List media health findings
  ///
  /// List missing and corrupt media health findings in timeline buckets.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [MediaHealthCategory] category:
  ///
  /// * [int] size:
  ///
  /// * [MediaHealthStatus] status:
  Future<Response> listWithHttpInfo({ MediaHealthCategory? category, int? size, MediaHealthStatus? status, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/media-health';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (category != null) {
      queryParams.addAll(_queryParams('', 'category', category));
    }
    if (size != null) {
      queryParams.addAll(_queryParams('', 'size', size));
    }
    if (status != null) {
      queryParams.addAll(_queryParams('', 'status', status));
    }

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

  /// List media health findings
  ///
  /// List missing and corrupt media health findings in timeline buckets.
  ///
  /// Parameters:
  ///
  /// * [MediaHealthCategory] category:
  ///
  /// * [int] size:
  ///
  /// * [MediaHealthStatus] status:
  Future<MediaHealthListResponseDto?> list({ MediaHealthCategory? category, int? size, MediaHealthStatus? status, }) async {
    final response = await listWithHttpInfo( category: category, size: size, status: status, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'MediaHealthListResponseDto',) as MediaHealthListResponseDto;
    
    }
    return null;
  }

  /// Locate missing media
  ///
  /// Queue candidate discovery for missing media findings.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [MediaHealthBulkActionDto] mediaHealthBulkActionDto (required):
  Future<Response> locateMissingWithHttpInfo(MediaHealthBulkActionDto mediaHealthBulkActionDto,) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/media-health/missing/locate';

    // ignore: prefer_final_locals
    Object? postBody = mediaHealthBulkActionDto;

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

  /// Locate missing media
  ///
  /// Queue candidate discovery for missing media findings.
  ///
  /// Parameters:
  ///
  /// * [MediaHealthBulkActionDto] mediaHealthBulkActionDto (required):
  Future<MediaHealthScanResponseDto?> locateMissing(MediaHealthBulkActionDto mediaHealthBulkActionDto,) async {
    final response = await locateMissingWithHttpInfo(mediaHealthBulkActionDto,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'MediaHealthScanResponseDto',) as MediaHealthScanResponseDto;
    
    }
    return null;
  }

  /// Relink missing media
  ///
  /// Relink missing external-library assets to validated candidate files.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [MediaHealthBulkActionDto] mediaHealthBulkActionDto (required):
  Future<Response> relinkMissingWithHttpInfo(MediaHealthBulkActionDto mediaHealthBulkActionDto,) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/media-health/missing/relink';

    // ignore: prefer_final_locals
    Object? postBody = mediaHealthBulkActionDto;

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

  /// Relink missing media
  ///
  /// Relink missing external-library assets to validated candidate files.
  ///
  /// Parameters:
  ///
  /// * [MediaHealthBulkActionDto] mediaHealthBulkActionDto (required):
  Future<MediaHealthBulkResponseDto?> relinkMissing(MediaHealthBulkActionDto mediaHealthBulkActionDto,) async {
    final response = await relinkMissingWithHttpInfo(mediaHealthBulkActionDto,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'MediaHealthBulkResponseDto',) as MediaHealthBulkResponseDto;
    
    }
    return null;
  }

  /// Start corrupt media scan
  ///
  /// Queue an explicit scan that validates source media integrity.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> startCorruptScanWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final apiPath = r'/media-health/corrupt/scan';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


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

  /// Start corrupt media scan
  ///
  /// Queue an explicit scan that validates source media integrity.
  Future<MediaHealthScanResponseDto?> startCorruptScan() async {
    final response = await startCorruptScanWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'MediaHealthScanResponseDto',) as MediaHealthScanResponseDto;
    
    }
    return null;
  }

  /// Start missing media scan
  ///
  /// Queue a scan that identifies missing or unreadable source files.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> startMissingScanWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final apiPath = r'/media-health/missing/scan';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


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

  /// Start missing media scan
  ///
  /// Queue a scan that identifies missing or unreadable source files.
  Future<MediaHealthScanResponseDto?> startMissingScan() async {
    final response = await startMissingScanWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'MediaHealthScanResponseDto',) as MediaHealthScanResponseDto;
    
    }
    return null;
  }
}

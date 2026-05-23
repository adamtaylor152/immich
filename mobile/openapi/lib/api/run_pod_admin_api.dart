//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class RunPodAdminApi {
  RunPodAdminApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Enqueue all ML backfill jobs
  ///
  /// Queues smart-search, face detection, duplicates, OCR, image description, and NSFW detection.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> backfillWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final apiPath = r'/runpod/backfill';

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

  /// Enqueue all ML backfill jobs
  ///
  /// Queues smart-search, face detection, duplicates, OCR, image description, and NSFW detection.
  Future<RunPodBackfillResultDto?> backfill() async {
    final response = await backfillWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'RunPodBackfillResultDto',) as RunPodBackfillResultDto;
    
    }
    return null;
  }

  /// Get current RunPod state
  ///
  /// Returns the current managed RunPod pod state (idle / provisioning / running / etc).
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getCurrentWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final apiPath = r'/runpod/pods/current';

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

  /// Get current RunPod state
  ///
  /// Returns the current managed RunPod pod state (idle / provisioning / running / etc).
  Future<RunPodStateDto?> getCurrent() async {
    final response = await getCurrentWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'RunPodStateDto',) as RunPodStateDto;
    
    }
    return null;
  }

  /// List RunPod GPU types
  ///
  /// Returns the GPU types currently offered by RunPod, with pricing.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> listGpusWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final apiPath = r'/runpod/gpus';

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

  /// List RunPod GPU types
  ///
  /// Returns the GPU types currently offered by RunPod, with pricing.
  Future<List<RunPodGpuTypeDto>?> listGpus() async {
    final response = await listGpusWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<RunPodGpuTypeDto>') as List)
        .cast<RunPodGpuTypeDto>()
        .toList(growable: false);

    }
    return null;
  }

  /// Provision a RunPod pod
  ///
  /// Launch the ML container on RunPod and inject the proxy URL into the live ML config.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [RunPodProvisionDto] runPodProvisionDto (required):
  Future<Response> provisionWithHttpInfo(RunPodProvisionDto runPodProvisionDto,) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/runpod/pods';

    // ignore: prefer_final_locals
    Object? postBody = runPodProvisionDto;

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

  /// Provision a RunPod pod
  ///
  /// Launch the ML container on RunPod and inject the proxy URL into the live ML config.
  ///
  /// Parameters:
  ///
  /// * [RunPodProvisionDto] runPodProvisionDto (required):
  Future<RunPodStateDto?> provision(RunPodProvisionDto runPodProvisionDto,) async {
    final response = await provisionWithHttpInfo(runPodProvisionDto,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'RunPodStateDto',) as RunPodStateDto;
    
    }
    return null;
  }

  /// Resume the current RunPod pod
  ///
  /// Start a previously stopped pod, reusing its model cache.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> startWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final apiPath = r'/runpod/pods/current/start';

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

  /// Resume the current RunPod pod
  ///
  /// Start a previously stopped pod, reusing its model cache.
  Future<RunPodStateDto?> start() async {
    final response = await startWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'RunPodStateDto',) as RunPodStateDto;
    
    }
    return null;
  }

  /// Stop the current RunPod pod
  ///
  /// Stops the pod but keeps the model-cache volume so a future start is fast.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> stopWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final apiPath = r'/runpod/pods/current/stop';

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

  /// Stop the current RunPod pod
  ///
  /// Stops the pod but keeps the model-cache volume so a future start is fast.
  Future<RunPodStateDto?> stop() async {
    final response = await stopWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'RunPodStateDto',) as RunPodStateDto;
    
    }
    return null;
  }

  /// Terminate the current RunPod pod
  ///
  /// Destroys the pod and its persistent volume. Next launch is a full cold-start.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> terminateWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final apiPath = r'/runpod/pods/current';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


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

  /// Terminate the current RunPod pod
  ///
  /// Destroys the pod and its persistent volume. Next launch is a full cold-start.
  Future<RunPodStateDto?> terminate() async {
    final response = await terminateWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'RunPodStateDto',) as RunPodStateDto;
    
    }
    return null;
  }

  /// Test RunPod connection
  ///
  /// Verify that a RunPod API key works. Pass `apiKey` to test a candidate key without saving.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [RunPodConnectionTestDto] runPodConnectionTestDto (required):
  Future<Response> testConnectionWithHttpInfo(RunPodConnectionTestDto runPodConnectionTestDto,) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/runpod/connect';

    // ignore: prefer_final_locals
    Object? postBody = runPodConnectionTestDto;

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

  /// Test RunPod connection
  ///
  /// Verify that a RunPod API key works. Pass `apiKey` to test a candidate key without saving.
  ///
  /// Parameters:
  ///
  /// * [RunPodConnectionTestDto] runPodConnectionTestDto (required):
  Future<RunPodConnectionResultDto?> testConnection(RunPodConnectionTestDto runPodConnectionTestDto,) async {
    final response = await testConnectionWithHttpInfo(runPodConnectionTestDto,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'RunPodConnectionResultDto',) as RunPodConnectionResultDto;
    
    }
    return null;
  }
}

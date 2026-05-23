//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class SystemConfigApi {
  SystemConfigApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Get system configuration
  ///
  /// Retrieve the current system configuration.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getConfigWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final apiPath = r'/system-config';

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

  /// Get system configuration
  ///
  /// Retrieve the current system configuration.
  Future<SystemConfigDto?> getConfig() async {
    final response = await getConfigWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'SystemConfigDto',) as SystemConfigDto;
    
    }
    return null;
  }

  /// Get system configuration defaults
  ///
  /// Retrieve the default values for the system configuration.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getConfigDefaultsWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final apiPath = r'/system-config/defaults';

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

  /// Get system configuration defaults
  ///
  /// Retrieve the default values for the system configuration.
  Future<SystemConfigDto?> getConfigDefaults() async {
    final response = await getConfigDefaultsWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'SystemConfigDto',) as SystemConfigDto;
    
    }
    return null;
  }

  /// Estimate image description re-queue cost
  ///
  /// Returns asset counts and a rough time estimate for re-running the image description pipeline over all eligible assets.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getImageDescriptionRequeueEstimateWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final apiPath = r'/system-config/image-description/requeue-estimate';

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

  /// Estimate image description re-queue cost
  ///
  /// Returns asset counts and a rough time estimate for re-running the image description pipeline over all eligible assets.
  Future<ImageDescriptionRequeueEstimateDto?> getImageDescriptionRequeueEstimate() async {
    final response = await getImageDescriptionRequeueEstimateWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ImageDescriptionRequeueEstimateDto',) as ImageDescriptionRequeueEstimateDto;
    
    }
    return null;
  }

  /// Get machine learning hardware
  ///
  /// Retrieve available hardware acceleration providers from the machine learning service.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getMachineLearningHardwareWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final apiPath = r'/system-config/machine-learning/hardware';

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

  /// Get machine learning hardware
  ///
  /// Retrieve available hardware acceleration providers from the machine learning service.
  Future<MachineLearningHardwareResponseDto?> getMachineLearningHardware() async {
    final response = await getMachineLearningHardwareWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'MachineLearningHardwareResponseDto',) as MachineLearningHardwareResponseDto;
    
    }
    return null;
  }

  /// Get storage template options
  ///
  /// Retrieve exemplary storage template options.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getStorageTemplateOptionsWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final apiPath = r'/system-config/storage-template-options';

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

  /// Get storage template options
  ///
  /// Retrieve exemplary storage template options.
  Future<SystemConfigTemplateStorageOptionDto?> getStorageTemplateOptions() async {
    final response = await getStorageTemplateOptionsWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'SystemConfigTemplateStorageOptionDto',) as SystemConfigTemplateStorageOptionDto;
    
    }
    return null;
  }

  /// Trigger image description re-queue
  ///
  /// Enqueues a bulk re-queue of the image description pipeline for all eligible assets. Idempotent: if the queue-all job is already in-flight the call returns without re-enqueuing.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> triggerImageDescriptionRequeueWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final apiPath = r'/system-config/image-description/requeue';

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

  /// Trigger image description re-queue
  ///
  /// Enqueues a bulk re-queue of the image description pipeline for all eligible assets. Idempotent: if the queue-all job is already in-flight the call returns without re-enqueuing.
  Future<ImageDescriptionRequeueResponseDto?> triggerImageDescriptionRequeue() async {
    final response = await triggerImageDescriptionRequeueWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ImageDescriptionRequeueResponseDto',) as ImageDescriptionRequeueResponseDto;
    
    }
    return null;
  }

  /// Update system configuration
  ///
  /// Update the system configuration with a new system configuration.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [SystemConfigDto] systemConfigDto (required):
  Future<Response> updateConfigWithHttpInfo(SystemConfigDto systemConfigDto,) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/system-config';

    // ignore: prefer_final_locals
    Object? postBody = systemConfigDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'PUT',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
    );
  }

  /// Update system configuration
  ///
  /// Update the system configuration with a new system configuration.
  ///
  /// Parameters:
  ///
  /// * [SystemConfigDto] systemConfigDto (required):
  Future<SystemConfigDto?> updateConfig(SystemConfigDto systemConfigDto,) async {
    final response = await updateConfigWithHttpInfo(systemConfigDto,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'SystemConfigDto',) as SystemConfigDto;
    
    }
    return null;
  }
}

//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class MachineLearningHardwareResponseDto {
  /// Returns a new [MachineLearningHardwareResponseDto] instance.
  MachineLearningHardwareResponseDto({
    required this.cudaDeviceCount,
    this.openvinoDeviceIds = const [],
    required this.preferredAcceleration,
    this.providers = const [],
    required this.torchCudaAvailable,
  });

  /// Available PyTorch CUDA device count
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int cudaDeviceCount;

  /// Available OpenVINO device IDs
  List<String> openvinoDeviceIds;

  MachineLearningHardwareAcceleration preferredAcceleration;

  /// Available ONNX Runtime providers
  List<String> providers;

  /// Whether PyTorch CUDA is available
  bool torchCudaAvailable;

  @override
  bool operator ==(Object other) => identical(this, other) || other is MachineLearningHardwareResponseDto &&
    other.cudaDeviceCount == cudaDeviceCount &&
    _deepEquality.equals(other.openvinoDeviceIds, openvinoDeviceIds) &&
    other.preferredAcceleration == preferredAcceleration &&
    _deepEquality.equals(other.providers, providers) &&
    other.torchCudaAvailable == torchCudaAvailable;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (cudaDeviceCount.hashCode) +
    (openvinoDeviceIds.hashCode) +
    (preferredAcceleration.hashCode) +
    (providers.hashCode) +
    (torchCudaAvailable.hashCode);

  @override
  String toString() => 'MachineLearningHardwareResponseDto[cudaDeviceCount=$cudaDeviceCount, openvinoDeviceIds=$openvinoDeviceIds, preferredAcceleration=$preferredAcceleration, providers=$providers, torchCudaAvailable=$torchCudaAvailable]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'cudaDeviceCount'] = this.cudaDeviceCount;
      json[r'openvinoDeviceIds'] = this.openvinoDeviceIds;
      json[r'preferredAcceleration'] = this.preferredAcceleration;
      json[r'providers'] = this.providers;
      json[r'torchCudaAvailable'] = this.torchCudaAvailable;
    return json;
  }

  /// Returns a new [MachineLearningHardwareResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static MachineLearningHardwareResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "MachineLearningHardwareResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return MachineLearningHardwareResponseDto(
        cudaDeviceCount: mapValueOfType<int>(json, r'cudaDeviceCount')!,
        openvinoDeviceIds: json[r'openvinoDeviceIds'] is Iterable
            ? (json[r'openvinoDeviceIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        preferredAcceleration: MachineLearningHardwareAcceleration.fromJson(json[r'preferredAcceleration'])!,
        providers: json[r'providers'] is Iterable
            ? (json[r'providers'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        torchCudaAvailable: mapValueOfType<bool>(json, r'torchCudaAvailable')!,
      );
    }
    return null;
  }

  static List<MachineLearningHardwareResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <MachineLearningHardwareResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = MachineLearningHardwareResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, MachineLearningHardwareResponseDto> mapFromJson(dynamic json) {
    final map = <String, MachineLearningHardwareResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = MachineLearningHardwareResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of MachineLearningHardwareResponseDto-objects as value to a dart map
  static Map<String, List<MachineLearningHardwareResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<MachineLearningHardwareResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = MachineLearningHardwareResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'cudaDeviceCount',
    'openvinoDeviceIds',
    'preferredAcceleration',
    'providers',
    'torchCudaAvailable',
  };
}


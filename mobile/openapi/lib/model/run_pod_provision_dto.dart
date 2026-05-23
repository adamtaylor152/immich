//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class RunPodProvisionDto {
  /// Returns a new [RunPodProvisionDto] instance.
  RunPodProvisionDto({
    required this.acknowledgeDataPrivacy,
    this.gpuCount,
    required this.gpuTypeId,
    this.imageName,
    this.maxRuntimeHours,
  });

  /// User confirms image previews will be sent to RunPod (must be true to launch)
  bool acknowledgeDataPrivacy;

  /// Minimum value: 1
  /// Maximum value: 8
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? gpuCount;

  /// RunPod GPU type ID, e.g. \"NVIDIA RTX A5000\"
  String gpuTypeId;

  /// Override the configured image
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? imageName;

  /// Minimum value: 1
  /// Maximum value: 168
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? maxRuntimeHours;

  @override
  bool operator ==(Object other) => identical(this, other) || other is RunPodProvisionDto &&
    other.acknowledgeDataPrivacy == acknowledgeDataPrivacy &&
    other.gpuCount == gpuCount &&
    other.gpuTypeId == gpuTypeId &&
    other.imageName == imageName &&
    other.maxRuntimeHours == maxRuntimeHours;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (acknowledgeDataPrivacy.hashCode) +
    (gpuCount == null ? 0 : gpuCount!.hashCode) +
    (gpuTypeId.hashCode) +
    (imageName == null ? 0 : imageName!.hashCode) +
    (maxRuntimeHours == null ? 0 : maxRuntimeHours!.hashCode);

  @override
  String toString() => 'RunPodProvisionDto[acknowledgeDataPrivacy=$acknowledgeDataPrivacy, gpuCount=$gpuCount, gpuTypeId=$gpuTypeId, imageName=$imageName, maxRuntimeHours=$maxRuntimeHours]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'acknowledgeDataPrivacy'] = this.acknowledgeDataPrivacy;
    if (this.gpuCount != null) {
      json[r'gpuCount'] = this.gpuCount;
    } else {
    //  json[r'gpuCount'] = null;
    }
      json[r'gpuTypeId'] = this.gpuTypeId;
    if (this.imageName != null) {
      json[r'imageName'] = this.imageName;
    } else {
    //  json[r'imageName'] = null;
    }
    if (this.maxRuntimeHours != null) {
      json[r'maxRuntimeHours'] = this.maxRuntimeHours;
    } else {
    //  json[r'maxRuntimeHours'] = null;
    }
    return json;
  }

  /// Returns a new [RunPodProvisionDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static RunPodProvisionDto? fromJson(dynamic value) {
    upgradeDto(value, "RunPodProvisionDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return RunPodProvisionDto(
        acknowledgeDataPrivacy: mapValueOfType<bool>(json, r'acknowledgeDataPrivacy')!,
        gpuCount: mapValueOfType<int>(json, r'gpuCount'),
        gpuTypeId: mapValueOfType<String>(json, r'gpuTypeId')!,
        imageName: mapValueOfType<String>(json, r'imageName'),
        maxRuntimeHours: mapValueOfType<int>(json, r'maxRuntimeHours'),
      );
    }
    return null;
  }

  static List<RunPodProvisionDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <RunPodProvisionDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = RunPodProvisionDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, RunPodProvisionDto> mapFromJson(dynamic json) {
    final map = <String, RunPodProvisionDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = RunPodProvisionDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of RunPodProvisionDto-objects as value to a dart map
  static Map<String, List<RunPodProvisionDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<RunPodProvisionDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = RunPodProvisionDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'acknowledgeDataPrivacy',
    'gpuTypeId',
  };
}


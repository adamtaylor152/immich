//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class RunPodGpuTypeDto {
  /// Returns a new [RunPodGpuTypeDto] instance.
  RunPodGpuTypeDto({
    this.communityCloud,
    required this.displayName,
    required this.id,
    required this.memoryInGb,
    this.pricePerHour,
    this.secureCloud,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? communityCloud;

  String displayName;

  String id;

  num memoryInGb;

  num? pricePerHour;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? secureCloud;

  @override
  bool operator ==(Object other) => identical(this, other) || other is RunPodGpuTypeDto &&
    other.communityCloud == communityCloud &&
    other.displayName == displayName &&
    other.id == id &&
    other.memoryInGb == memoryInGb &&
    other.pricePerHour == pricePerHour &&
    other.secureCloud == secureCloud;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (communityCloud == null ? 0 : communityCloud!.hashCode) +
    (displayName.hashCode) +
    (id.hashCode) +
    (memoryInGb.hashCode) +
    (pricePerHour == null ? 0 : pricePerHour!.hashCode) +
    (secureCloud == null ? 0 : secureCloud!.hashCode);

  @override
  String toString() => 'RunPodGpuTypeDto[communityCloud=$communityCloud, displayName=$displayName, id=$id, memoryInGb=$memoryInGb, pricePerHour=$pricePerHour, secureCloud=$secureCloud]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.communityCloud != null) {
      json[r'communityCloud'] = this.communityCloud;
    } else {
    //  json[r'communityCloud'] = null;
    }
      json[r'displayName'] = this.displayName;
      json[r'id'] = this.id;
      json[r'memoryInGb'] = this.memoryInGb;
    if (this.pricePerHour != null) {
      json[r'pricePerHour'] = this.pricePerHour;
    } else {
    //  json[r'pricePerHour'] = null;
    }
    if (this.secureCloud != null) {
      json[r'secureCloud'] = this.secureCloud;
    } else {
    //  json[r'secureCloud'] = null;
    }
    return json;
  }

  /// Returns a new [RunPodGpuTypeDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static RunPodGpuTypeDto? fromJson(dynamic value) {
    upgradeDto(value, "RunPodGpuTypeDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return RunPodGpuTypeDto(
        communityCloud: mapValueOfType<bool>(json, r'communityCloud'),
        displayName: mapValueOfType<String>(json, r'displayName')!,
        id: mapValueOfType<String>(json, r'id')!,
        memoryInGb: num.parse('${json[r'memoryInGb']}'),
        pricePerHour: json[r'pricePerHour'] == null
            ? null
            : num.parse('${json[r'pricePerHour']}'),
        secureCloud: mapValueOfType<bool>(json, r'secureCloud'),
      );
    }
    return null;
  }

  static List<RunPodGpuTypeDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <RunPodGpuTypeDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = RunPodGpuTypeDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, RunPodGpuTypeDto> mapFromJson(dynamic json) {
    final map = <String, RunPodGpuTypeDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = RunPodGpuTypeDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of RunPodGpuTypeDto-objects as value to a dart map
  static Map<String, List<RunPodGpuTypeDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<RunPodGpuTypeDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = RunPodGpuTypeDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'displayName',
    'id',
    'memoryInGb',
  };
}


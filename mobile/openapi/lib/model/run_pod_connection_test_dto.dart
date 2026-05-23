//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class RunPodConnectionTestDto {
  /// Returns a new [RunPodConnectionTestDto] instance.
  RunPodConnectionTestDto({
    this.apiKey,
  });

  /// API key to verify (overrides the stored key for the test)
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? apiKey;

  @override
  bool operator ==(Object other) => identical(this, other) || other is RunPodConnectionTestDto &&
    other.apiKey == apiKey;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (apiKey == null ? 0 : apiKey!.hashCode);

  @override
  String toString() => 'RunPodConnectionTestDto[apiKey=$apiKey]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.apiKey != null) {
      json[r'apiKey'] = this.apiKey;
    } else {
    //  json[r'apiKey'] = null;
    }
    return json;
  }

  /// Returns a new [RunPodConnectionTestDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static RunPodConnectionTestDto? fromJson(dynamic value) {
    upgradeDto(value, "RunPodConnectionTestDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return RunPodConnectionTestDto(
        apiKey: mapValueOfType<String>(json, r'apiKey'),
      );
    }
    return null;
  }

  static List<RunPodConnectionTestDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <RunPodConnectionTestDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = RunPodConnectionTestDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, RunPodConnectionTestDto> mapFromJson(dynamic json) {
    final map = <String, RunPodConnectionTestDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = RunPodConnectionTestDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of RunPodConnectionTestDto-objects as value to a dart map
  static Map<String, List<RunPodConnectionTestDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<RunPodConnectionTestDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = RunPodConnectionTestDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SystemConfigLocalFeaturesDto {
  /// Returns a new [SystemConfigLocalFeaturesDto] instance.
  SystemConfigLocalFeaturesDto({
    required this.askSearch,
  });

  SystemConfigLocalFeaturesDtoAskSearch askSearch;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SystemConfigLocalFeaturesDto &&
    other.askSearch == askSearch;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (askSearch.hashCode);

  @override
  String toString() => 'SystemConfigLocalFeaturesDto[askSearch=$askSearch]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'askSearch'] = this.askSearch;
    return json;
  }

  /// Returns a new [SystemConfigLocalFeaturesDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SystemConfigLocalFeaturesDto? fromJson(dynamic value) {
    upgradeDto(value, "SystemConfigLocalFeaturesDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SystemConfigLocalFeaturesDto(
        askSearch: SystemConfigLocalFeaturesDtoAskSearch.fromJson(json[r'askSearch'])!,
      );
    }
    return null;
  }

  static List<SystemConfigLocalFeaturesDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SystemConfigLocalFeaturesDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SystemConfigLocalFeaturesDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SystemConfigLocalFeaturesDto> mapFromJson(dynamic json) {
    final map = <String, SystemConfigLocalFeaturesDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SystemConfigLocalFeaturesDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SystemConfigLocalFeaturesDto-objects as value to a dart map
  static Map<String, List<SystemConfigLocalFeaturesDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SystemConfigLocalFeaturesDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SystemConfigLocalFeaturesDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'askSearch',
  };
}


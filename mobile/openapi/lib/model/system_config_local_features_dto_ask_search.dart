//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SystemConfigLocalFeaturesDtoAskSearch {
  /// Returns a new [SystemConfigLocalFeaturesDtoAskSearch] instance.
  SystemConfigLocalFeaturesDtoAskSearch({
    required this.enabled,
    required this.maxResults,
  });

  /// Enable local Ask Photos-style search
  bool enabled;

  /// Maximum number of Ask Search results
  ///
  /// Minimum value: 1
  /// Maximum value: 1000
  int maxResults;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SystemConfigLocalFeaturesDtoAskSearch &&
    other.enabled == enabled &&
    other.maxResults == maxResults;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (enabled.hashCode) +
    (maxResults.hashCode);

  @override
  String toString() => 'SystemConfigLocalFeaturesDtoAskSearch[enabled=$enabled, maxResults=$maxResults]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'enabled'] = this.enabled;
      json[r'maxResults'] = this.maxResults;
    return json;
  }

  /// Returns a new [SystemConfigLocalFeaturesDtoAskSearch] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SystemConfigLocalFeaturesDtoAskSearch? fromJson(dynamic value) {
    upgradeDto(value, "SystemConfigLocalFeaturesDtoAskSearch");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SystemConfigLocalFeaturesDtoAskSearch(
        enabled: mapValueOfType<bool>(json, r'enabled')!,
        maxResults: mapValueOfType<int>(json, r'maxResults')!,
      );
    }
    return null;
  }

  static List<SystemConfigLocalFeaturesDtoAskSearch> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SystemConfigLocalFeaturesDtoAskSearch>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SystemConfigLocalFeaturesDtoAskSearch.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SystemConfigLocalFeaturesDtoAskSearch> mapFromJson(dynamic json) {
    final map = <String, SystemConfigLocalFeaturesDtoAskSearch>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SystemConfigLocalFeaturesDtoAskSearch.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SystemConfigLocalFeaturesDtoAskSearch-objects as value to a dart map
  static Map<String, List<SystemConfigLocalFeaturesDtoAskSearch>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SystemConfigLocalFeaturesDtoAskSearch>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SystemConfigLocalFeaturesDtoAskSearch.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'enabled',
    'maxResults',
  };
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ToggleParameters {
  /// Returns a new [ToggleParameters] instance.
  ToggleParameters({
    this.enabled = true,
  });

  bool enabled;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ToggleParameters &&
    other.enabled == enabled;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (enabled.hashCode);

  @override
  String toString() => 'ToggleParameters[enabled=$enabled]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'enabled'] = this.enabled;
    return json;
  }

  /// Returns a new [ToggleParameters] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ToggleParameters? fromJson(dynamic value) {
    upgradeDto(value, "ToggleParameters");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return ToggleParameters(
        enabled: mapValueOfType<bool>(json, r'enabled') ?? true,
      );
    }
    return null;
  }

  static List<ToggleParameters> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ToggleParameters>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ToggleParameters.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ToggleParameters> mapFromJson(dynamic json) {
    final map = <String, ToggleParameters>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ToggleParameters.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ToggleParameters-objects as value to a dart map
  static Map<String, List<ToggleParameters>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ToggleParameters>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ToggleParameters.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


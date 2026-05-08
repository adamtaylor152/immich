//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class LookParameters {
  /// Returns a new [LookParameters] instance.
  LookParameters({
    this.intensity = 100,
    required this.name,
  });

  /// Filter or effect intensity
  ///
  /// Minimum value: 0
  /// Maximum value: 100
  num intensity;

  /// Filter or effect name
  String name;

  @override
  bool operator ==(Object other) => identical(this, other) || other is LookParameters &&
    other.intensity == intensity &&
    other.name == name;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (intensity.hashCode) +
    (name.hashCode);

  @override
  String toString() => 'LookParameters[intensity=$intensity, name=$name]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'intensity'] = this.intensity;
      json[r'name'] = this.name;
    return json;
  }

  /// Returns a new [LookParameters] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static LookParameters? fromJson(dynamic value) {
    upgradeDto(value, "LookParameters");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return LookParameters(
        intensity: num.parse('${json[r'intensity']}'),
        name: mapValueOfType<String>(json, r'name')!,
      );
    }
    return null;
  }

  static List<LookParameters> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <LookParameters>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = LookParameters.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, LookParameters> mapFromJson(dynamic json) {
    final map = <String, LookParameters>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = LookParameters.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of LookParameters-objects as value to a dart map
  static Map<String, List<LookParameters>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<LookParameters>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = LookParameters.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'name',
  };
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class IdentityInjectionConfig {
  /// Returns a new [IdentityInjectionConfig] instance.
  IdentityInjectionConfig({
    this.enabled = true,
    this.maxNames = 5,
    this.minFaceConfidence = 0.7,
  });

  /// Inject named-face data into description prompts
  bool enabled;

  /// Maximum named persons to inject into a single prompt
  ///
  /// Minimum value: 1
  /// Maximum value: 20
  int maxNames;

  /// Minimum face-recognition confidence required to inject a name
  ///
  /// Minimum value: 0
  /// Maximum value: 1
  double minFaceConfidence;

  @override
  bool operator ==(Object other) => identical(this, other) || other is IdentityInjectionConfig &&
    other.enabled == enabled &&
    other.maxNames == maxNames &&
    other.minFaceConfidence == minFaceConfidence;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (enabled.hashCode) +
    (maxNames.hashCode) +
    (minFaceConfidence.hashCode);

  @override
  String toString() => 'IdentityInjectionConfig[enabled=$enabled, maxNames=$maxNames, minFaceConfidence=$minFaceConfidence]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'enabled'] = this.enabled;
      json[r'maxNames'] = this.maxNames;
      json[r'minFaceConfidence'] = this.minFaceConfidence;
    return json;
  }

  /// Returns a new [IdentityInjectionConfig] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static IdentityInjectionConfig? fromJson(dynamic value) {
    upgradeDto(value, "IdentityInjectionConfig");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return IdentityInjectionConfig(
        enabled: mapValueOfType<bool>(json, r'enabled') ?? true,
        maxNames: mapValueOfType<int>(json, r'maxNames') ?? 5,
        minFaceConfidence: (mapValueOfType<num>(json, r'minFaceConfidence') ?? 0.7).toDouble(),
      );
    }
    return null;
  }

  static List<IdentityInjectionConfig> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <IdentityInjectionConfig>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = IdentityInjectionConfig.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, IdentityInjectionConfig> mapFromJson(dynamic json) {
    final map = <String, IdentityInjectionConfig>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = IdentityInjectionConfig.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of IdentityInjectionConfig-objects as value to a dart map
  static Map<String, List<IdentityInjectionConfig>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<IdentityInjectionConfig>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = IdentityInjectionConfig.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


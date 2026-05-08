//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class StraightenParameters {
  /// Returns a new [StraightenParameters] instance.
  StraightenParameters({
    required this.angle,
  });

  /// Straighten angle in degrees
  ///
  /// Minimum value: -45
  /// Maximum value: 45
  num angle;

  @override
  bool operator ==(Object other) => identical(this, other) || other is StraightenParameters &&
    other.angle == angle;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (angle.hashCode);

  @override
  String toString() => 'StraightenParameters[angle=$angle]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'angle'] = this.angle;
    return json;
  }

  /// Returns a new [StraightenParameters] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static StraightenParameters? fromJson(dynamic value) {
    upgradeDto(value, "StraightenParameters");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return StraightenParameters(
        angle: num.parse('${json[r'angle']}'),
      );
    }
    return null;
  }

  static List<StraightenParameters> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <StraightenParameters>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = StraightenParameters.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, StraightenParameters> mapFromJson(dynamic json) {
    final map = <String, StraightenParameters>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = StraightenParameters.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of StraightenParameters-objects as value to a dart map
  static Map<String, List<StraightenParameters>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<StraightenParameters>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = StraightenParameters.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'angle',
  };
}


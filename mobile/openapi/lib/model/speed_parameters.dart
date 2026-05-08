//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SpeedParameters {
  /// Returns a new [SpeedParameters] instance.
  SpeedParameters({
    this.endMs,
    required this.rate,
    this.startMs,
  });

  /// Speed segment end time in milliseconds
  ///
  /// Minimum value: 1
  /// Maximum value: 9007199254740991
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? endMs;

  /// Playback speed multiplier
  ///
  /// Minimum value: 0.25
  /// Maximum value: 4
  num rate;

  /// Speed segment start time in milliseconds
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? startMs;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SpeedParameters &&
    other.endMs == endMs &&
    other.rate == rate &&
    other.startMs == startMs;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (endMs == null ? 0 : endMs!.hashCode) +
    (rate.hashCode) +
    (startMs == null ? 0 : startMs!.hashCode);

  @override
  String toString() => 'SpeedParameters[endMs=$endMs, rate=$rate, startMs=$startMs]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.endMs != null) {
      json[r'endMs'] = this.endMs;
    } else {
    //  json[r'endMs'] = null;
    }
      json[r'rate'] = this.rate;
    if (this.startMs != null) {
      json[r'startMs'] = this.startMs;
    } else {
    //  json[r'startMs'] = null;
    }
    return json;
  }

  /// Returns a new [SpeedParameters] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SpeedParameters? fromJson(dynamic value) {
    upgradeDto(value, "SpeedParameters");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SpeedParameters(
        endMs: mapValueOfType<int>(json, r'endMs'),
        rate: num.parse('${json[r'rate']}'),
        startMs: mapValueOfType<int>(json, r'startMs'),
      );
    }
    return null;
  }

  static List<SpeedParameters> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SpeedParameters>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SpeedParameters.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SpeedParameters> mapFromJson(dynamic json) {
    final map = <String, SpeedParameters>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SpeedParameters.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SpeedParameters-objects as value to a dart map
  static Map<String, List<SpeedParameters>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SpeedParameters>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SpeedParameters.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'rate',
  };
}


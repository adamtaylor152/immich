//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AudioParameters {
  /// Returns a new [AudioParameters] instance.
  AudioParameters({
    this.muted,
    this.volume,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? muted;

  /// Audio volume multiplier
  ///
  /// Minimum value: 0
  /// Maximum value: 2
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? volume;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AudioParameters &&
    other.muted == muted &&
    other.volume == volume;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (muted == null ? 0 : muted!.hashCode) +
    (volume == null ? 0 : volume!.hashCode);

  @override
  String toString() => 'AudioParameters[muted=$muted, volume=$volume]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.muted != null) {
      json[r'muted'] = this.muted;
    } else {
    //  json[r'muted'] = null;
    }
    if (this.volume != null) {
      json[r'volume'] = this.volume;
    } else {
    //  json[r'volume'] = null;
    }
    return json;
  }

  /// Returns a new [AudioParameters] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AudioParameters? fromJson(dynamic value) {
    upgradeDto(value, "AudioParameters");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AudioParameters(
        muted: mapValueOfType<bool>(json, r'muted'),
        volume: num.parse('${json[r'volume']}'),
      );
    }
    return null;
  }

  static List<AudioParameters> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AudioParameters>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AudioParameters.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AudioParameters> mapFromJson(dynamic json) {
    final map = <String, AudioParameters>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AudioParameters.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AudioParameters-objects as value to a dart map
  static Map<String, List<AudioParameters>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AudioParameters>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AudioParameters.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


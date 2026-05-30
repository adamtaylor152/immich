//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class LivePhotoRelinkResponseDto {
  /// Returns a new [LivePhotoRelinkResponseDto] instance.
  LivePhotoRelinkResponseDto({
    this.results = const [],
  });

  List<LivePhotoRelinkResultDto> results;

  @override
  bool operator ==(Object other) => identical(this, other) || other is LivePhotoRelinkResponseDto &&
    _deepEquality.equals(other.results, results);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (results.hashCode);

  @override
  String toString() => 'LivePhotoRelinkResponseDto[results=$results]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'results'] = this.results;
    return json;
  }

  /// Returns a new [LivePhotoRelinkResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static LivePhotoRelinkResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "LivePhotoRelinkResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return LivePhotoRelinkResponseDto(
        results: LivePhotoRelinkResultDto.listFromJson(json[r'results']),
      );
    }
    return null;
  }

  static List<LivePhotoRelinkResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <LivePhotoRelinkResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = LivePhotoRelinkResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, LivePhotoRelinkResponseDto> mapFromJson(dynamic json) {
    final map = <String, LivePhotoRelinkResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = LivePhotoRelinkResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of LivePhotoRelinkResponseDto-objects as value to a dart map
  static Map<String, List<LivePhotoRelinkResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<LivePhotoRelinkResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = LivePhotoRelinkResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'results',
  };
}


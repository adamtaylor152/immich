//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class LivePhotoRelinkDto {
  /// Returns a new [LivePhotoRelinkDto] instance.
  LivePhotoRelinkDto({
    this.pairs = const [],
  });

  List<LivePhotoRelinkItemDto> pairs;

  @override
  bool operator ==(Object other) => identical(this, other) || other is LivePhotoRelinkDto &&
    _deepEquality.equals(other.pairs, pairs);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (pairs.hashCode);

  @override
  String toString() => 'LivePhotoRelinkDto[pairs=$pairs]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'pairs'] = this.pairs;
    return json;
  }

  /// Returns a new [LivePhotoRelinkDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static LivePhotoRelinkDto? fromJson(dynamic value) {
    upgradeDto(value, "LivePhotoRelinkDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return LivePhotoRelinkDto(
        pairs: LivePhotoRelinkItemDto.listFromJson(json[r'pairs']),
      );
    }
    return null;
  }

  static List<LivePhotoRelinkDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <LivePhotoRelinkDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = LivePhotoRelinkDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, LivePhotoRelinkDto> mapFromJson(dynamic json) {
    final map = <String, LivePhotoRelinkDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = LivePhotoRelinkDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of LivePhotoRelinkDto-objects as value to a dart map
  static Map<String, List<LivePhotoRelinkDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<LivePhotoRelinkDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = LivePhotoRelinkDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'pairs',
  };
}


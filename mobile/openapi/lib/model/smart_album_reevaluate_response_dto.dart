//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SmartAlbumReevaluateResponseDto {
  /// Returns a new [SmartAlbumReevaluateResponseDto] instance.
  SmartAlbumReevaluateResponseDto({
    required this.queued,
  });

  /// Whether the re-evaluate job was newly enqueued (false = already in-flight)
  bool queued;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SmartAlbumReevaluateResponseDto &&
    other.queued == queued;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (queued.hashCode);

  @override
  String toString() => 'SmartAlbumReevaluateResponseDto[queued=$queued]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'queued'] = this.queued;
    return json;
  }

  /// Returns a new [SmartAlbumReevaluateResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SmartAlbumReevaluateResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "SmartAlbumReevaluateResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SmartAlbumReevaluateResponseDto(
        queued: mapValueOfType<bool>(json, r'queued')!,
      );
    }
    return null;
  }

  static List<SmartAlbumReevaluateResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SmartAlbumReevaluateResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SmartAlbumReevaluateResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SmartAlbumReevaluateResponseDto> mapFromJson(dynamic json) {
    final map = <String, SmartAlbumReevaluateResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SmartAlbumReevaluateResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SmartAlbumReevaluateResponseDto-objects as value to a dart map
  static Map<String, List<SmartAlbumReevaluateResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SmartAlbumReevaluateResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SmartAlbumReevaluateResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'queued',
  };
}


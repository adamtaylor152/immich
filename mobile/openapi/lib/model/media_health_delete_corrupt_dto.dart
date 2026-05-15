//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class MediaHealthDeleteCorruptDto {
  /// Returns a new [MediaHealthDeleteCorruptDto] instance.
  MediaHealthDeleteCorruptDto({
    required this.confirmText,
    this.ids = const [],
  });

  /// Typed confirmation text
  String confirmText;

  /// Media health finding IDs
  List<String> ids;

  @override
  bool operator ==(Object other) => identical(this, other) || other is MediaHealthDeleteCorruptDto &&
    other.confirmText == confirmText &&
    _deepEquality.equals(other.ids, ids);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (confirmText.hashCode) +
    (ids.hashCode);

  @override
  String toString() => 'MediaHealthDeleteCorruptDto[confirmText=$confirmText, ids=$ids]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'confirmText'] = this.confirmText;
      json[r'ids'] = this.ids;
    return json;
  }

  /// Returns a new [MediaHealthDeleteCorruptDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static MediaHealthDeleteCorruptDto? fromJson(dynamic value) {
    upgradeDto(value, "MediaHealthDeleteCorruptDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return MediaHealthDeleteCorruptDto(
        confirmText: mapValueOfType<String>(json, r'confirmText')!,
        ids: json[r'ids'] is Iterable
            ? (json[r'ids'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<MediaHealthDeleteCorruptDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <MediaHealthDeleteCorruptDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = MediaHealthDeleteCorruptDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, MediaHealthDeleteCorruptDto> mapFromJson(dynamic json) {
    final map = <String, MediaHealthDeleteCorruptDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = MediaHealthDeleteCorruptDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of MediaHealthDeleteCorruptDto-objects as value to a dart map
  static Map<String, List<MediaHealthDeleteCorruptDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<MediaHealthDeleteCorruptDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = MediaHealthDeleteCorruptDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'confirmText',
    'ids',
  };
}


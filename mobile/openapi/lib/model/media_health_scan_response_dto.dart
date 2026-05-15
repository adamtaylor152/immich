//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class MediaHealthScanResponseDto {
  /// Returns a new [MediaHealthScanResponseDto] instance.
  MediaHealthScanResponseDto({
    required this.runId,
  });

  String runId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is MediaHealthScanResponseDto &&
    other.runId == runId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (runId.hashCode);

  @override
  String toString() => 'MediaHealthScanResponseDto[runId=$runId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'runId'] = this.runId;
    return json;
  }

  /// Returns a new [MediaHealthScanResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static MediaHealthScanResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "MediaHealthScanResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return MediaHealthScanResponseDto(
        runId: mapValueOfType<String>(json, r'runId')!,
      );
    }
    return null;
  }

  static List<MediaHealthScanResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <MediaHealthScanResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = MediaHealthScanResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, MediaHealthScanResponseDto> mapFromJson(dynamic json) {
    final map = <String, MediaHealthScanResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = MediaHealthScanResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of MediaHealthScanResponseDto-objects as value to a dart map
  static Map<String, List<MediaHealthScanResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<MediaHealthScanResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = MediaHealthScanResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'runId',
  };
}


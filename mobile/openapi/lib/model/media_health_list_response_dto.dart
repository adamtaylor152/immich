//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class MediaHealthListResponseDto {
  /// Returns a new [MediaHealthListResponseDto] instance.
  MediaHealthListResponseDto({
    this.buckets = const [],
    required this.run,
    required this.total,
  });

  List<MediaHealthBucketDto> buckets;

  MediaHealthRunResponseDto? run;

  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int total;

  @override
  bool operator ==(Object other) => identical(this, other) || other is MediaHealthListResponseDto &&
    _deepEquality.equals(other.buckets, buckets) &&
    other.run == run &&
    other.total == total;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (buckets.hashCode) +
    (run == null ? 0 : run!.hashCode) +
    (total.hashCode);

  @override
  String toString() => 'MediaHealthListResponseDto[buckets=$buckets, run=$run, total=$total]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'buckets'] = this.buckets;
    if (this.run != null) {
      json[r'run'] = this.run;
    } else {
    //  json[r'run'] = null;
    }
      json[r'total'] = this.total;
    return json;
  }

  /// Returns a new [MediaHealthListResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static MediaHealthListResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "MediaHealthListResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return MediaHealthListResponseDto(
        buckets: MediaHealthBucketDto.listFromJson(json[r'buckets']),
        run: MediaHealthRunResponseDto.fromJson(json[r'run']),
        total: mapValueOfType<int>(json, r'total')!,
      );
    }
    return null;
  }

  static List<MediaHealthListResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <MediaHealthListResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = MediaHealthListResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, MediaHealthListResponseDto> mapFromJson(dynamic json) {
    final map = <String, MediaHealthListResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = MediaHealthListResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of MediaHealthListResponseDto-objects as value to a dart map
  static Map<String, List<MediaHealthListResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<MediaHealthListResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = MediaHealthListResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'buckets',
    'run',
    'total',
  };
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class MediaHealthBucketDto {
  /// Returns a new [MediaHealthBucketDto] instance.
  MediaHealthBucketDto({
    required this.count,
    this.items = const [],
    required this.timeBucket,
  });

  /// Number of findings in the bucket
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int count;

  List<MediaHealthItemDto> items;

  /// Timeline bucket date
  String timeBucket;

  @override
  bool operator ==(Object other) => identical(this, other) || other is MediaHealthBucketDto &&
    other.count == count &&
    _deepEquality.equals(other.items, items) &&
    other.timeBucket == timeBucket;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (count.hashCode) +
    (items.hashCode) +
    (timeBucket.hashCode);

  @override
  String toString() => 'MediaHealthBucketDto[count=$count, items=$items, timeBucket=$timeBucket]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'count'] = this.count;
      json[r'items'] = this.items;
      json[r'timeBucket'] = this.timeBucket;
    return json;
  }

  /// Returns a new [MediaHealthBucketDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static MediaHealthBucketDto? fromJson(dynamic value) {
    upgradeDto(value, "MediaHealthBucketDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return MediaHealthBucketDto(
        count: mapValueOfType<int>(json, r'count')!,
        items: MediaHealthItemDto.listFromJson(json[r'items']),
        timeBucket: mapValueOfType<String>(json, r'timeBucket')!,
      );
    }
    return null;
  }

  static List<MediaHealthBucketDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <MediaHealthBucketDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = MediaHealthBucketDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, MediaHealthBucketDto> mapFromJson(dynamic json) {
    final map = <String, MediaHealthBucketDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = MediaHealthBucketDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of MediaHealthBucketDto-objects as value to a dart map
  static Map<String, List<MediaHealthBucketDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<MediaHealthBucketDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = MediaHealthBucketDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'count',
    'items',
    'timeBucket',
  };
}


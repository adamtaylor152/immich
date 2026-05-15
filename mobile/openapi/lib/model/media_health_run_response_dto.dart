//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class MediaHealthRunResponseDto {
  /// Returns a new [MediaHealthRunResponseDto] instance.
  MediaHealthRunResponseDto({
    required this.category,
    required this.checkedAssets,
    required this.error,
    required this.finishedAt,
    required this.foundAssets,
    required this.id,
    required this.startedAt,
    required this.status,
    required this.totalAssets,
  });

  MediaHealthCategory category;

  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int checkedAssets;

  String? error;

  DateTime? finishedAt;

  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int foundAssets;

  /// Media health run ID
  String id;

  DateTime startedAt;

  /// Run status
  String status;

  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int totalAssets;

  @override
  bool operator ==(Object other) => identical(this, other) || other is MediaHealthRunResponseDto &&
    other.category == category &&
    other.checkedAssets == checkedAssets &&
    other.error == error &&
    other.finishedAt == finishedAt &&
    other.foundAssets == foundAssets &&
    other.id == id &&
    other.startedAt == startedAt &&
    other.status == status &&
    other.totalAssets == totalAssets;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (category.hashCode) +
    (checkedAssets.hashCode) +
    (error == null ? 0 : error!.hashCode) +
    (finishedAt == null ? 0 : finishedAt!.hashCode) +
    (foundAssets.hashCode) +
    (id.hashCode) +
    (startedAt.hashCode) +
    (status.hashCode) +
    (totalAssets.hashCode);

  @override
  String toString() => 'MediaHealthRunResponseDto[category=$category, checkedAssets=$checkedAssets, error=$error, finishedAt=$finishedAt, foundAssets=$foundAssets, id=$id, startedAt=$startedAt, status=$status, totalAssets=$totalAssets]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'category'] = this.category;
      json[r'checkedAssets'] = this.checkedAssets;
    if (this.error != null) {
      json[r'error'] = this.error;
    } else {
    //  json[r'error'] = null;
    }
    if (this.finishedAt != null) {
      json[r'finishedAt'] = this.finishedAt!.toUtc().toIso8601String();
    } else {
    //  json[r'finishedAt'] = null;
    }
      json[r'foundAssets'] = this.foundAssets;
      json[r'id'] = this.id;
      json[r'startedAt'] = this.startedAt.toUtc().toIso8601String();
      json[r'status'] = this.status;
      json[r'totalAssets'] = this.totalAssets;
    return json;
  }

  /// Returns a new [MediaHealthRunResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static MediaHealthRunResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "MediaHealthRunResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return MediaHealthRunResponseDto(
        category: MediaHealthCategory.fromJson(json[r'category'])!,
        checkedAssets: mapValueOfType<int>(json, r'checkedAssets')!,
        error: mapValueOfType<String>(json, r'error'),
        finishedAt: mapDateTime(json, r'finishedAt', r''),
        foundAssets: mapValueOfType<int>(json, r'foundAssets')!,
        id: mapValueOfType<String>(json, r'id')!,
        startedAt: mapDateTime(json, r'startedAt', r'')!,
        status: mapValueOfType<String>(json, r'status')!,
        totalAssets: mapValueOfType<int>(json, r'totalAssets')!,
      );
    }
    return null;
  }

  static List<MediaHealthRunResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <MediaHealthRunResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = MediaHealthRunResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, MediaHealthRunResponseDto> mapFromJson(dynamic json) {
    final map = <String, MediaHealthRunResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = MediaHealthRunResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of MediaHealthRunResponseDto-objects as value to a dart map
  static Map<String, List<MediaHealthRunResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<MediaHealthRunResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = MediaHealthRunResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'category',
    'checkedAssets',
    'error',
    'finishedAt',
    'foundAssets',
    'id',
    'startedAt',
    'status',
    'totalAssets',
  };
}


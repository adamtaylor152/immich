//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class LivePhotoRelinkResultDto {
  /// Returns a new [LivePhotoRelinkResultDto] instance.
  LivePhotoRelinkResultDto({
    this.error,
    required this.photoId,
    required this.success,
    required this.videoId,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? error;

  String photoId;

  bool success;

  String videoId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is LivePhotoRelinkResultDto &&
    other.error == error &&
    other.photoId == photoId &&
    other.success == success &&
    other.videoId == videoId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (error == null ? 0 : error!.hashCode) +
    (photoId.hashCode) +
    (success.hashCode) +
    (videoId.hashCode);

  @override
  String toString() => 'LivePhotoRelinkResultDto[error=$error, photoId=$photoId, success=$success, videoId=$videoId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.error != null) {
      json[r'error'] = this.error;
    } else {
    //  json[r'error'] = null;
    }
      json[r'photoId'] = this.photoId;
      json[r'success'] = this.success;
      json[r'videoId'] = this.videoId;
    return json;
  }

  /// Returns a new [LivePhotoRelinkResultDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static LivePhotoRelinkResultDto? fromJson(dynamic value) {
    upgradeDto(value, "LivePhotoRelinkResultDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return LivePhotoRelinkResultDto(
        error: mapValueOfType<String>(json, r'error'),
        photoId: mapValueOfType<String>(json, r'photoId')!,
        success: mapValueOfType<bool>(json, r'success')!,
        videoId: mapValueOfType<String>(json, r'videoId')!,
      );
    }
    return null;
  }

  static List<LivePhotoRelinkResultDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <LivePhotoRelinkResultDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = LivePhotoRelinkResultDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, LivePhotoRelinkResultDto> mapFromJson(dynamic json) {
    final map = <String, LivePhotoRelinkResultDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = LivePhotoRelinkResultDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of LivePhotoRelinkResultDto-objects as value to a dart map
  static Map<String, List<LivePhotoRelinkResultDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<LivePhotoRelinkResultDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = LivePhotoRelinkResultDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'photoId',
    'success',
    'videoId',
  };
}


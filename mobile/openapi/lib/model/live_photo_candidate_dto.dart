//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class LivePhotoCandidateDto {
  /// Returns a new [LivePhotoCandidateDto] instance.
  LivePhotoCandidateDto({
    required this.confidence,
    required this.matchReason,
    required this.photo,
    required this.video,
  });

  LivePhotoMatchConfidence confidence;

  /// Why these two assets are believed to be a separated live photo pair
  String matchReason;

  AssetResponseDto photo;

  AssetResponseDto video;

  @override
  bool operator ==(Object other) => identical(this, other) || other is LivePhotoCandidateDto &&
    other.confidence == confidence &&
    other.matchReason == matchReason &&
    other.photo == photo &&
    other.video == video;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (confidence.hashCode) +
    (matchReason.hashCode) +
    (photo.hashCode) +
    (video.hashCode);

  @override
  String toString() => 'LivePhotoCandidateDto[confidence=$confidence, matchReason=$matchReason, photo=$photo, video=$video]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'confidence'] = this.confidence;
      json[r'matchReason'] = this.matchReason;
      json[r'photo'] = this.photo;
      json[r'video'] = this.video;
    return json;
  }

  /// Returns a new [LivePhotoCandidateDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static LivePhotoCandidateDto? fromJson(dynamic value) {
    upgradeDto(value, "LivePhotoCandidateDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return LivePhotoCandidateDto(
        confidence: LivePhotoMatchConfidence.fromJson(json[r'confidence'])!,
        matchReason: mapValueOfType<String>(json, r'matchReason')!,
        photo: AssetResponseDto.fromJson(json[r'photo'])!,
        video: AssetResponseDto.fromJson(json[r'video'])!,
      );
    }
    return null;
  }

  static List<LivePhotoCandidateDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <LivePhotoCandidateDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = LivePhotoCandidateDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, LivePhotoCandidateDto> mapFromJson(dynamic json) {
    final map = <String, LivePhotoCandidateDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = LivePhotoCandidateDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of LivePhotoCandidateDto-objects as value to a dart map
  static Map<String, List<LivePhotoCandidateDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<LivePhotoCandidateDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = LivePhotoCandidateDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'confidence',
    'matchReason',
    'photo',
    'video',
  };
}


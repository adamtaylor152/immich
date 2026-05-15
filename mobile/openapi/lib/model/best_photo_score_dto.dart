//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class BestPhotoScoreDto {
  /// Returns a new [BestPhotoScoreDto] instance.
  BestPhotoScoreDto({
    required this.aestheticScore,
    required this.bestFrameTimestampMs,
    required this.computedAt,
    required this.diversityScore,
    this.frameMetadata = const {},
    required this.frameScore,
    this.metadata = const {},
    required this.score,
    required this.scoreVersion,
    required this.subjectScore,
    required this.technicalScore,
  });

  /// Minimum value: 0
  /// Maximum value: 1
  num? aestheticScore;

  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int? bestFrameTimestampMs;

  DateTime computedAt;

  /// Minimum value: 0
  /// Maximum value: 1
  num? diversityScore;

  Map<String, Object>? frameMetadata;

  /// Minimum value: 0
  /// Maximum value: 1
  num? frameScore;

  Map<String, Object>? metadata;

  /// Minimum value: 0
  /// Maximum value: 1
  num score;

  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int scoreVersion;

  /// Minimum value: 0
  /// Maximum value: 1
  num? subjectScore;

  /// Minimum value: 0
  /// Maximum value: 1
  num? technicalScore;

  @override
  bool operator ==(Object other) => identical(this, other) || other is BestPhotoScoreDto &&
    other.aestheticScore == aestheticScore &&
    other.bestFrameTimestampMs == bestFrameTimestampMs &&
    other.computedAt == computedAt &&
    other.diversityScore == diversityScore &&
    _deepEquality.equals(other.frameMetadata, frameMetadata) &&
    other.frameScore == frameScore &&
    _deepEquality.equals(other.metadata, metadata) &&
    other.score == score &&
    other.scoreVersion == scoreVersion &&
    other.subjectScore == subjectScore &&
    other.technicalScore == technicalScore;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (aestheticScore == null ? 0 : aestheticScore!.hashCode) +
    (bestFrameTimestampMs == null ? 0 : bestFrameTimestampMs!.hashCode) +
    (computedAt.hashCode) +
    (diversityScore == null ? 0 : diversityScore!.hashCode) +
    (frameMetadata == null ? 0 : frameMetadata!.hashCode) +
    (frameScore == null ? 0 : frameScore!.hashCode) +
    (metadata == null ? 0 : metadata!.hashCode) +
    (score.hashCode) +
    (scoreVersion.hashCode) +
    (subjectScore == null ? 0 : subjectScore!.hashCode) +
    (technicalScore == null ? 0 : technicalScore!.hashCode);

  @override
  String toString() => 'BestPhotoScoreDto[aestheticScore=$aestheticScore, bestFrameTimestampMs=$bestFrameTimestampMs, computedAt=$computedAt, diversityScore=$diversityScore, frameMetadata=$frameMetadata, frameScore=$frameScore, metadata=$metadata, score=$score, scoreVersion=$scoreVersion, subjectScore=$subjectScore, technicalScore=$technicalScore]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.aestheticScore != null) {
      json[r'aestheticScore'] = this.aestheticScore;
    } else {
    //  json[r'aestheticScore'] = null;
    }
    if (this.bestFrameTimestampMs != null) {
      json[r'bestFrameTimestampMs'] = this.bestFrameTimestampMs;
    } else {
    //  json[r'bestFrameTimestampMs'] = null;
    }
      json[r'computedAt'] = this.computedAt.toUtc().toIso8601String();
    if (this.diversityScore != null) {
      json[r'diversityScore'] = this.diversityScore;
    } else {
    //  json[r'diversityScore'] = null;
    }
    if (this.frameMetadata != null) {
      json[r'frameMetadata'] = this.frameMetadata;
    } else {
    //  json[r'frameMetadata'] = null;
    }
    if (this.frameScore != null) {
      json[r'frameScore'] = this.frameScore;
    } else {
    //  json[r'frameScore'] = null;
    }
    if (this.metadata != null) {
      json[r'metadata'] = this.metadata;
    } else {
    //  json[r'metadata'] = null;
    }
      json[r'score'] = this.score;
      json[r'scoreVersion'] = this.scoreVersion;
    if (this.subjectScore != null) {
      json[r'subjectScore'] = this.subjectScore;
    } else {
    //  json[r'subjectScore'] = null;
    }
    if (this.technicalScore != null) {
      json[r'technicalScore'] = this.technicalScore;
    } else {
    //  json[r'technicalScore'] = null;
    }
    return json;
  }

  /// Returns a new [BestPhotoScoreDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static BestPhotoScoreDto? fromJson(dynamic value) {
    upgradeDto(value, "BestPhotoScoreDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return BestPhotoScoreDto(
        aestheticScore: json[r'aestheticScore'] == null
            ? null
            : num.parse('${json[r'aestheticScore']}'),
        bestFrameTimestampMs: mapValueOfType<int>(json, r'bestFrameTimestampMs'),
        computedAt: mapDateTime(json, r'computedAt', r'')!,
        diversityScore: json[r'diversityScore'] == null
            ? null
            : num.parse('${json[r'diversityScore']}'),
        frameMetadata: mapCastOfType<String, Object>(json, r'frameMetadata'),
        frameScore: json[r'frameScore'] == null
            ? null
            : num.parse('${json[r'frameScore']}'),
        metadata: mapCastOfType<String, Object>(json, r'metadata'),
        score: num.parse('${json[r'score']}'),
        scoreVersion: mapValueOfType<int>(json, r'scoreVersion')!,
        subjectScore: json[r'subjectScore'] == null
            ? null
            : num.parse('${json[r'subjectScore']}'),
        technicalScore: json[r'technicalScore'] == null
            ? null
            : num.parse('${json[r'technicalScore']}'),
      );
    }
    return null;
  }

  static List<BestPhotoScoreDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <BestPhotoScoreDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = BestPhotoScoreDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, BestPhotoScoreDto> mapFromJson(dynamic json) {
    final map = <String, BestPhotoScoreDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = BestPhotoScoreDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of BestPhotoScoreDto-objects as value to a dart map
  static Map<String, List<BestPhotoScoreDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<BestPhotoScoreDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = BestPhotoScoreDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'aestheticScore',
    'bestFrameTimestampMs',
    'computedAt',
    'diversityScore',
    'frameMetadata',
    'frameScore',
    'metadata',
    'score',
    'scoreVersion',
    'subjectScore',
    'technicalScore',
  };
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class MediaHealthCandidateDto {
  /// Returns a new [MediaHealthCandidateDto] instance.
  MediaHealthCandidateDto({
    required this.candidatePath,
    required this.checkedAt,
    this.evidence = const {},
    required this.healthId,
    required this.id,
    this.resolution = const {},
    required this.status,
    required this.visualMatchScore,
  });

  /// Candidate file path
  String candidatePath;

  DateTime checkedAt;

  Map<String, Object> evidence;

  /// Media health finding ID
  String healthId;

  /// Candidate ID
  String id;

  Map<String, Object> resolution;

  MediaHealthStatus status;

  /// Visual match score from 0 to 1
  num? visualMatchScore;

  @override
  bool operator ==(Object other) => identical(this, other) || other is MediaHealthCandidateDto &&
    other.candidatePath == candidatePath &&
    other.checkedAt == checkedAt &&
    _deepEquality.equals(other.evidence, evidence) &&
    other.healthId == healthId &&
    other.id == id &&
    _deepEquality.equals(other.resolution, resolution) &&
    other.status == status &&
    other.visualMatchScore == visualMatchScore;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (candidatePath.hashCode) +
    (checkedAt.hashCode) +
    (evidence.hashCode) +
    (healthId.hashCode) +
    (id.hashCode) +
    (resolution.hashCode) +
    (status.hashCode) +
    (visualMatchScore == null ? 0 : visualMatchScore!.hashCode);

  @override
  String toString() => 'MediaHealthCandidateDto[candidatePath=$candidatePath, checkedAt=$checkedAt, evidence=$evidence, healthId=$healthId, id=$id, resolution=$resolution, status=$status, visualMatchScore=$visualMatchScore]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'candidatePath'] = this.candidatePath;
      json[r'checkedAt'] = this.checkedAt.toUtc().toIso8601String();
      json[r'evidence'] = this.evidence;
      json[r'healthId'] = this.healthId;
      json[r'id'] = this.id;
      json[r'resolution'] = this.resolution;
      json[r'status'] = this.status;
    if (this.visualMatchScore != null) {
      json[r'visualMatchScore'] = this.visualMatchScore;
    } else {
    //  json[r'visualMatchScore'] = null;
    }
    return json;
  }

  /// Returns a new [MediaHealthCandidateDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static MediaHealthCandidateDto? fromJson(dynamic value) {
    upgradeDto(value, "MediaHealthCandidateDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return MediaHealthCandidateDto(
        candidatePath: mapValueOfType<String>(json, r'candidatePath')!,
        checkedAt: mapDateTime(json, r'checkedAt', r'')!,
        evidence: mapCastOfType<String, Object>(json, r'evidence')!,
        healthId: mapValueOfType<String>(json, r'healthId')!,
        id: mapValueOfType<String>(json, r'id')!,
        resolution: mapCastOfType<String, Object>(json, r'resolution')!,
        status: MediaHealthStatus.fromJson(json[r'status'])!,
        visualMatchScore: json[r'visualMatchScore'] == null
            ? null
            : num.parse('${json[r'visualMatchScore']}'),
      );
    }
    return null;
  }

  static List<MediaHealthCandidateDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <MediaHealthCandidateDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = MediaHealthCandidateDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, MediaHealthCandidateDto> mapFromJson(dynamic json) {
    final map = <String, MediaHealthCandidateDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = MediaHealthCandidateDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of MediaHealthCandidateDto-objects as value to a dart map
  static Map<String, List<MediaHealthCandidateDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<MediaHealthCandidateDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = MediaHealthCandidateDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'candidatePath',
    'checkedAt',
    'evidence',
    'healthId',
    'id',
    'resolution',
    'status',
    'visualMatchScore',
  };
}


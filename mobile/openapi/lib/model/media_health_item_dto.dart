//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class MediaHealthItemDto {
  /// Returns a new [MediaHealthItemDto] instance.
  MediaHealthItemDto({
    required this.asset,
    required this.assetId,
    this.candidates = const [],
    required this.category,
    required this.checkedAt,
    required this.dismissedAt,
    this.evidence = const {},
    required this.id,
    required this.originalFileName,
    required this.originalPath,
    this.resolution = const {},
    required this.resolvedAt,
    required this.severity,
    required this.status,
  });

  AssetResponseDto asset;

  /// Asset ID
  String assetId;

  List<MediaHealthCandidateDto> candidates;

  MediaHealthCategory category;

  DateTime checkedAt;

  DateTime? dismissedAt;

  Map<String, Object> evidence;

  /// Media health finding ID
  String id;

  /// Original media filename
  String originalFileName;

  /// Original media path
  String originalPath;

  Map<String, Object> resolution;

  DateTime? resolvedAt;

  MediaHealthSeverity severity;

  MediaHealthStatus status;

  @override
  bool operator ==(Object other) => identical(this, other) || other is MediaHealthItemDto &&
    other.asset == asset &&
    other.assetId == assetId &&
    _deepEquality.equals(other.candidates, candidates) &&
    other.category == category &&
    other.checkedAt == checkedAt &&
    other.dismissedAt == dismissedAt &&
    _deepEquality.equals(other.evidence, evidence) &&
    other.id == id &&
    other.originalFileName == originalFileName &&
    other.originalPath == originalPath &&
    _deepEquality.equals(other.resolution, resolution) &&
    other.resolvedAt == resolvedAt &&
    other.severity == severity &&
    other.status == status;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (asset.hashCode) +
    (assetId.hashCode) +
    (candidates.hashCode) +
    (category.hashCode) +
    (checkedAt.hashCode) +
    (dismissedAt == null ? 0 : dismissedAt!.hashCode) +
    (evidence.hashCode) +
    (id.hashCode) +
    (originalFileName.hashCode) +
    (originalPath.hashCode) +
    (resolution.hashCode) +
    (resolvedAt == null ? 0 : resolvedAt!.hashCode) +
    (severity.hashCode) +
    (status.hashCode);

  @override
  String toString() => 'MediaHealthItemDto[asset=$asset, assetId=$assetId, candidates=$candidates, category=$category, checkedAt=$checkedAt, dismissedAt=$dismissedAt, evidence=$evidence, id=$id, originalFileName=$originalFileName, originalPath=$originalPath, resolution=$resolution, resolvedAt=$resolvedAt, severity=$severity, status=$status]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'asset'] = this.asset;
      json[r'assetId'] = this.assetId;
      json[r'candidates'] = this.candidates;
      json[r'category'] = this.category;
      json[r'checkedAt'] = this.checkedAt.toUtc().toIso8601String();
    if (this.dismissedAt != null) {
      json[r'dismissedAt'] = this.dismissedAt!.toUtc().toIso8601String();
    } else {
    //  json[r'dismissedAt'] = null;
    }
      json[r'evidence'] = this.evidence;
      json[r'id'] = this.id;
      json[r'originalFileName'] = this.originalFileName;
      json[r'originalPath'] = this.originalPath;
      json[r'resolution'] = this.resolution;
    if (this.resolvedAt != null) {
      json[r'resolvedAt'] = this.resolvedAt!.toUtc().toIso8601String();
    } else {
    //  json[r'resolvedAt'] = null;
    }
      json[r'severity'] = this.severity;
      json[r'status'] = this.status;
    return json;
  }

  /// Returns a new [MediaHealthItemDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static MediaHealthItemDto? fromJson(dynamic value) {
    upgradeDto(value, "MediaHealthItemDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return MediaHealthItemDto(
        asset: AssetResponseDto.fromJson(json[r'asset'])!,
        assetId: mapValueOfType<String>(json, r'assetId')!,
        candidates: MediaHealthCandidateDto.listFromJson(json[r'candidates']),
        category: MediaHealthCategory.fromJson(json[r'category'])!,
        checkedAt: mapDateTime(json, r'checkedAt', r'')!,
        dismissedAt: mapDateTime(json, r'dismissedAt', r''),
        evidence: mapCastOfType<String, Object>(json, r'evidence')!,
        id: mapValueOfType<String>(json, r'id')!,
        originalFileName: mapValueOfType<String>(json, r'originalFileName')!,
        originalPath: mapValueOfType<String>(json, r'originalPath')!,
        resolution: mapCastOfType<String, Object>(json, r'resolution')!,
        resolvedAt: mapDateTime(json, r'resolvedAt', r''),
        severity: MediaHealthSeverity.fromJson(json[r'severity'])!,
        status: MediaHealthStatus.fromJson(json[r'status'])!,
      );
    }
    return null;
  }

  static List<MediaHealthItemDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <MediaHealthItemDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = MediaHealthItemDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, MediaHealthItemDto> mapFromJson(dynamic json) {
    final map = <String, MediaHealthItemDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = MediaHealthItemDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of MediaHealthItemDto-objects as value to a dart map
  static Map<String, List<MediaHealthItemDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<MediaHealthItemDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = MediaHealthItemDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'asset',
    'assetId',
    'candidates',
    'category',
    'checkedAt',
    'dismissedAt',
    'evidence',
    'id',
    'originalFileName',
    'originalPath',
    'resolution',
    'resolvedAt',
    'severity',
    'status',
  };
}


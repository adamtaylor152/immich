//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class NsfwDetectionEnrichmentResponseDto {
  /// Returns a new [NsfwDetectionEnrichmentResponseDto] instance.
  NsfwDetectionEnrichmentResponseDto({
    required this.appliedTags,
    required this.effectiveIsNsfw,
    this.error,
    this.isNsfw,
    this.labels = const {},
    this.modelName,
    this.review,
    this.score,
    required this.status,
    this.updatedAt,
  });

  bool appliedTags;

  bool effectiveIsNsfw;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? error;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? isNsfw;

  Map<String, num> labels;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? modelName;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  ImageEnrichmentReview? review;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? score;

  NsfwDetectionEnrichmentResponseDtoStatusEnum status;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? updatedAt;

  @override
  bool operator ==(Object other) => identical(this, other) || other is NsfwDetectionEnrichmentResponseDto &&
    other.appliedTags == appliedTags &&
    other.effectiveIsNsfw == effectiveIsNsfw &&
    other.error == error &&
    other.isNsfw == isNsfw &&
    _deepEquality.equals(other.labels, labels) &&
    other.modelName == modelName &&
    other.review == review &&
    other.score == score &&
    other.status == status &&
    other.updatedAt == updatedAt;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (appliedTags.hashCode) +
    (effectiveIsNsfw.hashCode) +
    (error == null ? 0 : error!.hashCode) +
    (isNsfw == null ? 0 : isNsfw!.hashCode) +
    (labels.hashCode) +
    (modelName == null ? 0 : modelName!.hashCode) +
    (review == null ? 0 : review!.hashCode) +
    (score == null ? 0 : score!.hashCode) +
    (status.hashCode) +
    (updatedAt == null ? 0 : updatedAt!.hashCode);

  @override
  String toString() => 'NsfwDetectionEnrichmentResponseDto[appliedTags=$appliedTags, effectiveIsNsfw=$effectiveIsNsfw, error=$error, isNsfw=$isNsfw, labels=$labels, modelName=$modelName, review=$review, score=$score, status=$status, updatedAt=$updatedAt]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'appliedTags'] = this.appliedTags;
      json[r'effectiveIsNsfw'] = this.effectiveIsNsfw;
    if (this.error != null) {
      json[r'error'] = this.error;
    } else {
    //  json[r'error'] = null;
    }
    if (this.isNsfw != null) {
      json[r'isNsfw'] = this.isNsfw;
    } else {
    //  json[r'isNsfw'] = null;
    }
      json[r'labels'] = this.labels;
    if (this.modelName != null) {
      json[r'modelName'] = this.modelName;
    } else {
    //  json[r'modelName'] = null;
    }
    if (this.review != null) {
      json[r'review'] = this.review;
    } else {
    //  json[r'review'] = null;
    }
    if (this.score != null) {
      json[r'score'] = this.score;
    } else {
    //  json[r'score'] = null;
    }
      json[r'status'] = this.status;
    if (this.updatedAt != null) {
      json[r'updatedAt'] = this.updatedAt;
    } else {
    //  json[r'updatedAt'] = null;
    }
    return json;
  }

  /// Returns a new [NsfwDetectionEnrichmentResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static NsfwDetectionEnrichmentResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "NsfwDetectionEnrichmentResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return NsfwDetectionEnrichmentResponseDto(
        appliedTags: mapValueOfType<bool>(json, r'appliedTags')!,
        effectiveIsNsfw: mapValueOfType<bool>(json, r'effectiveIsNsfw')!,
        error: mapValueOfType<String>(json, r'error'),
        isNsfw: mapValueOfType<bool>(json, r'isNsfw'),
        labels: mapCastOfType<String, num>(json, r'labels') ?? const {},
        modelName: mapValueOfType<String>(json, r'modelName'),
        review: ImageEnrichmentReview.fromJson(json[r'review']),
        score: json[r'score'] == null
            ? null
            : num.parse('${json[r'score']}'),
        status: NsfwDetectionEnrichmentResponseDtoStatusEnum.fromJson(json[r'status'])!,
        updatedAt: mapValueOfType<String>(json, r'updatedAt'),
      );
    }
    return null;
  }

  static List<NsfwDetectionEnrichmentResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <NsfwDetectionEnrichmentResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = NsfwDetectionEnrichmentResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, NsfwDetectionEnrichmentResponseDto> mapFromJson(dynamic json) {
    final map = <String, NsfwDetectionEnrichmentResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = NsfwDetectionEnrichmentResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of NsfwDetectionEnrichmentResponseDto-objects as value to a dart map
  static Map<String, List<NsfwDetectionEnrichmentResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<NsfwDetectionEnrichmentResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = NsfwDetectionEnrichmentResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'appliedTags',
    'effectiveIsNsfw',
    'status',
  };
}


class NsfwDetectionEnrichmentResponseDtoStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const NsfwDetectionEnrichmentResponseDtoStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const missing = NsfwDetectionEnrichmentResponseDtoStatusEnum._(r'missing');
  static const success = NsfwDetectionEnrichmentResponseDtoStatusEnum._(r'success');
  static const failed = NsfwDetectionEnrichmentResponseDtoStatusEnum._(r'failed');

  /// List of all possible values in this [enum][NsfwDetectionEnrichmentResponseDtoStatusEnum].
  static const values = <NsfwDetectionEnrichmentResponseDtoStatusEnum>[
    missing,
    success,
    failed,
  ];

  static NsfwDetectionEnrichmentResponseDtoStatusEnum? fromJson(dynamic value) => NsfwDetectionEnrichmentResponseDtoStatusEnumTypeTransformer().decode(value);

  static List<NsfwDetectionEnrichmentResponseDtoStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <NsfwDetectionEnrichmentResponseDtoStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = NsfwDetectionEnrichmentResponseDtoStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [NsfwDetectionEnrichmentResponseDtoStatusEnum] to String,
/// and [decode] dynamic data back to [NsfwDetectionEnrichmentResponseDtoStatusEnum].
class NsfwDetectionEnrichmentResponseDtoStatusEnumTypeTransformer {
  factory NsfwDetectionEnrichmentResponseDtoStatusEnumTypeTransformer() => _instance ??= const NsfwDetectionEnrichmentResponseDtoStatusEnumTypeTransformer._();

  const NsfwDetectionEnrichmentResponseDtoStatusEnumTypeTransformer._();

  String encode(NsfwDetectionEnrichmentResponseDtoStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a NsfwDetectionEnrichmentResponseDtoStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  NsfwDetectionEnrichmentResponseDtoStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'missing': return NsfwDetectionEnrichmentResponseDtoStatusEnum.missing;
        case r'success': return NsfwDetectionEnrichmentResponseDtoStatusEnum.success;
        case r'failed': return NsfwDetectionEnrichmentResponseDtoStatusEnum.failed;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [NsfwDetectionEnrichmentResponseDtoStatusEnumTypeTransformer] instance.
  static NsfwDetectionEnrichmentResponseDtoStatusEnumTypeTransformer? _instance;
}



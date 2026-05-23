//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ImageDescriptionEnrichmentResponseDto {
  /// Returns a new [ImageDescriptionEnrichmentResponseDto] instance.
  ImageDescriptionEnrichmentResponseDto({
    required this.appliedDescription,
    required this.appliedTags,
    this.context,
    this.description,
    this.environment,
    this.error,
    this.modelName,
    this.objects = const [],
    this.people = const [],
    this.skipReason,
    required this.status,
    this.tags = const [],
    this.updatedAt,
    this.visibleText = const [],
  });

  bool appliedDescription;

  bool appliedTags;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? context;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? description;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? environment;

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
  String? modelName;

  List<String> objects;

  List<ImageDescriptionEnrichmentResponseDtoPeopleInner> people;

  /// Machine-readable reason when status === \"skipped\"
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? skipReason;

  ImageDescriptionEnrichmentResponseDtoStatusEnum status;

  List<String> tags;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? updatedAt;

  List<String> visibleText;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ImageDescriptionEnrichmentResponseDto &&
    other.appliedDescription == appliedDescription &&
    other.appliedTags == appliedTags &&
    other.context == context &&
    other.description == description &&
    other.environment == environment &&
    other.error == error &&
    other.modelName == modelName &&
    _deepEquality.equals(other.objects, objects) &&
    _deepEquality.equals(other.people, people) &&
    other.skipReason == skipReason &&
    other.status == status &&
    _deepEquality.equals(other.tags, tags) &&
    other.updatedAt == updatedAt &&
    _deepEquality.equals(other.visibleText, visibleText);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (appliedDescription.hashCode) +
    (appliedTags.hashCode) +
    (context == null ? 0 : context!.hashCode) +
    (description == null ? 0 : description!.hashCode) +
    (environment == null ? 0 : environment!.hashCode) +
    (error == null ? 0 : error!.hashCode) +
    (modelName == null ? 0 : modelName!.hashCode) +
    (objects.hashCode) +
    (people.hashCode) +
    (skipReason == null ? 0 : skipReason!.hashCode) +
    (status.hashCode) +
    (tags.hashCode) +
    (updatedAt == null ? 0 : updatedAt!.hashCode) +
    (visibleText.hashCode);

  @override
  String toString() => 'ImageDescriptionEnrichmentResponseDto[appliedDescription=$appliedDescription, appliedTags=$appliedTags, context=$context, description=$description, environment=$environment, error=$error, modelName=$modelName, objects=$objects, people=$people, skipReason=$skipReason, status=$status, tags=$tags, updatedAt=$updatedAt, visibleText=$visibleText]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'appliedDescription'] = this.appliedDescription;
      json[r'appliedTags'] = this.appliedTags;
    if (this.context != null) {
      json[r'context'] = this.context;
    } else {
    //  json[r'context'] = null;
    }
    if (this.description != null) {
      json[r'description'] = this.description;
    } else {
    //  json[r'description'] = null;
    }
    if (this.environment != null) {
      json[r'environment'] = this.environment;
    } else {
    //  json[r'environment'] = null;
    }
    if (this.error != null) {
      json[r'error'] = this.error;
    } else {
    //  json[r'error'] = null;
    }
    if (this.modelName != null) {
      json[r'modelName'] = this.modelName;
    } else {
    //  json[r'modelName'] = null;
    }
      json[r'objects'] = this.objects;
      json[r'people'] = this.people;
    if (this.skipReason != null) {
      json[r'skipReason'] = this.skipReason;
    } else {
    //  json[r'skipReason'] = null;
    }
      json[r'status'] = this.status;
      json[r'tags'] = this.tags;
    if (this.updatedAt != null) {
      json[r'updatedAt'] = this.updatedAt;
    } else {
    //  json[r'updatedAt'] = null;
    }
      json[r'visibleText'] = this.visibleText;
    return json;
  }

  /// Returns a new [ImageDescriptionEnrichmentResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ImageDescriptionEnrichmentResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "ImageDescriptionEnrichmentResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return ImageDescriptionEnrichmentResponseDto(
        appliedDescription: mapValueOfType<bool>(json, r'appliedDescription')!,
        appliedTags: mapValueOfType<bool>(json, r'appliedTags')!,
        context: mapValueOfType<String>(json, r'context'),
        description: mapValueOfType<String>(json, r'description'),
        environment: mapValueOfType<String>(json, r'environment'),
        error: mapValueOfType<String>(json, r'error'),
        modelName: mapValueOfType<String>(json, r'modelName'),
        objects: json[r'objects'] is Iterable
            ? (json[r'objects'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        people: ImageDescriptionEnrichmentResponseDtoPeopleInner.listFromJson(json[r'people']),
        skipReason: mapValueOfType<String>(json, r'skipReason'),
        status: ImageDescriptionEnrichmentResponseDtoStatusEnum.fromJson(json[r'status'])!,
        tags: json[r'tags'] is Iterable
            ? (json[r'tags'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        updatedAt: mapValueOfType<String>(json, r'updatedAt'),
        visibleText: json[r'visibleText'] is Iterable
            ? (json[r'visibleText'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<ImageDescriptionEnrichmentResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ImageDescriptionEnrichmentResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ImageDescriptionEnrichmentResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ImageDescriptionEnrichmentResponseDto> mapFromJson(dynamic json) {
    final map = <String, ImageDescriptionEnrichmentResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ImageDescriptionEnrichmentResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ImageDescriptionEnrichmentResponseDto-objects as value to a dart map
  static Map<String, List<ImageDescriptionEnrichmentResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ImageDescriptionEnrichmentResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ImageDescriptionEnrichmentResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'appliedDescription',
    'appliedTags',
    'status',
  };
}


class ImageDescriptionEnrichmentResponseDtoStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const ImageDescriptionEnrichmentResponseDtoStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const missing = ImageDescriptionEnrichmentResponseDtoStatusEnum._(r'missing');
  static const success = ImageDescriptionEnrichmentResponseDtoStatusEnum._(r'success');
  static const failed = ImageDescriptionEnrichmentResponseDtoStatusEnum._(r'failed');
  static const skipped = ImageDescriptionEnrichmentResponseDtoStatusEnum._(r'skipped');

  /// List of all possible values in this [enum][ImageDescriptionEnrichmentResponseDtoStatusEnum].
  static const values = <ImageDescriptionEnrichmentResponseDtoStatusEnum>[
    missing,
    success,
    failed,
    skipped,
  ];

  static ImageDescriptionEnrichmentResponseDtoStatusEnum? fromJson(dynamic value) => ImageDescriptionEnrichmentResponseDtoStatusEnumTypeTransformer().decode(value);

  static List<ImageDescriptionEnrichmentResponseDtoStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ImageDescriptionEnrichmentResponseDtoStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ImageDescriptionEnrichmentResponseDtoStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [ImageDescriptionEnrichmentResponseDtoStatusEnum] to String,
/// and [decode] dynamic data back to [ImageDescriptionEnrichmentResponseDtoStatusEnum].
class ImageDescriptionEnrichmentResponseDtoStatusEnumTypeTransformer {
  factory ImageDescriptionEnrichmentResponseDtoStatusEnumTypeTransformer() => _instance ??= const ImageDescriptionEnrichmentResponseDtoStatusEnumTypeTransformer._();

  const ImageDescriptionEnrichmentResponseDtoStatusEnumTypeTransformer._();

  String encode(ImageDescriptionEnrichmentResponseDtoStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a ImageDescriptionEnrichmentResponseDtoStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  ImageDescriptionEnrichmentResponseDtoStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'missing': return ImageDescriptionEnrichmentResponseDtoStatusEnum.missing;
        case r'success': return ImageDescriptionEnrichmentResponseDtoStatusEnum.success;
        case r'failed': return ImageDescriptionEnrichmentResponseDtoStatusEnum.failed;
        case r'skipped': return ImageDescriptionEnrichmentResponseDtoStatusEnum.skipped;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [ImageDescriptionEnrichmentResponseDtoStatusEnumTypeTransformer] instance.
  static ImageDescriptionEnrichmentResponseDtoStatusEnumTypeTransformer? _instance;
}



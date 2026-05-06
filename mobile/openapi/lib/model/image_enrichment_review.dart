//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ImageEnrichmentReview {
  /// Returns a new [ImageEnrichmentReview] instance.
  ImageEnrichmentReview({
    required this.action,
    required this.isNsfw,
    required this.reviewedAt,
    required this.reviewedBy,
  });

  ImageEnrichmentReviewActionEnum action;

  bool isNsfw;

  /// Review timestamp
  String reviewedAt;

  /// Reviewer user ID
  String reviewedBy;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ImageEnrichmentReview &&
    other.action == action &&
    other.isNsfw == isNsfw &&
    other.reviewedAt == reviewedAt &&
    other.reviewedBy == reviewedBy;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (action.hashCode) +
    (isNsfw.hashCode) +
    (reviewedAt.hashCode) +
    (reviewedBy.hashCode);

  @override
  String toString() => 'ImageEnrichmentReview[action=$action, isNsfw=$isNsfw, reviewedAt=$reviewedAt, reviewedBy=$reviewedBy]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'action'] = this.action;
      json[r'isNsfw'] = this.isNsfw;
      json[r'reviewedAt'] = this.reviewedAt;
      json[r'reviewedBy'] = this.reviewedBy;
    return json;
  }

  /// Returns a new [ImageEnrichmentReview] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ImageEnrichmentReview? fromJson(dynamic value) {
    upgradeDto(value, "ImageEnrichmentReview");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return ImageEnrichmentReview(
        action: ImageEnrichmentReviewActionEnum.fromJson(json[r'action'])!,
        isNsfw: mapValueOfType<bool>(json, r'isNsfw')!,
        reviewedAt: mapValueOfType<String>(json, r'reviewedAt')!,
        reviewedBy: mapValueOfType<String>(json, r'reviewedBy')!,
      );
    }
    return null;
  }

  static List<ImageEnrichmentReview> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ImageEnrichmentReview>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ImageEnrichmentReview.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ImageEnrichmentReview> mapFromJson(dynamic json) {
    final map = <String, ImageEnrichmentReview>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ImageEnrichmentReview.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ImageEnrichmentReview-objects as value to a dart map
  static Map<String, List<ImageEnrichmentReview>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ImageEnrichmentReview>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ImageEnrichmentReview.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'action',
    'isNsfw',
    'reviewedAt',
    'reviewedBy',
  };
}


class ImageEnrichmentReviewActionEnum {
  /// Instantiate a new enum with the provided [value].
  const ImageEnrichmentReviewActionEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const accepted = ImageEnrichmentReviewActionEnum._(r'accepted');
  static const markedSafe = ImageEnrichmentReviewActionEnum._(r'marked-safe');
  static const markedNsfw = ImageEnrichmentReviewActionEnum._(r'marked-nsfw');

  /// List of all possible values in this [enum][ImageEnrichmentReviewActionEnum].
  static const values = <ImageEnrichmentReviewActionEnum>[
    accepted,
    markedSafe,
    markedNsfw,
  ];

  static ImageEnrichmentReviewActionEnum? fromJson(dynamic value) => ImageEnrichmentReviewActionEnumTypeTransformer().decode(value);

  static List<ImageEnrichmentReviewActionEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ImageEnrichmentReviewActionEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ImageEnrichmentReviewActionEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [ImageEnrichmentReviewActionEnum] to String,
/// and [decode] dynamic data back to [ImageEnrichmentReviewActionEnum].
class ImageEnrichmentReviewActionEnumTypeTransformer {
  factory ImageEnrichmentReviewActionEnumTypeTransformer() => _instance ??= const ImageEnrichmentReviewActionEnumTypeTransformer._();

  const ImageEnrichmentReviewActionEnumTypeTransformer._();

  String encode(ImageEnrichmentReviewActionEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a ImageEnrichmentReviewActionEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  ImageEnrichmentReviewActionEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'accepted': return ImageEnrichmentReviewActionEnum.accepted;
        case r'marked-safe': return ImageEnrichmentReviewActionEnum.markedSafe;
        case r'marked-nsfw': return ImageEnrichmentReviewActionEnum.markedNsfw;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [ImageEnrichmentReviewActionEnumTypeTransformer] instance.
  static ImageEnrichmentReviewActionEnumTypeTransformer? _instance;
}



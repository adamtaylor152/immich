//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

/// Filter by private image enrichment state
class ImageEnrichmentFilter {
  /// Instantiate a new enum with the provided [value].
  const ImageEnrichmentFilter._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const nsfw = ImageEnrichmentFilter._(r'nsfw');
  static const nsfwReview = ImageEnrichmentFilter._(r'nsfw-review');
  static const nsfwReviewed = ImageEnrichmentFilter._(r'nsfw-reviewed');
  static const nsfwOverridden = ImageEnrichmentFilter._(r'nsfw-overridden');
  static const imageDescriptionFailed = ImageEnrichmentFilter._(r'image-description-failed');
  static const nsfwDetectionFailed = ImageEnrichmentFilter._(r'nsfw-detection-failed');
  static const missingImageDescription = ImageEnrichmentFilter._(r'missing-image-description');
  static const missingNsfwDetection = ImageEnrichmentFilter._(r'missing-nsfw-detection');

  /// List of all possible values in this [enum][ImageEnrichmentFilter].
  static const values = <ImageEnrichmentFilter>[
    nsfw,
    nsfwReview,
    nsfwReviewed,
    nsfwOverridden,
    imageDescriptionFailed,
    nsfwDetectionFailed,
    missingImageDescription,
    missingNsfwDetection,
  ];

  static ImageEnrichmentFilter? fromJson(dynamic value) => ImageEnrichmentFilterTypeTransformer().decode(value);

  static List<ImageEnrichmentFilter> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ImageEnrichmentFilter>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ImageEnrichmentFilter.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [ImageEnrichmentFilter] to String,
/// and [decode] dynamic data back to [ImageEnrichmentFilter].
class ImageEnrichmentFilterTypeTransformer {
  factory ImageEnrichmentFilterTypeTransformer() => _instance ??= const ImageEnrichmentFilterTypeTransformer._();

  const ImageEnrichmentFilterTypeTransformer._();

  String encode(ImageEnrichmentFilter data) => data.value;

  /// Decodes a [dynamic value][data] to a ImageEnrichmentFilter.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  ImageEnrichmentFilter? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'nsfw': return ImageEnrichmentFilter.nsfw;
        case r'nsfw-review': return ImageEnrichmentFilter.nsfwReview;
        case r'nsfw-reviewed': return ImageEnrichmentFilter.nsfwReviewed;
        case r'nsfw-overridden': return ImageEnrichmentFilter.nsfwOverridden;
        case r'image-description-failed': return ImageEnrichmentFilter.imageDescriptionFailed;
        case r'nsfw-detection-failed': return ImageEnrichmentFilter.nsfwDetectionFailed;
        case r'missing-image-description': return ImageEnrichmentFilter.missingImageDescription;
        case r'missing-nsfw-detection': return ImageEnrichmentFilter.missingNsfwDetection;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [ImageEnrichmentFilterTypeTransformer] instance.
  static ImageEnrichmentFilterTypeTransformer? _instance;
}


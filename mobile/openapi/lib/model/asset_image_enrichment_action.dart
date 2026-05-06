//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

/// Image enrichment repair action
class AssetImageEnrichmentAction {
  /// Instantiate a new enum with the provided [value].
  const AssetImageEnrichmentAction._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const rerunImageDescription = AssetImageEnrichmentAction._(r'rerun-image-description');
  static const rerunNsfwDetection = AssetImageEnrichmentAction._(r'rerun-nsfw-detection');
  static const acceptNsfwResult = AssetImageEnrichmentAction._(r'accept-nsfw-result');
  static const markNsfw = AssetImageEnrichmentAction._(r'mark-nsfw');
  static const markSafe = AssetImageEnrichmentAction._(r'mark-safe');
  static const clearGeneratedDescription = AssetImageEnrichmentAction._(r'clear-generated-description');
  static const clearGeneratedTags = AssetImageEnrichmentAction._(r'clear-generated-tags');

  /// List of all possible values in this [enum][AssetImageEnrichmentAction].
  static const values = <AssetImageEnrichmentAction>[
    rerunImageDescription,
    rerunNsfwDetection,
    acceptNsfwResult,
    markNsfw,
    markSafe,
    clearGeneratedDescription,
    clearGeneratedTags,
  ];

  static AssetImageEnrichmentAction? fromJson(dynamic value) => AssetImageEnrichmentActionTypeTransformer().decode(value);

  static List<AssetImageEnrichmentAction> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AssetImageEnrichmentAction>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AssetImageEnrichmentAction.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AssetImageEnrichmentAction] to String,
/// and [decode] dynamic data back to [AssetImageEnrichmentAction].
class AssetImageEnrichmentActionTypeTransformer {
  factory AssetImageEnrichmentActionTypeTransformer() => _instance ??= const AssetImageEnrichmentActionTypeTransformer._();

  const AssetImageEnrichmentActionTypeTransformer._();

  String encode(AssetImageEnrichmentAction data) => data.value;

  /// Decodes a [dynamic value][data] to a AssetImageEnrichmentAction.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AssetImageEnrichmentAction? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'rerun-image-description': return AssetImageEnrichmentAction.rerunImageDescription;
        case r'rerun-nsfw-detection': return AssetImageEnrichmentAction.rerunNsfwDetection;
        case r'accept-nsfw-result': return AssetImageEnrichmentAction.acceptNsfwResult;
        case r'mark-nsfw': return AssetImageEnrichmentAction.markNsfw;
        case r'mark-safe': return AssetImageEnrichmentAction.markSafe;
        case r'clear-generated-description': return AssetImageEnrichmentAction.clearGeneratedDescription;
        case r'clear-generated-tags': return AssetImageEnrichmentAction.clearGeneratedTags;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AssetImageEnrichmentActionTypeTransformer] instance.
  static AssetImageEnrichmentActionTypeTransformer? _instance;
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

/// Media health category
class MediaHealthCategory {
  /// Instantiate a new enum with the provided [value].
  const MediaHealthCategory._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const missing = MediaHealthCategory._(r'missing');
  static const corrupt = MediaHealthCategory._(r'corrupt');

  /// List of all possible values in this [enum][MediaHealthCategory].
  static const values = <MediaHealthCategory>[
    missing,
    corrupt,
  ];

  static MediaHealthCategory? fromJson(dynamic value) => MediaHealthCategoryTypeTransformer().decode(value);

  static List<MediaHealthCategory> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <MediaHealthCategory>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = MediaHealthCategory.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [MediaHealthCategory] to String,
/// and [decode] dynamic data back to [MediaHealthCategory].
class MediaHealthCategoryTypeTransformer {
  factory MediaHealthCategoryTypeTransformer() => _instance ??= const MediaHealthCategoryTypeTransformer._();

  const MediaHealthCategoryTypeTransformer._();

  String encode(MediaHealthCategory data) => data.value;

  /// Decodes a [dynamic value][data] to a MediaHealthCategory.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  MediaHealthCategory? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'missing': return MediaHealthCategory.missing;
        case r'corrupt': return MediaHealthCategory.corrupt;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [MediaHealthCategoryTypeTransformer] instance.
  static MediaHealthCategoryTypeTransformer? _instance;
}


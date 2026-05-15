//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

/// Media health severity
class MediaHealthSeverity {
  /// Instantiate a new enum with the provided [value].
  const MediaHealthSeverity._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const info = MediaHealthSeverity._(r'info');
  static const warning = MediaHealthSeverity._(r'warning');
  static const critical = MediaHealthSeverity._(r'critical');

  /// List of all possible values in this [enum][MediaHealthSeverity].
  static const values = <MediaHealthSeverity>[
    info,
    warning,
    critical,
  ];

  static MediaHealthSeverity? fromJson(dynamic value) => MediaHealthSeverityTypeTransformer().decode(value);

  static List<MediaHealthSeverity> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <MediaHealthSeverity>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = MediaHealthSeverity.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [MediaHealthSeverity] to String,
/// and [decode] dynamic data back to [MediaHealthSeverity].
class MediaHealthSeverityTypeTransformer {
  factory MediaHealthSeverityTypeTransformer() => _instance ??= const MediaHealthSeverityTypeTransformer._();

  const MediaHealthSeverityTypeTransformer._();

  String encode(MediaHealthSeverity data) => data.value;

  /// Decodes a [dynamic value][data] to a MediaHealthSeverity.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  MediaHealthSeverity? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'info': return MediaHealthSeverity.info;
        case r'warning': return MediaHealthSeverity.warning;
        case r'critical': return MediaHealthSeverity.critical;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [MediaHealthSeverityTypeTransformer] instance.
  static MediaHealthSeverityTypeTransformer? _instance;
}


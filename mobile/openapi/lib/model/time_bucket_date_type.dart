//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

/// Date source for timeline bucket grouping
class TimeBucketDateType {
  /// Instantiate a new enum with the provided [value].
  const TimeBucketDateType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const added = TimeBucketDateType._(r'added');
  static const taken = TimeBucketDateType._(r'taken');

  /// List of all possible values in this [enum][TimeBucketDateType].
  static const values = <TimeBucketDateType>[
    added,
    taken,
  ];

  static TimeBucketDateType? fromJson(dynamic value) => TimeBucketDateTypeTypeTransformer().decode(value);

  static List<TimeBucketDateType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <TimeBucketDateType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = TimeBucketDateType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [TimeBucketDateType] to String,
/// and [decode] dynamic data back to [TimeBucketDateType].
class TimeBucketDateTypeTypeTransformer {
  factory TimeBucketDateTypeTypeTransformer() => _instance ??= const TimeBucketDateTypeTypeTransformer._();

  const TimeBucketDateTypeTypeTransformer._();

  String encode(TimeBucketDateType data) => data.value;

  /// Decodes a [dynamic value][data] to a TimeBucketDateType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  TimeBucketDateType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'added': return TimeBucketDateType.added;
        case r'taken': return TimeBucketDateType.taken;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [TimeBucketDateTypeTypeTransformer] instance.
  static TimeBucketDateTypeTypeTransformer? _instance;
}


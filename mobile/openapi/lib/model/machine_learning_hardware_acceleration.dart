//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

/// Machine learning hardware acceleration backend
class MachineLearningHardwareAcceleration {
  /// Instantiate a new enum with the provided [value].
  const MachineLearningHardwareAcceleration._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const auto = MachineLearningHardwareAcceleration._(r'auto');
  static const openvino = MachineLearningHardwareAcceleration._(r'openvino');
  static const cuda = MachineLearningHardwareAcceleration._(r'cuda');

  /// List of all possible values in this [enum][MachineLearningHardwareAcceleration].
  static const values = <MachineLearningHardwareAcceleration>[
    auto,
    openvino,
    cuda,
  ];

  static MachineLearningHardwareAcceleration? fromJson(dynamic value) => MachineLearningHardwareAccelerationTypeTransformer().decode(value);

  static List<MachineLearningHardwareAcceleration> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <MachineLearningHardwareAcceleration>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = MachineLearningHardwareAcceleration.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [MachineLearningHardwareAcceleration] to String,
/// and [decode] dynamic data back to [MachineLearningHardwareAcceleration].
class MachineLearningHardwareAccelerationTypeTransformer {
  factory MachineLearningHardwareAccelerationTypeTransformer() => _instance ??= const MachineLearningHardwareAccelerationTypeTransformer._();

  const MachineLearningHardwareAccelerationTypeTransformer._();

  String encode(MachineLearningHardwareAcceleration data) => data.value;

  /// Decodes a [dynamic value][data] to a MachineLearningHardwareAcceleration.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  MachineLearningHardwareAcceleration? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'auto': return MachineLearningHardwareAcceleration.auto;
        case r'openvino': return MachineLearningHardwareAcceleration.openvino;
        case r'cuda': return MachineLearningHardwareAcceleration.cuda;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [MachineLearningHardwareAccelerationTypeTransformer] instance.
  static MachineLearningHardwareAccelerationTypeTransformer? _instance;
}


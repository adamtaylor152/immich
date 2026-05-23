//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SystemConfigRunPodServerlessDto {
  /// Returns a new [SystemConfigRunPodServerlessDto] instance.
  SystemConfigRunPodServerlessDto({
    required this.executionTimeoutMs,
    this.gpuTypeIds = const [],
    required this.idleTimeoutSeconds,
    required this.scalerType,
    required this.scalerValue,
    required this.workersMax,
    required this.workersMin,
  });

  /// Max time per request (ms)
  ///
  /// Minimum value: 5000
  /// Maximum value: 3600000
  int executionTimeoutMs;

  /// Ranked GPU type IDs the endpoint can use (cheapest first)
  List<String> gpuTypeIds;

  /// Seconds before an idle worker scales down
  ///
  /// Minimum value: 5
  /// Maximum value: 3600
  int idleTimeoutSeconds;

  /// Worker autoscaler strategy
  SystemConfigRunPodServerlessDtoScalerTypeEnum scalerType;

  /// Scaler threshold (queue seconds or request count)
  ///
  /// Minimum value: 1
  /// Maximum value: 60
  int scalerValue;

  /// Max concurrent workers
  ///
  /// Minimum value: 1
  /// Maximum value: 20
  int workersMax;

  /// Always-warm workers (0 = scale to zero)
  ///
  /// Minimum value: 0
  /// Maximum value: 10
  int workersMin;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SystemConfigRunPodServerlessDto &&
    other.executionTimeoutMs == executionTimeoutMs &&
    _deepEquality.equals(other.gpuTypeIds, gpuTypeIds) &&
    other.idleTimeoutSeconds == idleTimeoutSeconds &&
    other.scalerType == scalerType &&
    other.scalerValue == scalerValue &&
    other.workersMax == workersMax &&
    other.workersMin == workersMin;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (executionTimeoutMs.hashCode) +
    (gpuTypeIds.hashCode) +
    (idleTimeoutSeconds.hashCode) +
    (scalerType.hashCode) +
    (scalerValue.hashCode) +
    (workersMax.hashCode) +
    (workersMin.hashCode);

  @override
  String toString() => 'SystemConfigRunPodServerlessDto[executionTimeoutMs=$executionTimeoutMs, gpuTypeIds=$gpuTypeIds, idleTimeoutSeconds=$idleTimeoutSeconds, scalerType=$scalerType, scalerValue=$scalerValue, workersMax=$workersMax, workersMin=$workersMin]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'executionTimeoutMs'] = this.executionTimeoutMs;
      json[r'gpuTypeIds'] = this.gpuTypeIds;
      json[r'idleTimeoutSeconds'] = this.idleTimeoutSeconds;
      json[r'scalerType'] = this.scalerType;
      json[r'scalerValue'] = this.scalerValue;
      json[r'workersMax'] = this.workersMax;
      json[r'workersMin'] = this.workersMin;
    return json;
  }

  /// Returns a new [SystemConfigRunPodServerlessDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SystemConfigRunPodServerlessDto? fromJson(dynamic value) {
    upgradeDto(value, "SystemConfigRunPodServerlessDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SystemConfigRunPodServerlessDto(
        executionTimeoutMs: mapValueOfType<int>(json, r'executionTimeoutMs')!,
        gpuTypeIds: json[r'gpuTypeIds'] is Iterable
            ? (json[r'gpuTypeIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        idleTimeoutSeconds: mapValueOfType<int>(json, r'idleTimeoutSeconds')!,
        scalerType: SystemConfigRunPodServerlessDtoScalerTypeEnum.fromJson(json[r'scalerType'])!,
        scalerValue: mapValueOfType<int>(json, r'scalerValue')!,
        workersMax: mapValueOfType<int>(json, r'workersMax')!,
        workersMin: mapValueOfType<int>(json, r'workersMin')!,
      );
    }
    return null;
  }

  static List<SystemConfigRunPodServerlessDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SystemConfigRunPodServerlessDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SystemConfigRunPodServerlessDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SystemConfigRunPodServerlessDto> mapFromJson(dynamic json) {
    final map = <String, SystemConfigRunPodServerlessDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SystemConfigRunPodServerlessDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SystemConfigRunPodServerlessDto-objects as value to a dart map
  static Map<String, List<SystemConfigRunPodServerlessDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SystemConfigRunPodServerlessDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SystemConfigRunPodServerlessDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'executionTimeoutMs',
    'gpuTypeIds',
    'idleTimeoutSeconds',
    'scalerType',
    'scalerValue',
    'workersMax',
    'workersMin',
  };
}

/// Worker autoscaler strategy
class SystemConfigRunPodServerlessDtoScalerTypeEnum {
  /// Instantiate a new enum with the provided [value].
  const SystemConfigRunPodServerlessDtoScalerTypeEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const QUEUE_DELAY = SystemConfigRunPodServerlessDtoScalerTypeEnum._(r'QUEUE_DELAY');
  static const REQUEST_COUNT = SystemConfigRunPodServerlessDtoScalerTypeEnum._(r'REQUEST_COUNT');

  /// List of all possible values in this [enum][SystemConfigRunPodServerlessDtoScalerTypeEnum].
  static const values = <SystemConfigRunPodServerlessDtoScalerTypeEnum>[
    QUEUE_DELAY,
    REQUEST_COUNT,
  ];

  static SystemConfigRunPodServerlessDtoScalerTypeEnum? fromJson(dynamic value) => SystemConfigRunPodServerlessDtoScalerTypeEnumTypeTransformer().decode(value);

  static List<SystemConfigRunPodServerlessDtoScalerTypeEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SystemConfigRunPodServerlessDtoScalerTypeEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SystemConfigRunPodServerlessDtoScalerTypeEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [SystemConfigRunPodServerlessDtoScalerTypeEnum] to String,
/// and [decode] dynamic data back to [SystemConfigRunPodServerlessDtoScalerTypeEnum].
class SystemConfigRunPodServerlessDtoScalerTypeEnumTypeTransformer {
  factory SystemConfigRunPodServerlessDtoScalerTypeEnumTypeTransformer() => _instance ??= const SystemConfigRunPodServerlessDtoScalerTypeEnumTypeTransformer._();

  const SystemConfigRunPodServerlessDtoScalerTypeEnumTypeTransformer._();

  String encode(SystemConfigRunPodServerlessDtoScalerTypeEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a SystemConfigRunPodServerlessDtoScalerTypeEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  SystemConfigRunPodServerlessDtoScalerTypeEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'QUEUE_DELAY': return SystemConfigRunPodServerlessDtoScalerTypeEnum.QUEUE_DELAY;
        case r'REQUEST_COUNT': return SystemConfigRunPodServerlessDtoScalerTypeEnum.REQUEST_COUNT;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [SystemConfigRunPodServerlessDtoScalerTypeEnumTypeTransformer] instance.
  static SystemConfigRunPodServerlessDtoScalerTypeEnumTypeTransformer? _instance;
}



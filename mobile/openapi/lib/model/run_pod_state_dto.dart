//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class RunPodStateDto {
  /// Returns a new [RunPodStateDto] instance.
  RunPodStateDto({
    this.endpointId,
    this.endpointUrl,
    this.errorMessage,
    this.estimatedCostUsd,
    this.gpuTypeId,
    this.idleTimeoutSeconds,
    this.imageName,
    this.instanceTag,
    this.lastBusyAt,
    this.maxRuntimeHours,
    this.mlUrl,
    this.podCreatedAt,
    this.podId,
    this.pricePerHour,
    this.runningSince,
    required this.status,
    this.stoppedAt,
    this.templateId,
    this.unhealthySince,
    this.workersMax,
    this.workersMin,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? endpointId;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? endpointUrl;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? errorMessage;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? estimatedCostUsd;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? gpuTypeId;

  num? idleTimeoutSeconds;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? imageName;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? instanceTag;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? lastBusyAt;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? maxRuntimeHours;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? mlUrl;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? podCreatedAt;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? podId;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? pricePerHour;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? runningSince;

  RunPodStateDtoStatusEnum status;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? stoppedAt;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? templateId;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? unhealthySince;

  num? workersMax;

  num? workersMin;

  @override
  bool operator ==(Object other) => identical(this, other) || other is RunPodStateDto &&
    other.endpointId == endpointId &&
    other.endpointUrl == endpointUrl &&
    other.errorMessage == errorMessage &&
    other.estimatedCostUsd == estimatedCostUsd &&
    other.gpuTypeId == gpuTypeId &&
    other.idleTimeoutSeconds == idleTimeoutSeconds &&
    other.imageName == imageName &&
    other.instanceTag == instanceTag &&
    other.lastBusyAt == lastBusyAt &&
    other.maxRuntimeHours == maxRuntimeHours &&
    other.mlUrl == mlUrl &&
    other.podCreatedAt == podCreatedAt &&
    other.podId == podId &&
    other.pricePerHour == pricePerHour &&
    other.runningSince == runningSince &&
    other.status == status &&
    other.stoppedAt == stoppedAt &&
    other.templateId == templateId &&
    other.unhealthySince == unhealthySince &&
    other.workersMax == workersMax &&
    other.workersMin == workersMin;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (endpointId == null ? 0 : endpointId!.hashCode) +
    (endpointUrl == null ? 0 : endpointUrl!.hashCode) +
    (errorMessage == null ? 0 : errorMessage!.hashCode) +
    (estimatedCostUsd == null ? 0 : estimatedCostUsd!.hashCode) +
    (gpuTypeId == null ? 0 : gpuTypeId!.hashCode) +
    (idleTimeoutSeconds == null ? 0 : idleTimeoutSeconds!.hashCode) +
    (imageName == null ? 0 : imageName!.hashCode) +
    (instanceTag == null ? 0 : instanceTag!.hashCode) +
    (lastBusyAt == null ? 0 : lastBusyAt!.hashCode) +
    (maxRuntimeHours == null ? 0 : maxRuntimeHours!.hashCode) +
    (mlUrl == null ? 0 : mlUrl!.hashCode) +
    (podCreatedAt == null ? 0 : podCreatedAt!.hashCode) +
    (podId == null ? 0 : podId!.hashCode) +
    (pricePerHour == null ? 0 : pricePerHour!.hashCode) +
    (runningSince == null ? 0 : runningSince!.hashCode) +
    (status.hashCode) +
    (stoppedAt == null ? 0 : stoppedAt!.hashCode) +
    (templateId == null ? 0 : templateId!.hashCode) +
    (unhealthySince == null ? 0 : unhealthySince!.hashCode) +
    (workersMax == null ? 0 : workersMax!.hashCode) +
    (workersMin == null ? 0 : workersMin!.hashCode);

  @override
  String toString() => 'RunPodStateDto[endpointId=$endpointId, endpointUrl=$endpointUrl, errorMessage=$errorMessage, estimatedCostUsd=$estimatedCostUsd, gpuTypeId=$gpuTypeId, idleTimeoutSeconds=$idleTimeoutSeconds, imageName=$imageName, instanceTag=$instanceTag, lastBusyAt=$lastBusyAt, maxRuntimeHours=$maxRuntimeHours, mlUrl=$mlUrl, podCreatedAt=$podCreatedAt, podId=$podId, pricePerHour=$pricePerHour, runningSince=$runningSince, status=$status, stoppedAt=$stoppedAt, templateId=$templateId, unhealthySince=$unhealthySince, workersMax=$workersMax, workersMin=$workersMin]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.endpointId != null) {
      json[r'endpointId'] = this.endpointId;
    } else {
    //  json[r'endpointId'] = null;
    }
    if (this.endpointUrl != null) {
      json[r'endpointUrl'] = this.endpointUrl;
    } else {
    //  json[r'endpointUrl'] = null;
    }
    if (this.errorMessage != null) {
      json[r'errorMessage'] = this.errorMessage;
    } else {
    //  json[r'errorMessage'] = null;
    }
    if (this.estimatedCostUsd != null) {
      json[r'estimatedCostUsd'] = this.estimatedCostUsd;
    } else {
    //  json[r'estimatedCostUsd'] = null;
    }
    if (this.gpuTypeId != null) {
      json[r'gpuTypeId'] = this.gpuTypeId;
    } else {
    //  json[r'gpuTypeId'] = null;
    }
    if (this.idleTimeoutSeconds != null) {
      json[r'idleTimeoutSeconds'] = this.idleTimeoutSeconds;
    } else {
    //  json[r'idleTimeoutSeconds'] = null;
    }
    if (this.imageName != null) {
      json[r'imageName'] = this.imageName;
    } else {
    //  json[r'imageName'] = null;
    }
    if (this.instanceTag != null) {
      json[r'instanceTag'] = this.instanceTag;
    } else {
    //  json[r'instanceTag'] = null;
    }
    if (this.lastBusyAt != null) {
      json[r'lastBusyAt'] = this.lastBusyAt;
    } else {
    //  json[r'lastBusyAt'] = null;
    }
    if (this.maxRuntimeHours != null) {
      json[r'maxRuntimeHours'] = this.maxRuntimeHours;
    } else {
    //  json[r'maxRuntimeHours'] = null;
    }
    if (this.mlUrl != null) {
      json[r'mlUrl'] = this.mlUrl;
    } else {
    //  json[r'mlUrl'] = null;
    }
    if (this.podCreatedAt != null) {
      json[r'podCreatedAt'] = this.podCreatedAt;
    } else {
    //  json[r'podCreatedAt'] = null;
    }
    if (this.podId != null) {
      json[r'podId'] = this.podId;
    } else {
    //  json[r'podId'] = null;
    }
    if (this.pricePerHour != null) {
      json[r'pricePerHour'] = this.pricePerHour;
    } else {
    //  json[r'pricePerHour'] = null;
    }
    if (this.runningSince != null) {
      json[r'runningSince'] = this.runningSince;
    } else {
    //  json[r'runningSince'] = null;
    }
      json[r'status'] = this.status;
    if (this.stoppedAt != null) {
      json[r'stoppedAt'] = this.stoppedAt;
    } else {
    //  json[r'stoppedAt'] = null;
    }
    if (this.templateId != null) {
      json[r'templateId'] = this.templateId;
    } else {
    //  json[r'templateId'] = null;
    }
    if (this.unhealthySince != null) {
      json[r'unhealthySince'] = this.unhealthySince;
    } else {
    //  json[r'unhealthySince'] = null;
    }
    if (this.workersMax != null) {
      json[r'workersMax'] = this.workersMax;
    } else {
    //  json[r'workersMax'] = null;
    }
    if (this.workersMin != null) {
      json[r'workersMin'] = this.workersMin;
    } else {
    //  json[r'workersMin'] = null;
    }
    return json;
  }

  /// Returns a new [RunPodStateDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static RunPodStateDto? fromJson(dynamic value) {
    upgradeDto(value, "RunPodStateDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return RunPodStateDto(
        endpointId: mapValueOfType<String>(json, r'endpointId'),
        endpointUrl: mapValueOfType<String>(json, r'endpointUrl'),
        errorMessage: mapValueOfType<String>(json, r'errorMessage'),
        estimatedCostUsd: num.parse('${json[r'estimatedCostUsd']}'),
        gpuTypeId: mapValueOfType<String>(json, r'gpuTypeId'),
        idleTimeoutSeconds: json[r'idleTimeoutSeconds'] == null
            ? null
            : num.parse('${json[r'idleTimeoutSeconds']}'),
        imageName: mapValueOfType<String>(json, r'imageName'),
        instanceTag: mapValueOfType<String>(json, r'instanceTag'),
        lastBusyAt: mapValueOfType<String>(json, r'lastBusyAt'),
        maxRuntimeHours: num.parse('${json[r'maxRuntimeHours']}'),
        mlUrl: mapValueOfType<String>(json, r'mlUrl'),
        podCreatedAt: mapValueOfType<String>(json, r'podCreatedAt'),
        podId: mapValueOfType<String>(json, r'podId'),
        pricePerHour: num.parse('${json[r'pricePerHour']}'),
        runningSince: mapValueOfType<String>(json, r'runningSince'),
        status: RunPodStateDtoStatusEnum.fromJson(json[r'status'])!,
        stoppedAt: mapValueOfType<String>(json, r'stoppedAt'),
        templateId: mapValueOfType<String>(json, r'templateId'),
        unhealthySince: mapValueOfType<String>(json, r'unhealthySince'),
        workersMax: json[r'workersMax'] == null
            ? null
            : num.parse('${json[r'workersMax']}'),
        workersMin: json[r'workersMin'] == null
            ? null
            : num.parse('${json[r'workersMin']}'),
      );
    }
    return null;
  }

  static List<RunPodStateDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <RunPodStateDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = RunPodStateDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, RunPodStateDto> mapFromJson(dynamic json) {
    final map = <String, RunPodStateDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = RunPodStateDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of RunPodStateDto-objects as value to a dart map
  static Map<String, List<RunPodStateDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<RunPodStateDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = RunPodStateDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'status',
  };
}


class RunPodStateDtoStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const RunPodStateDtoStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const idle = RunPodStateDtoStatusEnum._(r'idle');
  static const provisioning = RunPodStateDtoStatusEnum._(r'provisioning');
  static const starting = RunPodStateDtoStatusEnum._(r'starting');
  static const running = RunPodStateDtoStatusEnum._(r'running');
  static const stopping = RunPodStateDtoStatusEnum._(r'stopping');
  static const stopped = RunPodStateDtoStatusEnum._(r'stopped');
  static const error = RunPodStateDtoStatusEnum._(r'error');
  static const serverlessProvisioning = RunPodStateDtoStatusEnum._(r'serverless-provisioning');
  static const serverlessReady = RunPodStateDtoStatusEnum._(r'serverless-ready');

  /// List of all possible values in this [enum][RunPodStateDtoStatusEnum].
  static const values = <RunPodStateDtoStatusEnum>[
    idle,
    provisioning,
    starting,
    running,
    stopping,
    stopped,
    error,
    serverlessProvisioning,
    serverlessReady,
  ];

  static RunPodStateDtoStatusEnum? fromJson(dynamic value) => RunPodStateDtoStatusEnumTypeTransformer().decode(value);

  static List<RunPodStateDtoStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <RunPodStateDtoStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = RunPodStateDtoStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [RunPodStateDtoStatusEnum] to String,
/// and [decode] dynamic data back to [RunPodStateDtoStatusEnum].
class RunPodStateDtoStatusEnumTypeTransformer {
  factory RunPodStateDtoStatusEnumTypeTransformer() => _instance ??= const RunPodStateDtoStatusEnumTypeTransformer._();

  const RunPodStateDtoStatusEnumTypeTransformer._();

  String encode(RunPodStateDtoStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a RunPodStateDtoStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  RunPodStateDtoStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'idle': return RunPodStateDtoStatusEnum.idle;
        case r'provisioning': return RunPodStateDtoStatusEnum.provisioning;
        case r'starting': return RunPodStateDtoStatusEnum.starting;
        case r'running': return RunPodStateDtoStatusEnum.running;
        case r'stopping': return RunPodStateDtoStatusEnum.stopping;
        case r'stopped': return RunPodStateDtoStatusEnum.stopped;
        case r'error': return RunPodStateDtoStatusEnum.error;
        case r'serverless-provisioning': return RunPodStateDtoStatusEnum.serverlessProvisioning;
        case r'serverless-ready': return RunPodStateDtoStatusEnum.serverlessReady;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [RunPodStateDtoStatusEnumTypeTransformer] instance.
  static RunPodStateDtoStatusEnumTypeTransformer? _instance;
}



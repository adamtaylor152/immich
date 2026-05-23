//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SystemConfigRunPodDto {
  /// Returns a new [SystemConfigRunPodDto] instance.
  SystemConfigRunPodDto({
    required this.apiKey,
    required this.autoBackfillOnLaunch,
    required this.autoStopEnabled,
    required this.autoStopGraceMinutes,
    required this.containerDiskGb,
    required this.dataPrivacyAcknowledged,
    required this.defaultGpuTypeId,
    required this.enabled,
    required this.imageName,
    required this.maxRuntimeHours,
    required this.mode,
    this.serverless,
    required this.volumeGb,
  });

  /// RunPod API key (write-only; empty preserves the existing key)
  String apiKey;

  /// Auto-run ML backfill on pod ready (Pod mode)
  bool autoBackfillOnLaunch;

  /// Auto-stop when idle (Pod mode)
  bool autoStopEnabled;

  /// Idle minutes before auto-stop (Pod mode)
  ///
  /// Minimum value: 1
  /// Maximum value: 1440
  int autoStopGraceMinutes;

  /// Container disk size (GB) (Pod mode)
  ///
  /// Minimum value: 10
  /// Maximum value: 2000
  int containerDiskGb;

  /// User accepted that image previews leave the network
  bool dataPrivacyAcknowledged;

  /// Preferred GPU type ID (Pod mode)
  String defaultGpuTypeId;

  /// Enabled
  bool enabled;

  /// Container image to launch
  String imageName;

  /// Hard runtime ceiling (hours) (Pod mode)
  ///
  /// Minimum value: 1
  /// Maximum value: 168
  int maxRuntimeHours;

  /// disabled = off, pod = manually launched dedicated GPU, serverless = auto-managed scale-to-zero endpoint
  SystemConfigRunPodDtoModeEnum mode;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  SystemConfigRunPodServerlessDto? serverless;

  /// Persistent volume size (GB) (Pod mode)
  ///
  /// Minimum value: 0
  /// Maximum value: 2000
  int volumeGb;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SystemConfigRunPodDto &&
    other.apiKey == apiKey &&
    other.autoBackfillOnLaunch == autoBackfillOnLaunch &&
    other.autoStopEnabled == autoStopEnabled &&
    other.autoStopGraceMinutes == autoStopGraceMinutes &&
    other.containerDiskGb == containerDiskGb &&
    other.dataPrivacyAcknowledged == dataPrivacyAcknowledged &&
    other.defaultGpuTypeId == defaultGpuTypeId &&
    other.enabled == enabled &&
    other.imageName == imageName &&
    other.maxRuntimeHours == maxRuntimeHours &&
    other.mode == mode &&
    other.serverless == serverless &&
    other.volumeGb == volumeGb;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (apiKey.hashCode) +
    (autoBackfillOnLaunch.hashCode) +
    (autoStopEnabled.hashCode) +
    (autoStopGraceMinutes.hashCode) +
    (containerDiskGb.hashCode) +
    (dataPrivacyAcknowledged.hashCode) +
    (defaultGpuTypeId.hashCode) +
    (enabled.hashCode) +
    (imageName.hashCode) +
    (maxRuntimeHours.hashCode) +
    (mode.hashCode) +
    (serverless == null ? 0 : serverless!.hashCode) +
    (volumeGb.hashCode);

  @override
  String toString() => 'SystemConfigRunPodDto[apiKey=$apiKey, autoBackfillOnLaunch=$autoBackfillOnLaunch, autoStopEnabled=$autoStopEnabled, autoStopGraceMinutes=$autoStopGraceMinutes, containerDiskGb=$containerDiskGb, dataPrivacyAcknowledged=$dataPrivacyAcknowledged, defaultGpuTypeId=$defaultGpuTypeId, enabled=$enabled, imageName=$imageName, maxRuntimeHours=$maxRuntimeHours, mode=$mode, serverless=$serverless, volumeGb=$volumeGb]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'apiKey'] = this.apiKey;
      json[r'autoBackfillOnLaunch'] = this.autoBackfillOnLaunch;
      json[r'autoStopEnabled'] = this.autoStopEnabled;
      json[r'autoStopGraceMinutes'] = this.autoStopGraceMinutes;
      json[r'containerDiskGb'] = this.containerDiskGb;
      json[r'dataPrivacyAcknowledged'] = this.dataPrivacyAcknowledged;
      json[r'defaultGpuTypeId'] = this.defaultGpuTypeId;
      json[r'enabled'] = this.enabled;
      json[r'imageName'] = this.imageName;
      json[r'maxRuntimeHours'] = this.maxRuntimeHours;
      json[r'mode'] = this.mode;
    if (this.serverless != null) {
      json[r'serverless'] = this.serverless;
    } else {
    //  json[r'serverless'] = null;
    }
      json[r'volumeGb'] = this.volumeGb;
    return json;
  }

  /// Returns a new [SystemConfigRunPodDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SystemConfigRunPodDto? fromJson(dynamic value) {
    upgradeDto(value, "SystemConfigRunPodDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SystemConfigRunPodDto(
        apiKey: mapValueOfType<String>(json, r'apiKey')!,
        autoBackfillOnLaunch: mapValueOfType<bool>(json, r'autoBackfillOnLaunch')!,
        autoStopEnabled: mapValueOfType<bool>(json, r'autoStopEnabled')!,
        autoStopGraceMinutes: mapValueOfType<int>(json, r'autoStopGraceMinutes')!,
        containerDiskGb: mapValueOfType<int>(json, r'containerDiskGb')!,
        dataPrivacyAcknowledged: mapValueOfType<bool>(json, r'dataPrivacyAcknowledged')!,
        defaultGpuTypeId: mapValueOfType<String>(json, r'defaultGpuTypeId')!,
        enabled: mapValueOfType<bool>(json, r'enabled')!,
        imageName: mapValueOfType<String>(json, r'imageName')!,
        maxRuntimeHours: mapValueOfType<int>(json, r'maxRuntimeHours')!,
        mode: SystemConfigRunPodDtoModeEnum.fromJson(json[r'mode'])!,
        serverless: SystemConfigRunPodServerlessDto.fromJson(json[r'serverless']),
        volumeGb: mapValueOfType<int>(json, r'volumeGb')!,
      );
    }
    return null;
  }

  static List<SystemConfigRunPodDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SystemConfigRunPodDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SystemConfigRunPodDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SystemConfigRunPodDto> mapFromJson(dynamic json) {
    final map = <String, SystemConfigRunPodDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SystemConfigRunPodDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SystemConfigRunPodDto-objects as value to a dart map
  static Map<String, List<SystemConfigRunPodDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SystemConfigRunPodDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SystemConfigRunPodDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'apiKey',
    'autoBackfillOnLaunch',
    'autoStopEnabled',
    'autoStopGraceMinutes',
    'containerDiskGb',
    'dataPrivacyAcknowledged',
    'defaultGpuTypeId',
    'enabled',
    'imageName',
    'maxRuntimeHours',
    'mode',
    'volumeGb',
  };
}

/// disabled = off, pod = manually launched dedicated GPU, serverless = auto-managed scale-to-zero endpoint
class SystemConfigRunPodDtoModeEnum {
  /// Instantiate a new enum with the provided [value].
  const SystemConfigRunPodDtoModeEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const disabled = SystemConfigRunPodDtoModeEnum._(r'disabled');
  static const pod = SystemConfigRunPodDtoModeEnum._(r'pod');
  static const serverless = SystemConfigRunPodDtoModeEnum._(r'serverless');

  /// List of all possible values in this [enum][SystemConfigRunPodDtoModeEnum].
  static const values = <SystemConfigRunPodDtoModeEnum>[
    disabled,
    pod,
    serverless,
  ];

  static SystemConfigRunPodDtoModeEnum? fromJson(dynamic value) => SystemConfigRunPodDtoModeEnumTypeTransformer().decode(value);

  static List<SystemConfigRunPodDtoModeEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SystemConfigRunPodDtoModeEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SystemConfigRunPodDtoModeEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [SystemConfigRunPodDtoModeEnum] to String,
/// and [decode] dynamic data back to [SystemConfigRunPodDtoModeEnum].
class SystemConfigRunPodDtoModeEnumTypeTransformer {
  factory SystemConfigRunPodDtoModeEnumTypeTransformer() => _instance ??= const SystemConfigRunPodDtoModeEnumTypeTransformer._();

  const SystemConfigRunPodDtoModeEnumTypeTransformer._();

  String encode(SystemConfigRunPodDtoModeEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a SystemConfigRunPodDtoModeEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  SystemConfigRunPodDtoModeEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'disabled': return SystemConfigRunPodDtoModeEnum.disabled;
        case r'pod': return SystemConfigRunPodDtoModeEnum.pod;
        case r'serverless': return SystemConfigRunPodDtoModeEnum.serverless;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [SystemConfigRunPodDtoModeEnumTypeTransformer] instance.
  static SystemConfigRunPodDtoModeEnumTypeTransformer? _instance;
}



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
    required this.volumeGb,
  });

  /// RunPod API key (write-only; empty preserves the existing key)
  String apiKey;

  /// Auto-run ML backfill on pod ready
  bool autoBackfillOnLaunch;

  /// Auto-stop when idle
  bool autoStopEnabled;

  /// Idle minutes before auto-stop
  ///
  /// Minimum value: 1
  /// Maximum value: 1440
  int autoStopGraceMinutes;

  /// Container disk size (GB)
  ///
  /// Minimum value: 10
  /// Maximum value: 2000
  int containerDiskGb;

  /// User accepted that image previews leave the network
  bool dataPrivacyAcknowledged;

  /// Preferred GPU type ID
  String defaultGpuTypeId;

  /// Enabled
  bool enabled;

  /// Container image to launch
  String imageName;

  /// Hard runtime ceiling (hours)
  ///
  /// Minimum value: 1
  /// Maximum value: 168
  int maxRuntimeHours;

  /// Persistent volume size (GB)
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
    (volumeGb.hashCode);

  @override
  String toString() => 'SystemConfigRunPodDto[apiKey=$apiKey, autoBackfillOnLaunch=$autoBackfillOnLaunch, autoStopEnabled=$autoStopEnabled, autoStopGraceMinutes=$autoStopGraceMinutes, containerDiskGb=$containerDiskGb, dataPrivacyAcknowledged=$dataPrivacyAcknowledged, defaultGpuTypeId=$defaultGpuTypeId, enabled=$enabled, imageName=$imageName, maxRuntimeHours=$maxRuntimeHours, volumeGb=$volumeGb]';

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
    'volumeGb',
  };
}


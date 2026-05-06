//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class NsfwDetectionConfig {
  /// Returns a new [NsfwDetectionConfig] instance.
  NsfwDetectionConfig({
    required this.device,
    required this.enabled,
    required this.hideFromLibrary,
    required this.modelName,
    required this.threshold,
  });

  /// OpenVINO device to use
  String device;

  /// Whether the task is enabled
  bool enabled;

  /// Hide NSFW assets from library views unless the session has PIN-elevated access
  bool hideFromLibrary;

  /// Name of the model to use
  String modelName;

  /// Minimum score required to mark an image as NSFW
  ///
  /// Minimum value: 0.01
  /// Maximum value: 1
  double threshold;

  @override
  bool operator ==(Object other) => identical(this, other) || other is NsfwDetectionConfig &&
    other.device == device &&
    other.enabled == enabled &&
    other.hideFromLibrary == hideFromLibrary &&
    other.modelName == modelName &&
    other.threshold == threshold;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (device.hashCode) +
    (enabled.hashCode) +
    (hideFromLibrary.hashCode) +
    (modelName.hashCode) +
    (threshold.hashCode);

  @override
  String toString() => 'NsfwDetectionConfig[device=$device, enabled=$enabled, hideFromLibrary=$hideFromLibrary, modelName=$modelName, threshold=$threshold]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'device'] = this.device;
      json[r'enabled'] = this.enabled;
      json[r'hideFromLibrary'] = this.hideFromLibrary;
      json[r'modelName'] = this.modelName;
      json[r'threshold'] = this.threshold;
    return json;
  }

  /// Returns a new [NsfwDetectionConfig] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static NsfwDetectionConfig? fromJson(dynamic value) {
    upgradeDto(value, "NsfwDetectionConfig");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return NsfwDetectionConfig(
        device: mapValueOfType<String>(json, r'device')!,
        enabled: mapValueOfType<bool>(json, r'enabled')!,
        hideFromLibrary: mapValueOfType<bool>(json, r'hideFromLibrary')!,
        modelName: mapValueOfType<String>(json, r'modelName')!,
        threshold: (mapValueOfType<num>(json, r'threshold')!).toDouble(),
      );
    }
    return null;
  }

  static List<NsfwDetectionConfig> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <NsfwDetectionConfig>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = NsfwDetectionConfig.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, NsfwDetectionConfig> mapFromJson(dynamic json) {
    final map = <String, NsfwDetectionConfig>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = NsfwDetectionConfig.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of NsfwDetectionConfig-objects as value to a dart map
  static Map<String, List<NsfwDetectionConfig>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<NsfwDetectionConfig>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = NsfwDetectionConfig.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'device',
    'enabled',
    'hideFromLibrary',
    'modelName',
    'threshold',
  };
}


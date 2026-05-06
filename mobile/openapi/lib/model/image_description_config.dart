//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ImageDescriptionConfig {
  /// Returns a new [ImageDescriptionConfig] instance.
  ImageDescriptionConfig({
    required this.device,
    required this.enabled,
    required this.fallbackModelName,
    required this.modelName,
  });

  /// OpenVINO device to use
  String device;

  /// Whether the task is enabled
  bool enabled;

  /// Name of the fallback model to use
  String fallbackModelName;

  /// Name of the model to use
  String modelName;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ImageDescriptionConfig &&
    other.device == device &&
    other.enabled == enabled &&
    other.fallbackModelName == fallbackModelName &&
    other.modelName == modelName;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (device.hashCode) +
    (enabled.hashCode) +
    (fallbackModelName.hashCode) +
    (modelName.hashCode);

  @override
  String toString() => 'ImageDescriptionConfig[device=$device, enabled=$enabled, fallbackModelName=$fallbackModelName, modelName=$modelName]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'device'] = this.device;
      json[r'enabled'] = this.enabled;
      json[r'fallbackModelName'] = this.fallbackModelName;
      json[r'modelName'] = this.modelName;
    return json;
  }

  /// Returns a new [ImageDescriptionConfig] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ImageDescriptionConfig? fromJson(dynamic value) {
    upgradeDto(value, "ImageDescriptionConfig");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return ImageDescriptionConfig(
        device: mapValueOfType<String>(json, r'device')!,
        enabled: mapValueOfType<bool>(json, r'enabled')!,
        fallbackModelName: mapValueOfType<String>(json, r'fallbackModelName')!,
        modelName: mapValueOfType<String>(json, r'modelName')!,
      );
    }
    return null;
  }

  static List<ImageDescriptionConfig> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ImageDescriptionConfig>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ImageDescriptionConfig.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ImageDescriptionConfig> mapFromJson(dynamic json) {
    final map = <String, ImageDescriptionConfig>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ImageDescriptionConfig.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ImageDescriptionConfig-objects as value to a dart map
  static Map<String, List<ImageDescriptionConfig>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ImageDescriptionConfig>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ImageDescriptionConfig.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'device',
    'enabled',
    'fallbackModelName',
    'modelName',
  };
}


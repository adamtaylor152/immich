//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class DuplicateDetectionConfig {
  /// Returns a new [DuplicateDetectionConfig] instance.
  DuplicateDetectionConfig({
    required this.enabled,
    required this.enhancedVideo,
    required this.maxDistance,
    required this.preferOriginalFormat,
  });

  /// Whether the task is enabled
  bool enabled;

  DuplicateDetectionConfigEnhancedVideo enhancedVideo;

  /// Maximum distance threshold for duplicate detection
  ///
  /// Minimum value: 0.001
  /// Maximum value: 0.1
  double maxDistance;

  /// When suggesting which duplicate to keep, prefer native camera originals (RAW, then HEIC/HEIF) over re-encoded formats such as JPG, regardless of file size
  bool preferOriginalFormat;

  @override
  bool operator ==(Object other) => identical(this, other) || other is DuplicateDetectionConfig &&
    other.enabled == enabled &&
    other.enhancedVideo == enhancedVideo &&
    other.maxDistance == maxDistance &&
    other.preferOriginalFormat == preferOriginalFormat;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (enabled.hashCode) +
    (enhancedVideo.hashCode) +
    (maxDistance.hashCode) +
    (preferOriginalFormat.hashCode);

  @override
  String toString() => 'DuplicateDetectionConfig[enabled=$enabled, enhancedVideo=$enhancedVideo, maxDistance=$maxDistance, preferOriginalFormat=$preferOriginalFormat]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'enabled'] = this.enabled;
      json[r'enhancedVideo'] = this.enhancedVideo;
      json[r'maxDistance'] = this.maxDistance;
      json[r'preferOriginalFormat'] = this.preferOriginalFormat;
    return json;
  }

  /// Returns a new [DuplicateDetectionConfig] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static DuplicateDetectionConfig? fromJson(dynamic value) {
    upgradeDto(value, "DuplicateDetectionConfig");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return DuplicateDetectionConfig(
        enabled: mapValueOfType<bool>(json, r'enabled')!,
        enhancedVideo: DuplicateDetectionConfigEnhancedVideo.fromJson(json[r'enhancedVideo'])!,
        maxDistance: (mapValueOfType<num>(json, r'maxDistance')!).toDouble(),
        preferOriginalFormat: mapValueOfType<bool>(json, r'preferOriginalFormat')!,
      );
    }
    return null;
  }

  static List<DuplicateDetectionConfig> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <DuplicateDetectionConfig>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = DuplicateDetectionConfig.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, DuplicateDetectionConfig> mapFromJson(dynamic json) {
    final map = <String, DuplicateDetectionConfig>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = DuplicateDetectionConfig.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of DuplicateDetectionConfig-objects as value to a dart map
  static Map<String, List<DuplicateDetectionConfig>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<DuplicateDetectionConfig>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = DuplicateDetectionConfig.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'enabled',
    'enhancedVideo',
    'maxDistance',
    'preferOriginalFormat',
  };
}


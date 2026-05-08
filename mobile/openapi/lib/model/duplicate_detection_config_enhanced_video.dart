//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class DuplicateDetectionConfigEnhancedVideo {
  /// Returns a new [DuplicateDetectionConfigEnhancedVideo] instance.
  DuplicateDetectionConfigEnhancedVideo({
    required this.enabled,
    required this.frameCount,
    required this.maxDistance,
    required this.minMatchingFrames,
  });

  /// Whether enhanced video duplicate detection is enabled
  bool enabled;

  /// Number of video frames to sample for duplicate confirmation
  ///
  /// Minimum value: 2
  /// Maximum value: 8
  int frameCount;

  /// Maximum distance threshold for enhanced video duplicate frame matching
  ///
  /// Minimum value: 0.001
  /// Maximum value: 0.1
  double maxDistance;

  /// Minimum matching sampled frames required to confirm a video duplicate
  ///
  /// Minimum value: 1
  /// Maximum value: 8
  int minMatchingFrames;

  @override
  bool operator ==(Object other) => identical(this, other) || other is DuplicateDetectionConfigEnhancedVideo &&
    other.enabled == enabled &&
    other.frameCount == frameCount &&
    other.maxDistance == maxDistance &&
    other.minMatchingFrames == minMatchingFrames;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (enabled.hashCode) +
    (frameCount.hashCode) +
    (maxDistance.hashCode) +
    (minMatchingFrames.hashCode);

  @override
  String toString() => 'DuplicateDetectionConfigEnhancedVideo[enabled=$enabled, frameCount=$frameCount, maxDistance=$maxDistance, minMatchingFrames=$minMatchingFrames]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'enabled'] = this.enabled;
      json[r'frameCount'] = this.frameCount;
      json[r'maxDistance'] = this.maxDistance;
      json[r'minMatchingFrames'] = this.minMatchingFrames;
    return json;
  }

  /// Returns a new [DuplicateDetectionConfigEnhancedVideo] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static DuplicateDetectionConfigEnhancedVideo? fromJson(dynamic value) {
    upgradeDto(value, "DuplicateDetectionConfigEnhancedVideo");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return DuplicateDetectionConfigEnhancedVideo(
        enabled: mapValueOfType<bool>(json, r'enabled')!,
        frameCount: mapValueOfType<int>(json, r'frameCount')!,
        maxDistance: (mapValueOfType<num>(json, r'maxDistance')!).toDouble(),
        minMatchingFrames: mapValueOfType<int>(json, r'minMatchingFrames')!,
      );
    }
    return null;
  }

  static List<DuplicateDetectionConfigEnhancedVideo> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <DuplicateDetectionConfigEnhancedVideo>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = DuplicateDetectionConfigEnhancedVideo.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, DuplicateDetectionConfigEnhancedVideo> mapFromJson(dynamic json) {
    final map = <String, DuplicateDetectionConfigEnhancedVideo>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = DuplicateDetectionConfigEnhancedVideo.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of DuplicateDetectionConfigEnhancedVideo-objects as value to a dart map
  static Map<String, List<DuplicateDetectionConfigEnhancedVideo>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<DuplicateDetectionConfigEnhancedVideo>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = DuplicateDetectionConfigEnhancedVideo.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'enabled',
    'frameCount',
    'maxDistance',
    'minMatchingFrames',
  };
}


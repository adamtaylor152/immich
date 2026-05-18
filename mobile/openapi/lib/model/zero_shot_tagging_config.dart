//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ZeroShotTaggingConfig {
  /// Returns a new [ZeroShotTaggingConfig] instance.
  ZeroShotTaggingConfig({
    required this.enabled,
    required this.maxTags,
    required this.minSimilarity,
  });

  /// Whether zero-shot auto-tagging is enabled
  bool enabled;

  /// Maximum number of zero-shot tags applied per asset
  ///
  /// Minimum value: 1
  /// Maximum value: 20
  int maxTags;

  /// Cosine similarity above which a label is applied as a tag
  ///
  /// Minimum value: 0
  /// Maximum value: 1
  double minSimilarity;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ZeroShotTaggingConfig &&
    other.enabled == enabled &&
    other.maxTags == maxTags &&
    other.minSimilarity == minSimilarity;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (enabled.hashCode) +
    (maxTags.hashCode) +
    (minSimilarity.hashCode);

  @override
  String toString() => 'ZeroShotTaggingConfig[enabled=$enabled, maxTags=$maxTags, minSimilarity=$minSimilarity]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'enabled'] = this.enabled;
      json[r'maxTags'] = this.maxTags;
      json[r'minSimilarity'] = this.minSimilarity;
    return json;
  }

  /// Returns a new [ZeroShotTaggingConfig] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ZeroShotTaggingConfig? fromJson(dynamic value) {
    upgradeDto(value, "ZeroShotTaggingConfig");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return ZeroShotTaggingConfig(
        enabled: mapValueOfType<bool>(json, r'enabled')!,
        maxTags: mapValueOfType<int>(json, r'maxTags')!,
        minSimilarity: (mapValueOfType<num>(json, r'minSimilarity')!).toDouble(),
      );
    }
    return null;
  }

  static List<ZeroShotTaggingConfig> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ZeroShotTaggingConfig>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ZeroShotTaggingConfig.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ZeroShotTaggingConfig> mapFromJson(dynamic json) {
    final map = <String, ZeroShotTaggingConfig>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ZeroShotTaggingConfig.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ZeroShotTaggingConfig-objects as value to a dart map
  static Map<String, List<ZeroShotTaggingConfig>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ZeroShotTaggingConfig>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ZeroShotTaggingConfig.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'enabled',
    'maxTags',
    'minSimilarity',
  };
}


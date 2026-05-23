//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SmartAlbumKindConfig {
  /// Returns a new [SmartAlbumKindConfig] instance.
  SmartAlbumKindConfig({
    this.clipQueries = const [],
    required this.enabled,
    required this.name,
    this.tagTriggers = const [],
    required this.threshold,
  });

  /// CLIP query phrases used when no tag trigger matches
  List<String> clipQueries;

  /// Whether this smart album is active
  bool enabled;

  /// User-visible album name
  String name;

  /// Tags that mark an asset as belonging to this album
  List<String> tagTriggers;

  /// CLIP similarity threshold
  ///
  /// Minimum value: 0
  /// Maximum value: 1
  double threshold;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SmartAlbumKindConfig &&
    _deepEquality.equals(other.clipQueries, clipQueries) &&
    other.enabled == enabled &&
    other.name == name &&
    _deepEquality.equals(other.tagTriggers, tagTriggers) &&
    other.threshold == threshold;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (clipQueries.hashCode) +
    (enabled.hashCode) +
    (name.hashCode) +
    (tagTriggers.hashCode) +
    (threshold.hashCode);

  @override
  String toString() => 'SmartAlbumKindConfig[clipQueries=$clipQueries, enabled=$enabled, name=$name, tagTriggers=$tagTriggers, threshold=$threshold]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'clipQueries'] = this.clipQueries;
      json[r'enabled'] = this.enabled;
      json[r'name'] = this.name;
      json[r'tagTriggers'] = this.tagTriggers;
      json[r'threshold'] = this.threshold;
    return json;
  }

  /// Returns a new [SmartAlbumKindConfig] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SmartAlbumKindConfig? fromJson(dynamic value) {
    upgradeDto(value, "SmartAlbumKindConfig");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SmartAlbumKindConfig(
        clipQueries: json[r'clipQueries'] is Iterable
            ? (json[r'clipQueries'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        enabled: mapValueOfType<bool>(json, r'enabled')!,
        name: mapValueOfType<String>(json, r'name')!,
        tagTriggers: json[r'tagTriggers'] is Iterable
            ? (json[r'tagTriggers'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        threshold: (mapValueOfType<num>(json, r'threshold')!).toDouble(),
      );
    }
    return null;
  }

  static List<SmartAlbumKindConfig> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SmartAlbumKindConfig>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SmartAlbumKindConfig.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SmartAlbumKindConfig> mapFromJson(dynamic json) {
    final map = <String, SmartAlbumKindConfig>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SmartAlbumKindConfig.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SmartAlbumKindConfig-objects as value to a dart map
  static Map<String, List<SmartAlbumKindConfig>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SmartAlbumKindConfig>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SmartAlbumKindConfig.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'clipQueries',
    'enabled',
    'name',
    'tagTriggers',
    'threshold',
  };
}


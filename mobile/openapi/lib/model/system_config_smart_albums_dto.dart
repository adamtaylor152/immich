//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SystemConfigSmartAlbumsDto {
  /// Returns a new [SystemConfigSmartAlbumsDto] instance.
  SystemConfigSmartAlbumsDto({
    required this.builtIn,
    required this.enabled,
  });

  SystemConfigSmartAlbumsDtoBuiltIn builtIn;

  /// Master smart-album enabled toggle
  bool enabled;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SystemConfigSmartAlbumsDto &&
    other.builtIn == builtIn &&
    other.enabled == enabled;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (builtIn.hashCode) +
    (enabled.hashCode);

  @override
  String toString() => 'SystemConfigSmartAlbumsDto[builtIn=$builtIn, enabled=$enabled]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'builtIn'] = this.builtIn;
      json[r'enabled'] = this.enabled;
    return json;
  }

  /// Returns a new [SystemConfigSmartAlbumsDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SystemConfigSmartAlbumsDto? fromJson(dynamic value) {
    upgradeDto(value, "SystemConfigSmartAlbumsDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SystemConfigSmartAlbumsDto(
        builtIn: SystemConfigSmartAlbumsDtoBuiltIn.fromJson(json[r'builtIn'])!,
        enabled: mapValueOfType<bool>(json, r'enabled')!,
      );
    }
    return null;
  }

  static List<SystemConfigSmartAlbumsDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SystemConfigSmartAlbumsDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SystemConfigSmartAlbumsDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SystemConfigSmartAlbumsDto> mapFromJson(dynamic json) {
    final map = <String, SystemConfigSmartAlbumsDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SystemConfigSmartAlbumsDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SystemConfigSmartAlbumsDto-objects as value to a dart map
  static Map<String, List<SystemConfigSmartAlbumsDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SystemConfigSmartAlbumsDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SystemConfigSmartAlbumsDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'builtIn',
    'enabled',
  };
}


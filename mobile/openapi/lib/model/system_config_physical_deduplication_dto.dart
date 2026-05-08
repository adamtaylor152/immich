//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SystemConfigPhysicalDeduplicationDto {
  /// Returns a new [SystemConfigPhysicalDeduplicationDto] instance.
  SystemConfigPhysicalDeduplicationDto({
    required this.enabled,
    required this.masterUserId,
  });

  /// Enabled
  bool enabled;

  /// Master user ID
  String? masterUserId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SystemConfigPhysicalDeduplicationDto &&
    other.enabled == enabled &&
    other.masterUserId == masterUserId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (enabled.hashCode) +
    (masterUserId == null ? 0 : masterUserId!.hashCode);

  @override
  String toString() => 'SystemConfigPhysicalDeduplicationDto[enabled=$enabled, masterUserId=$masterUserId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'enabled'] = this.enabled;
    if (this.masterUserId != null) {
      json[r'masterUserId'] = this.masterUserId;
    } else {
    //  json[r'masterUserId'] = null;
    }
    return json;
  }

  /// Returns a new [SystemConfigPhysicalDeduplicationDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SystemConfigPhysicalDeduplicationDto? fromJson(dynamic value) {
    upgradeDto(value, "SystemConfigPhysicalDeduplicationDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SystemConfigPhysicalDeduplicationDto(
        enabled: mapValueOfType<bool>(json, r'enabled')!,
        masterUserId: mapValueOfType<String>(json, r'masterUserId'),
      );
    }
    return null;
  }

  static List<SystemConfigPhysicalDeduplicationDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SystemConfigPhysicalDeduplicationDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SystemConfigPhysicalDeduplicationDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SystemConfigPhysicalDeduplicationDto> mapFromJson(dynamic json) {
    final map = <String, SystemConfigPhysicalDeduplicationDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SystemConfigPhysicalDeduplicationDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SystemConfigPhysicalDeduplicationDto-objects as value to a dart map
  static Map<String, List<SystemConfigPhysicalDeduplicationDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SystemConfigPhysicalDeduplicationDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SystemConfigPhysicalDeduplicationDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'enabled',
    'masterUserId',
  };
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SystemConfigSmartAlbumsDtoBuiltIn {
  /// Returns a new [SystemConfigSmartAlbumsDtoBuiltIn] instance.
  SystemConfigSmartAlbumsDtoBuiltIn({
    required this.documents,
    required this.food,
    required this.nature,
    required this.pets,
    required this.screenshots,
    required this.travel,
  });

  SmartAlbumKindConfig documents;

  SmartAlbumKindConfig food;

  SmartAlbumKindConfig nature;

  SmartAlbumKindConfig pets;

  SmartAlbumKindConfig screenshots;

  SmartAlbumKindConfig travel;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SystemConfigSmartAlbumsDtoBuiltIn &&
    other.documents == documents &&
    other.food == food &&
    other.nature == nature &&
    other.pets == pets &&
    other.screenshots == screenshots &&
    other.travel == travel;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (documents.hashCode) +
    (food.hashCode) +
    (nature.hashCode) +
    (pets.hashCode) +
    (screenshots.hashCode) +
    (travel.hashCode);

  @override
  String toString() => 'SystemConfigSmartAlbumsDtoBuiltIn[documents=$documents, food=$food, nature=$nature, pets=$pets, screenshots=$screenshots, travel=$travel]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'documents'] = this.documents;
      json[r'food'] = this.food;
      json[r'nature'] = this.nature;
      json[r'pets'] = this.pets;
      json[r'screenshots'] = this.screenshots;
      json[r'travel'] = this.travel;
    return json;
  }

  /// Returns a new [SystemConfigSmartAlbumsDtoBuiltIn] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SystemConfigSmartAlbumsDtoBuiltIn? fromJson(dynamic value) {
    upgradeDto(value, "SystemConfigSmartAlbumsDtoBuiltIn");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SystemConfigSmartAlbumsDtoBuiltIn(
        documents: SmartAlbumKindConfig.fromJson(json[r'documents'])!,
        food: SmartAlbumKindConfig.fromJson(json[r'food'])!,
        nature: SmartAlbumKindConfig.fromJson(json[r'nature'])!,
        pets: SmartAlbumKindConfig.fromJson(json[r'pets'])!,
        screenshots: SmartAlbumKindConfig.fromJson(json[r'screenshots'])!,
        travel: SmartAlbumKindConfig.fromJson(json[r'travel'])!,
      );
    }
    return null;
  }

  static List<SystemConfigSmartAlbumsDtoBuiltIn> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SystemConfigSmartAlbumsDtoBuiltIn>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SystemConfigSmartAlbumsDtoBuiltIn.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SystemConfigSmartAlbumsDtoBuiltIn> mapFromJson(dynamic json) {
    final map = <String, SystemConfigSmartAlbumsDtoBuiltIn>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SystemConfigSmartAlbumsDtoBuiltIn.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SystemConfigSmartAlbumsDtoBuiltIn-objects as value to a dart map
  static Map<String, List<SystemConfigSmartAlbumsDtoBuiltIn>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SystemConfigSmartAlbumsDtoBuiltIn>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SystemConfigSmartAlbumsDtoBuiltIn.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'documents',
    'food',
    'nature',
    'pets',
    'screenshots',
    'travel',
  };
}


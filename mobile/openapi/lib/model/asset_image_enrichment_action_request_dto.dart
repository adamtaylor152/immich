//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AssetImageEnrichmentActionRequestDto {
  /// Returns a new [AssetImageEnrichmentActionRequestDto] instance.
  AssetImageEnrichmentActionRequestDto({
    required this.action,
  });

  AssetImageEnrichmentAction action;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AssetImageEnrichmentActionRequestDto &&
    other.action == action;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (action.hashCode);

  @override
  String toString() => 'AssetImageEnrichmentActionRequestDto[action=$action]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'action'] = this.action;
    return json;
  }

  /// Returns a new [AssetImageEnrichmentActionRequestDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AssetImageEnrichmentActionRequestDto? fromJson(dynamic value) {
    upgradeDto(value, "AssetImageEnrichmentActionRequestDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AssetImageEnrichmentActionRequestDto(
        action: AssetImageEnrichmentAction.fromJson(json[r'action'])!,
      );
    }
    return null;
  }

  static List<AssetImageEnrichmentActionRequestDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AssetImageEnrichmentActionRequestDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AssetImageEnrichmentActionRequestDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AssetImageEnrichmentActionRequestDto> mapFromJson(dynamic json) {
    final map = <String, AssetImageEnrichmentActionRequestDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AssetImageEnrichmentActionRequestDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AssetImageEnrichmentActionRequestDto-objects as value to a dart map
  static Map<String, List<AssetImageEnrichmentActionRequestDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AssetImageEnrichmentActionRequestDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AssetImageEnrichmentActionRequestDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'action',
  };
}


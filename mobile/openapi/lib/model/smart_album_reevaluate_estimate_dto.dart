//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SmartAlbumReevaluateEstimateDto {
  /// Returns a new [SmartAlbumReevaluateEstimateDto] instance.
  SmartAlbumReevaluateEstimateDto({
    required this.totalAssets,
    required this.withDescription,
  });

  /// Total image assets that will be evaluated (currently equals withDescription)
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int totalAssets;

  /// Image assets with a successfully completed description
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int withDescription;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SmartAlbumReevaluateEstimateDto &&
    other.totalAssets == totalAssets &&
    other.withDescription == withDescription;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (totalAssets.hashCode) +
    (withDescription.hashCode);

  @override
  String toString() => 'SmartAlbumReevaluateEstimateDto[totalAssets=$totalAssets, withDescription=$withDescription]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'totalAssets'] = this.totalAssets;
      json[r'withDescription'] = this.withDescription;
    return json;
  }

  /// Returns a new [SmartAlbumReevaluateEstimateDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SmartAlbumReevaluateEstimateDto? fromJson(dynamic value) {
    upgradeDto(value, "SmartAlbumReevaluateEstimateDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SmartAlbumReevaluateEstimateDto(
        totalAssets: mapValueOfType<int>(json, r'totalAssets')!,
        withDescription: mapValueOfType<int>(json, r'withDescription')!,
      );
    }
    return null;
  }

  static List<SmartAlbumReevaluateEstimateDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SmartAlbumReevaluateEstimateDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SmartAlbumReevaluateEstimateDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SmartAlbumReevaluateEstimateDto> mapFromJson(dynamic json) {
    final map = <String, SmartAlbumReevaluateEstimateDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SmartAlbumReevaluateEstimateDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SmartAlbumReevaluateEstimateDto-objects as value to a dart map
  static Map<String, List<SmartAlbumReevaluateEstimateDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SmartAlbumReevaluateEstimateDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SmartAlbumReevaluateEstimateDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'totalAssets',
    'withDescription',
  };
}


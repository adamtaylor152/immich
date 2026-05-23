//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ImageDescriptionRequeueEstimateDto {
  /// Returns a new [ImageDescriptionRequeueEstimateDto] instance.
  ImageDescriptionRequeueEstimateDto({
    required this.activeBackend,
    required this.activeModel,
    required this.estimatedTotalSeconds,
    required this.rollingAvgSeconds,
    required this.totalAssets,
    required this.withDescription,
    required this.withoutDescription,
  });

  /// Configured hardware acceleration backend (e.g. \"auto\", \"cuda\")
  String activeBackend;

  /// Configured image description model name
  String activeModel;

  /// Estimated wall-clock time to re-describe every eligible asset (force mode: every asset is re-processed, not just those without descriptions).
  ///
  /// Minimum value: 0
  double estimatedTotalSeconds;

  /// Average seconds per asset, computed as a rolling mean of the most recent 100 completed image-description jobs. Falls back to a 1.5s default when no jobs have completed since the server started.
  ///
  /// Minimum value: 0
  double rollingAvgSeconds;

  /// Total eligible image assets
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int totalAssets;

  /// Number of eligible assets that currently have a description (will be re-run on force-requeue).
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int withDescription;

  /// Number of eligible assets that currently have no description.
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int withoutDescription;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ImageDescriptionRequeueEstimateDto &&
    other.activeBackend == activeBackend &&
    other.activeModel == activeModel &&
    other.estimatedTotalSeconds == estimatedTotalSeconds &&
    other.rollingAvgSeconds == rollingAvgSeconds &&
    other.totalAssets == totalAssets &&
    other.withDescription == withDescription &&
    other.withoutDescription == withoutDescription;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (activeBackend.hashCode) +
    (activeModel.hashCode) +
    (estimatedTotalSeconds.hashCode) +
    (rollingAvgSeconds.hashCode) +
    (totalAssets.hashCode) +
    (withDescription.hashCode) +
    (withoutDescription.hashCode);

  @override
  String toString() => 'ImageDescriptionRequeueEstimateDto[activeBackend=$activeBackend, activeModel=$activeModel, estimatedTotalSeconds=$estimatedTotalSeconds, rollingAvgSeconds=$rollingAvgSeconds, totalAssets=$totalAssets, withDescription=$withDescription, withoutDescription=$withoutDescription]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'activeBackend'] = this.activeBackend;
      json[r'activeModel'] = this.activeModel;
      json[r'estimatedTotalSeconds'] = this.estimatedTotalSeconds;
      json[r'rollingAvgSeconds'] = this.rollingAvgSeconds;
      json[r'totalAssets'] = this.totalAssets;
      json[r'withDescription'] = this.withDescription;
      json[r'withoutDescription'] = this.withoutDescription;
    return json;
  }

  /// Returns a new [ImageDescriptionRequeueEstimateDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ImageDescriptionRequeueEstimateDto? fromJson(dynamic value) {
    upgradeDto(value, "ImageDescriptionRequeueEstimateDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return ImageDescriptionRequeueEstimateDto(
        activeBackend: mapValueOfType<String>(json, r'activeBackend')!,
        activeModel: mapValueOfType<String>(json, r'activeModel')!,
        estimatedTotalSeconds: (mapValueOfType<num>(json, r'estimatedTotalSeconds')!).toDouble(),
        rollingAvgSeconds: (mapValueOfType<num>(json, r'rollingAvgSeconds')!).toDouble(),
        totalAssets: mapValueOfType<int>(json, r'totalAssets')!,
        withDescription: mapValueOfType<int>(json, r'withDescription')!,
        withoutDescription: mapValueOfType<int>(json, r'withoutDescription')!,
      );
    }
    return null;
  }

  static List<ImageDescriptionRequeueEstimateDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ImageDescriptionRequeueEstimateDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ImageDescriptionRequeueEstimateDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ImageDescriptionRequeueEstimateDto> mapFromJson(dynamic json) {
    final map = <String, ImageDescriptionRequeueEstimateDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ImageDescriptionRequeueEstimateDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ImageDescriptionRequeueEstimateDto-objects as value to a dart map
  static Map<String, List<ImageDescriptionRequeueEstimateDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ImageDescriptionRequeueEstimateDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ImageDescriptionRequeueEstimateDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'activeBackend',
    'activeModel',
    'estimatedTotalSeconds',
    'rollingAvgSeconds',
    'totalAssets',
    'withDescription',
    'withoutDescription',
  };
}


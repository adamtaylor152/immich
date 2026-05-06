//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SystemConfigMachineLearningDto {
  /// Returns a new [SystemConfigMachineLearningDto] instance.
  SystemConfigMachineLearningDto({
    required this.availabilityChecks,
    required this.clip,
    required this.duplicateDetection,
    required this.enabled,
    required this.facialRecognition,
    this.imageDescription,
    this.nsfwDetection,
    required this.ocr,
    this.urls = const [],
  });

  MachineLearningAvailabilityChecksDto availabilityChecks;

  CLIPConfig clip;

  DuplicateDetectionConfig duplicateDetection;

  /// Enabled
  bool enabled;

  FacialRecognitionConfig facialRecognition;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  ImageDescriptionConfig? imageDescription;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  NsfwDetectionConfig? nsfwDetection;

  OcrConfig ocr;

  /// ML service URLs
  List<String> urls;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SystemConfigMachineLearningDto &&
    other.availabilityChecks == availabilityChecks &&
    other.clip == clip &&
    other.duplicateDetection == duplicateDetection &&
    other.enabled == enabled &&
    other.facialRecognition == facialRecognition &&
    other.imageDescription == imageDescription &&
    other.nsfwDetection == nsfwDetection &&
    other.ocr == ocr &&
    _deepEquality.equals(other.urls, urls);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (availabilityChecks.hashCode) +
    (clip.hashCode) +
    (duplicateDetection.hashCode) +
    (enabled.hashCode) +
    (facialRecognition.hashCode) +
    (imageDescription == null ? 0 : imageDescription!.hashCode) +
    (nsfwDetection == null ? 0 : nsfwDetection!.hashCode) +
    (ocr.hashCode) +
    (urls.hashCode);

  @override
  String toString() => 'SystemConfigMachineLearningDto[availabilityChecks=$availabilityChecks, clip=$clip, duplicateDetection=$duplicateDetection, enabled=$enabled, facialRecognition=$facialRecognition, imageDescription=$imageDescription, nsfwDetection=$nsfwDetection, ocr=$ocr, urls=$urls]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'availabilityChecks'] = this.availabilityChecks;
      json[r'clip'] = this.clip;
      json[r'duplicateDetection'] = this.duplicateDetection;
      json[r'enabled'] = this.enabled;
      json[r'facialRecognition'] = this.facialRecognition;
    if (this.imageDescription != null) {
      json[r'imageDescription'] = this.imageDescription;
    } else {
    //  json[r'imageDescription'] = null;
    }
    if (this.nsfwDetection != null) {
      json[r'nsfwDetection'] = this.nsfwDetection;
    } else {
    //  json[r'nsfwDetection'] = null;
    }
      json[r'ocr'] = this.ocr;
      json[r'urls'] = this.urls;
    return json;
  }

  /// Returns a new [SystemConfigMachineLearningDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SystemConfigMachineLearningDto? fromJson(dynamic value) {
    upgradeDto(value, "SystemConfigMachineLearningDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SystemConfigMachineLearningDto(
        availabilityChecks: MachineLearningAvailabilityChecksDto.fromJson(json[r'availabilityChecks'])!,
        clip: CLIPConfig.fromJson(json[r'clip'])!,
        duplicateDetection: DuplicateDetectionConfig.fromJson(json[r'duplicateDetection'])!,
        enabled: mapValueOfType<bool>(json, r'enabled')!,
        facialRecognition: FacialRecognitionConfig.fromJson(json[r'facialRecognition'])!,
        imageDescription: ImageDescriptionConfig.fromJson(json[r'imageDescription']),
        nsfwDetection: NsfwDetectionConfig.fromJson(json[r'nsfwDetection']),
        ocr: OcrConfig.fromJson(json[r'ocr'])!,
        urls: json[r'urls'] is Iterable
            ? (json[r'urls'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<SystemConfigMachineLearningDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SystemConfigMachineLearningDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SystemConfigMachineLearningDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SystemConfigMachineLearningDto> mapFromJson(dynamic json) {
    final map = <String, SystemConfigMachineLearningDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SystemConfigMachineLearningDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SystemConfigMachineLearningDto-objects as value to a dart map
  static Map<String, List<SystemConfigMachineLearningDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SystemConfigMachineLearningDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SystemConfigMachineLearningDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'availabilityChecks',
    'clip',
    'duplicateDetection',
    'enabled',
    'facialRecognition',
    'ocr',
    'urls',
  };
}


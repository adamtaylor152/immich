//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SystemConfigJobDto {
  /// Returns a new [SystemConfigJobDto] instance.
  SystemConfigJobDto({
    required this.backgroundTask,
    required this.editor,
    required this.faceDetection,
    this.imageDescription,
    this.imageEnrichment,
    required this.library_,
    required this.metadataExtraction,
    required this.migration,
    required this.notifications,
    this.nsfwDetection,
    required this.ocr,
    required this.search,
    required this.sidecar,
    required this.smartSearch,
    required this.thumbnailGeneration,
    required this.videoConversion,
    required this.videoDuplicateDetection,
    required this.workflow,
  });

  JobSettingsDto backgroundTask;

  JobSettingsDto editor;

  JobSettingsDto faceDetection;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  JobSettingsDto? imageDescription;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  JobSettingsDto? imageEnrichment;

  JobSettingsDto library_;

  JobSettingsDto metadataExtraction;

  JobSettingsDto migration;

  JobSettingsDto notifications;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  JobSettingsDto? nsfwDetection;

  JobSettingsDto ocr;

  JobSettingsDto search;

  JobSettingsDto sidecar;

  JobSettingsDto smartSearch;

  JobSettingsDto thumbnailGeneration;

  JobSettingsDto videoConversion;

  JobSettingsDto videoDuplicateDetection;

  JobSettingsDto workflow;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SystemConfigJobDto &&
    other.backgroundTask == backgroundTask &&
    other.editor == editor &&
    other.faceDetection == faceDetection &&
    other.imageDescription == imageDescription &&
    other.imageEnrichment == imageEnrichment &&
    other.library_ == library_ &&
    other.metadataExtraction == metadataExtraction &&
    other.migration == migration &&
    other.notifications == notifications &&
    other.nsfwDetection == nsfwDetection &&
    other.ocr == ocr &&
    other.search == search &&
    other.sidecar == sidecar &&
    other.smartSearch == smartSearch &&
    other.thumbnailGeneration == thumbnailGeneration &&
    other.videoConversion == videoConversion &&
    other.videoDuplicateDetection == videoDuplicateDetection &&
    other.workflow == workflow;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (backgroundTask.hashCode) +
    (editor.hashCode) +
    (faceDetection.hashCode) +
    (imageDescription == null ? 0 : imageDescription!.hashCode) +
    (imageEnrichment == null ? 0 : imageEnrichment!.hashCode) +
    (library_.hashCode) +
    (metadataExtraction.hashCode) +
    (migration.hashCode) +
    (notifications.hashCode) +
    (nsfwDetection == null ? 0 : nsfwDetection!.hashCode) +
    (ocr.hashCode) +
    (search.hashCode) +
    (sidecar.hashCode) +
    (smartSearch.hashCode) +
    (thumbnailGeneration.hashCode) +
    (videoConversion.hashCode) +
    (videoDuplicateDetection.hashCode) +
    (workflow.hashCode);

  @override
  String toString() => 'SystemConfigJobDto[backgroundTask=$backgroundTask, editor=$editor, faceDetection=$faceDetection, imageDescription=$imageDescription, imageEnrichment=$imageEnrichment, library_=$library_, metadataExtraction=$metadataExtraction, migration=$migration, notifications=$notifications, nsfwDetection=$nsfwDetection, ocr=$ocr, search=$search, sidecar=$sidecar, smartSearch=$smartSearch, thumbnailGeneration=$thumbnailGeneration, videoConversion=$videoConversion, videoDuplicateDetection=$videoDuplicateDetection, workflow=$workflow]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'backgroundTask'] = this.backgroundTask;
      json[r'editor'] = this.editor;
      json[r'faceDetection'] = this.faceDetection;
    if (this.imageDescription != null) {
      json[r'imageDescription'] = this.imageDescription;
    } else {
    //  json[r'imageDescription'] = null;
    }
    if (this.imageEnrichment != null) {
      json[r'imageEnrichment'] = this.imageEnrichment;
    } else {
    //  json[r'imageEnrichment'] = null;
    }
      json[r'library'] = this.library_;
      json[r'metadataExtraction'] = this.metadataExtraction;
      json[r'migration'] = this.migration;
      json[r'notifications'] = this.notifications;
    if (this.nsfwDetection != null) {
      json[r'nsfwDetection'] = this.nsfwDetection;
    } else {
    //  json[r'nsfwDetection'] = null;
    }
      json[r'ocr'] = this.ocr;
      json[r'search'] = this.search;
      json[r'sidecar'] = this.sidecar;
      json[r'smartSearch'] = this.smartSearch;
      json[r'thumbnailGeneration'] = this.thumbnailGeneration;
      json[r'videoConversion'] = this.videoConversion;
      json[r'videoDuplicateDetection'] = this.videoDuplicateDetection;
      json[r'workflow'] = this.workflow;
    return json;
  }

  /// Returns a new [SystemConfigJobDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SystemConfigJobDto? fromJson(dynamic value) {
    upgradeDto(value, "SystemConfigJobDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SystemConfigJobDto(
        backgroundTask: JobSettingsDto.fromJson(json[r'backgroundTask'])!,
        editor: JobSettingsDto.fromJson(json[r'editor'])!,
        faceDetection: JobSettingsDto.fromJson(json[r'faceDetection'])!,
        imageDescription: JobSettingsDto.fromJson(json[r'imageDescription']),
        imageEnrichment: JobSettingsDto.fromJson(json[r'imageEnrichment']),
        library_: JobSettingsDto.fromJson(json[r'library'])!,
        metadataExtraction: JobSettingsDto.fromJson(json[r'metadataExtraction'])!,
        migration: JobSettingsDto.fromJson(json[r'migration'])!,
        notifications: JobSettingsDto.fromJson(json[r'notifications'])!,
        nsfwDetection: JobSettingsDto.fromJson(json[r'nsfwDetection']),
        ocr: JobSettingsDto.fromJson(json[r'ocr'])!,
        search: JobSettingsDto.fromJson(json[r'search'])!,
        sidecar: JobSettingsDto.fromJson(json[r'sidecar'])!,
        smartSearch: JobSettingsDto.fromJson(json[r'smartSearch'])!,
        thumbnailGeneration: JobSettingsDto.fromJson(json[r'thumbnailGeneration'])!,
        videoConversion: JobSettingsDto.fromJson(json[r'videoConversion'])!,
        videoDuplicateDetection: JobSettingsDto.fromJson(json[r'videoDuplicateDetection'])!,
        workflow: JobSettingsDto.fromJson(json[r'workflow'])!,
      );
    }
    return null;
  }

  static List<SystemConfigJobDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SystemConfigJobDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SystemConfigJobDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SystemConfigJobDto> mapFromJson(dynamic json) {
    final map = <String, SystemConfigJobDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SystemConfigJobDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SystemConfigJobDto-objects as value to a dart map
  static Map<String, List<SystemConfigJobDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SystemConfigJobDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SystemConfigJobDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'backgroundTask',
    'editor',
    'faceDetection',
    'library',
    'metadataExtraction',
    'migration',
    'notifications',
    'ocr',
    'search',
    'sidecar',
    'smartSearch',
    'thumbnailGeneration',
    'videoConversion',
    'videoDuplicateDetection',
    'workflow',
  };
}


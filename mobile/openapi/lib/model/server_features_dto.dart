//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ServerFeaturesDto {
  /// Returns a new [ServerFeaturesDto] instance.
  ServerFeaturesDto({
    required this.configFile,
    required this.duplicateDetection,
    required this.email,
    required this.facialRecognition,
    required this.imageDescription,
    required this.importFaces,
    required this.map,
    required this.nsfwDetection,
    required this.nsfwHiding,
    required this.oauth,
    required this.oauthAutoLaunch,
    required this.ocr,
    required this.passwordLogin,
    required this.physicalDeduplication,
    required this.reverseGeocoding,
    required this.search,
    required this.sidecar,
    required this.smartSearch,
    required this.trash,
  });

  /// Whether config file is available
  bool configFile;

  /// Whether duplicate detection is enabled
  bool duplicateDetection;

  /// Whether email notifications are enabled
  bool email;

  /// Whether facial recognition is enabled
  bool facialRecognition;

  /// Whether image description and tag generation is enabled
  bool imageDescription;

  /// Whether face import is enabled
  bool importFaces;

  /// Whether map feature is enabled
  bool map;

  /// Whether NSFW detection is enabled
  bool nsfwDetection;

  /// Whether NSFW-tagged assets are hidden from non-elevated library views
  bool nsfwHiding;

  /// Whether OAuth is enabled
  bool oauth;

  /// Whether OAuth auto-launch is enabled
  bool oauthAutoLaunch;

  /// Whether OCR is enabled
  bool ocr;

  /// Whether password login is enabled
  bool passwordLogin;

  /// Whether physical file deduplication is enabled
  bool physicalDeduplication;

  /// Whether reverse geocoding is enabled
  bool reverseGeocoding;

  /// Whether search is enabled
  bool search;

  /// Whether sidecar files are supported
  bool sidecar;

  /// Whether smart search is enabled
  bool smartSearch;

  /// Whether trash feature is enabled
  bool trash;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ServerFeaturesDto &&
    other.configFile == configFile &&
    other.duplicateDetection == duplicateDetection &&
    other.email == email &&
    other.facialRecognition == facialRecognition &&
    other.imageDescription == imageDescription &&
    other.importFaces == importFaces &&
    other.map == map &&
    other.nsfwDetection == nsfwDetection &&
    other.nsfwHiding == nsfwHiding &&
    other.oauth == oauth &&
    other.oauthAutoLaunch == oauthAutoLaunch &&
    other.ocr == ocr &&
    other.passwordLogin == passwordLogin &&
    other.physicalDeduplication == physicalDeduplication &&
    other.reverseGeocoding == reverseGeocoding &&
    other.search == search &&
    other.sidecar == sidecar &&
    other.smartSearch == smartSearch &&
    other.trash == trash;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (configFile.hashCode) +
    (duplicateDetection.hashCode) +
    (email.hashCode) +
    (facialRecognition.hashCode) +
    (imageDescription.hashCode) +
    (importFaces.hashCode) +
    (map.hashCode) +
    (nsfwDetection.hashCode) +
    (nsfwHiding.hashCode) +
    (oauth.hashCode) +
    (oauthAutoLaunch.hashCode) +
    (ocr.hashCode) +
    (passwordLogin.hashCode) +
    (physicalDeduplication.hashCode) +
    (reverseGeocoding.hashCode) +
    (search.hashCode) +
    (sidecar.hashCode) +
    (smartSearch.hashCode) +
    (trash.hashCode);

  @override
  String toString() => 'ServerFeaturesDto[configFile=$configFile, duplicateDetection=$duplicateDetection, email=$email, facialRecognition=$facialRecognition, imageDescription=$imageDescription, importFaces=$importFaces, map=$map, nsfwDetection=$nsfwDetection, nsfwHiding=$nsfwHiding, oauth=$oauth, oauthAutoLaunch=$oauthAutoLaunch, ocr=$ocr, passwordLogin=$passwordLogin, physicalDeduplication=$physicalDeduplication, reverseGeocoding=$reverseGeocoding, search=$search, sidecar=$sidecar, smartSearch=$smartSearch, trash=$trash]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'configFile'] = this.configFile;
      json[r'duplicateDetection'] = this.duplicateDetection;
      json[r'email'] = this.email;
      json[r'facialRecognition'] = this.facialRecognition;
      json[r'imageDescription'] = this.imageDescription;
      json[r'importFaces'] = this.importFaces;
      json[r'map'] = this.map;
      json[r'nsfwDetection'] = this.nsfwDetection;
      json[r'nsfwHiding'] = this.nsfwHiding;
      json[r'oauth'] = this.oauth;
      json[r'oauthAutoLaunch'] = this.oauthAutoLaunch;
      json[r'ocr'] = this.ocr;
      json[r'passwordLogin'] = this.passwordLogin;
      json[r'physicalDeduplication'] = this.physicalDeduplication;
      json[r'reverseGeocoding'] = this.reverseGeocoding;
      json[r'search'] = this.search;
      json[r'sidecar'] = this.sidecar;
      json[r'smartSearch'] = this.smartSearch;
      json[r'trash'] = this.trash;
    return json;
  }

  /// Returns a new [ServerFeaturesDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ServerFeaturesDto? fromJson(dynamic value) {
    upgradeDto(value, "ServerFeaturesDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return ServerFeaturesDto(
        configFile: mapValueOfType<bool>(json, r'configFile')!,
        duplicateDetection: mapValueOfType<bool>(json, r'duplicateDetection')!,
        email: mapValueOfType<bool>(json, r'email')!,
        facialRecognition: mapValueOfType<bool>(json, r'facialRecognition')!,
        imageDescription: mapValueOfType<bool>(json, r'imageDescription')!,
        importFaces: mapValueOfType<bool>(json, r'importFaces')!,
        map: mapValueOfType<bool>(json, r'map')!,
        nsfwDetection: mapValueOfType<bool>(json, r'nsfwDetection')!,
        nsfwHiding: mapValueOfType<bool>(json, r'nsfwHiding')!,
        oauth: mapValueOfType<bool>(json, r'oauth')!,
        oauthAutoLaunch: mapValueOfType<bool>(json, r'oauthAutoLaunch')!,
        ocr: mapValueOfType<bool>(json, r'ocr')!,
        passwordLogin: mapValueOfType<bool>(json, r'passwordLogin')!,
        physicalDeduplication: mapValueOfType<bool>(json, r'physicalDeduplication')!,
        reverseGeocoding: mapValueOfType<bool>(json, r'reverseGeocoding')!,
        search: mapValueOfType<bool>(json, r'search')!,
        sidecar: mapValueOfType<bool>(json, r'sidecar')!,
        smartSearch: mapValueOfType<bool>(json, r'smartSearch')!,
        trash: mapValueOfType<bool>(json, r'trash')!,
      );
    }
    return null;
  }

  static List<ServerFeaturesDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ServerFeaturesDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ServerFeaturesDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ServerFeaturesDto> mapFromJson(dynamic json) {
    final map = <String, ServerFeaturesDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ServerFeaturesDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ServerFeaturesDto-objects as value to a dart map
  static Map<String, List<ServerFeaturesDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ServerFeaturesDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ServerFeaturesDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'configFile',
    'duplicateDetection',
    'email',
    'facialRecognition',
    'imageDescription',
    'importFaces',
    'map',
    'nsfwDetection',
    'nsfwHiding',
    'oauth',
    'oauthAutoLaunch',
    'ocr',
    'passwordLogin',
    'physicalDeduplication',
    'reverseGeocoding',
    'search',
    'sidecar',
    'smartSearch',
    'trash',
  };
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AskSearchDto {
  /// Returns a new [AskSearchDto] instance.
  AskSearchDto({
    this.language,
    this.page,
    required this.query,
    this.size,
  });

  /// Search language code
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? language;

  /// Page number
  ///
  /// Minimum value: 1
  /// Maximum value: 9007199254740991
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? page;

  /// Natural language Ask Search query
  String query;

  /// Number of results to return
  ///
  /// Minimum value: 1
  /// Maximum value: 1000
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? size;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AskSearchDto &&
    other.language == language &&
    other.page == page &&
    other.query == query &&
    other.size == size;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (language == null ? 0 : language!.hashCode) +
    (page == null ? 0 : page!.hashCode) +
    (query.hashCode) +
    (size == null ? 0 : size!.hashCode);

  @override
  String toString() => 'AskSearchDto[language=$language, page=$page, query=$query, size=$size]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.language != null) {
      json[r'language'] = this.language;
    } else {
    //  json[r'language'] = null;
    }
    if (this.page != null) {
      json[r'page'] = this.page;
    } else {
    //  json[r'page'] = null;
    }
      json[r'query'] = this.query;
    if (this.size != null) {
      json[r'size'] = this.size;
    } else {
    //  json[r'size'] = null;
    }
    return json;
  }

  /// Returns a new [AskSearchDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AskSearchDto? fromJson(dynamic value) {
    upgradeDto(value, "AskSearchDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AskSearchDto(
        language: mapValueOfType<String>(json, r'language'),
        page: mapValueOfType<int>(json, r'page'),
        query: mapValueOfType<String>(json, r'query')!,
        size: mapValueOfType<int>(json, r'size'),
      );
    }
    return null;
  }

  static List<AskSearchDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AskSearchDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AskSearchDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AskSearchDto> mapFromJson(dynamic json) {
    final map = <String, AskSearchDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AskSearchDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AskSearchDto-objects as value to a dart map
  static Map<String, List<AskSearchDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AskSearchDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AskSearchDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'query',
  };
}


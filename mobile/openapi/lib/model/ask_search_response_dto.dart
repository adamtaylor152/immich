//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AskSearchResponseDto {
  /// Returns a new [AskSearchResponseDto] instance.
  AskSearchResponseDto({
    required this.explanation,
    required this.plan,
    required this.query,
    required this.results,
    this.warnings = const [],
  });

  /// Short explanation of how the query was interpreted
  String explanation;

  AskSearchPlanDto plan;

  /// Original Ask Search query
  String query;

  SearchResponseDto results;

  /// Unsupported or ambiguous parts of the query
  List<String> warnings;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AskSearchResponseDto &&
    other.explanation == explanation &&
    other.plan == plan &&
    other.query == query &&
    other.results == results &&
    _deepEquality.equals(other.warnings, warnings);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (explanation.hashCode) +
    (plan.hashCode) +
    (query.hashCode) +
    (results.hashCode) +
    (warnings.hashCode);

  @override
  String toString() => 'AskSearchResponseDto[explanation=$explanation, plan=$plan, query=$query, results=$results, warnings=$warnings]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'explanation'] = this.explanation;
      json[r'plan'] = this.plan;
      json[r'query'] = this.query;
      json[r'results'] = this.results;
      json[r'warnings'] = this.warnings;
    return json;
  }

  /// Returns a new [AskSearchResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AskSearchResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AskSearchResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AskSearchResponseDto(
        explanation: mapValueOfType<String>(json, r'explanation')!,
        plan: AskSearchPlanDto.fromJson(json[r'plan'])!,
        query: mapValueOfType<String>(json, r'query')!,
        results: SearchResponseDto.fromJson(json[r'results'])!,
        warnings: json[r'warnings'] is Iterable
            ? (json[r'warnings'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<AskSearchResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AskSearchResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AskSearchResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AskSearchResponseDto> mapFromJson(dynamic json) {
    final map = <String, AskSearchResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AskSearchResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AskSearchResponseDto-objects as value to a dart map
  static Map<String, List<AskSearchResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AskSearchResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AskSearchResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'explanation',
    'plan',
    'query',
    'results',
    'warnings',
  };
}


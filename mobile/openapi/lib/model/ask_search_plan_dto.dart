//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AskSearchPlanDto {
  /// Returns a new [AskSearchPlanDto] instance.
  AskSearchPlanDto({
    required this.filters,
    required this.mode,
    required this.normalizedQuery,
  });

  AskSearchPlanDtoFilters filters;

  /// Search mode used to answer the query
  AskSearchPlanDtoModeEnum mode;

  /// Normalized query text
  String normalizedQuery;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AskSearchPlanDto &&
    other.filters == filters &&
    other.mode == mode &&
    other.normalizedQuery == normalizedQuery;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (filters.hashCode) +
    (mode.hashCode) +
    (normalizedQuery.hashCode);

  @override
  String toString() => 'AskSearchPlanDto[filters=$filters, mode=$mode, normalizedQuery=$normalizedQuery]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'filters'] = this.filters;
      json[r'mode'] = this.mode;
      json[r'normalizedQuery'] = this.normalizedQuery;
    return json;
  }

  /// Returns a new [AskSearchPlanDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AskSearchPlanDto? fromJson(dynamic value) {
    upgradeDto(value, "AskSearchPlanDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AskSearchPlanDto(
        filters: AskSearchPlanDtoFilters.fromJson(json[r'filters'])!,
        mode: AskSearchPlanDtoModeEnum.fromJson(json[r'mode'])!,
        normalizedQuery: mapValueOfType<String>(json, r'normalizedQuery')!,
      );
    }
    return null;
  }

  static List<AskSearchPlanDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AskSearchPlanDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AskSearchPlanDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AskSearchPlanDto> mapFromJson(dynamic json) {
    final map = <String, AskSearchPlanDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AskSearchPlanDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AskSearchPlanDto-objects as value to a dart map
  static Map<String, List<AskSearchPlanDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AskSearchPlanDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AskSearchPlanDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'filters',
    'mode',
    'normalizedQuery',
  };
}

/// Search mode used to answer the query
class AskSearchPlanDtoModeEnum {
  /// Instantiate a new enum with the provided [value].
  const AskSearchPlanDtoModeEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const smart = AskSearchPlanDtoModeEnum._(r'smart');
  static const metadata = AskSearchPlanDtoModeEnum._(r'metadata');

  /// List of all possible values in this [enum][AskSearchPlanDtoModeEnum].
  static const values = <AskSearchPlanDtoModeEnum>[
    smart,
    metadata,
  ];

  static AskSearchPlanDtoModeEnum? fromJson(dynamic value) => AskSearchPlanDtoModeEnumTypeTransformer().decode(value);

  static List<AskSearchPlanDtoModeEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AskSearchPlanDtoModeEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AskSearchPlanDtoModeEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AskSearchPlanDtoModeEnum] to String,
/// and [decode] dynamic data back to [AskSearchPlanDtoModeEnum].
class AskSearchPlanDtoModeEnumTypeTransformer {
  factory AskSearchPlanDtoModeEnumTypeTransformer() => _instance ??= const AskSearchPlanDtoModeEnumTypeTransformer._();

  const AskSearchPlanDtoModeEnumTypeTransformer._();

  String encode(AskSearchPlanDtoModeEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AskSearchPlanDtoModeEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AskSearchPlanDtoModeEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'smart': return AskSearchPlanDtoModeEnum.smart;
        case r'metadata': return AskSearchPlanDtoModeEnum.metadata;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AskSearchPlanDtoModeEnumTypeTransformer] instance.
  static AskSearchPlanDtoModeEnumTypeTransformer? _instance;
}



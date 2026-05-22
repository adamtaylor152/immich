//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AdvancedPromptConfig {
  /// Returns a new [AdvancedPromptConfig] instance.
  AdvancedPromptConfig({
    this.enabled = false,
    this.placeholderValidation = const AdvancedPromptConfigPlaceholderValidationEnum._('strict'),
    this.rawPromptTemplate = '',
  });

  /// Use a raw prompt template instead of the structured fields
  bool enabled;

  /// Whether missing {schema} placeholder fails save (strict) or warns (warn)
  AdvancedPromptConfigPlaceholderValidationEnum placeholderValidation;

  /// Raw prompt template with {names}, {schema}, {vocabulary}, {style_hint} placeholders
  String rawPromptTemplate;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AdvancedPromptConfig &&
    other.enabled == enabled &&
    other.placeholderValidation == placeholderValidation &&
    other.rawPromptTemplate == rawPromptTemplate;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (enabled.hashCode) +
    (placeholderValidation.hashCode) +
    (rawPromptTemplate.hashCode);

  @override
  String toString() => 'AdvancedPromptConfig[enabled=$enabled, placeholderValidation=$placeholderValidation, rawPromptTemplate=$rawPromptTemplate]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'enabled'] = this.enabled;
      json[r'placeholderValidation'] = this.placeholderValidation;
      json[r'rawPromptTemplate'] = this.rawPromptTemplate;
    return json;
  }

  /// Returns a new [AdvancedPromptConfig] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AdvancedPromptConfig? fromJson(dynamic value) {
    upgradeDto(value, "AdvancedPromptConfig");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AdvancedPromptConfig(
        enabled: mapValueOfType<bool>(json, r'enabled') ?? false,
        placeholderValidation: AdvancedPromptConfigPlaceholderValidationEnum.fromJson(json[r'placeholderValidation']) ?? 'strict',
        rawPromptTemplate: mapValueOfType<String>(json, r'rawPromptTemplate') ?? '',
      );
    }
    return null;
  }

  static List<AdvancedPromptConfig> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AdvancedPromptConfig>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AdvancedPromptConfig.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AdvancedPromptConfig> mapFromJson(dynamic json) {
    final map = <String, AdvancedPromptConfig>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AdvancedPromptConfig.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AdvancedPromptConfig-objects as value to a dart map
  static Map<String, List<AdvancedPromptConfig>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AdvancedPromptConfig>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AdvancedPromptConfig.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

/// Whether missing {schema} placeholder fails save (strict) or warns (warn)
class AdvancedPromptConfigPlaceholderValidationEnum {
  /// Instantiate a new enum with the provided [value].
  const AdvancedPromptConfigPlaceholderValidationEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const strict = AdvancedPromptConfigPlaceholderValidationEnum._(r'strict');
  static const warn = AdvancedPromptConfigPlaceholderValidationEnum._(r'warn');

  /// List of all possible values in this [enum][AdvancedPromptConfigPlaceholderValidationEnum].
  static const values = <AdvancedPromptConfigPlaceholderValidationEnum>[
    strict,
    warn,
  ];

  static AdvancedPromptConfigPlaceholderValidationEnum? fromJson(dynamic value) => AdvancedPromptConfigPlaceholderValidationEnumTypeTransformer().decode(value);

  static List<AdvancedPromptConfigPlaceholderValidationEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AdvancedPromptConfigPlaceholderValidationEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AdvancedPromptConfigPlaceholderValidationEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AdvancedPromptConfigPlaceholderValidationEnum] to String,
/// and [decode] dynamic data back to [AdvancedPromptConfigPlaceholderValidationEnum].
class AdvancedPromptConfigPlaceholderValidationEnumTypeTransformer {
  factory AdvancedPromptConfigPlaceholderValidationEnumTypeTransformer() => _instance ??= const AdvancedPromptConfigPlaceholderValidationEnumTypeTransformer._();

  const AdvancedPromptConfigPlaceholderValidationEnumTypeTransformer._();

  String encode(AdvancedPromptConfigPlaceholderValidationEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AdvancedPromptConfigPlaceholderValidationEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AdvancedPromptConfigPlaceholderValidationEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'strict': return AdvancedPromptConfigPlaceholderValidationEnum.strict;
        case r'warn': return AdvancedPromptConfigPlaceholderValidationEnum.warn;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AdvancedPromptConfigPlaceholderValidationEnumTypeTransformer] instance.
  static AdvancedPromptConfigPlaceholderValidationEnumTypeTransformer? _instance;
}



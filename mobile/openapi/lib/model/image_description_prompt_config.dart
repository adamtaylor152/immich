//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ImageDescriptionPromptConfig {
  /// Returns a new [ImageDescriptionPromptConfig] instance.
  ImageDescriptionPromptConfig({
    this.advanced,
    this.customVocabulary = const [],
    this.forbiddenInferences = const [],
    this.identityInjection,
    this.lookFor = const [],
    this.medicalIndicators = const [],
    this.nsfwIndicators = const [],
    this.sentenceCountTarget = 3,
    this.style = const ImageDescriptionPromptConfigStyleEnum._('balanced'),
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  AdvancedPromptConfig? advanced;

  /// Tag values the model should prefer when applicable
  List<String> customVocabulary;

  /// Categories the model must not infer (diagnoses, medications, etc.)
  List<String> forbiddenInferences;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  IdentityInjectionConfig? identityInjection;

  /// Additional categories the model should note when visibly supported (brands, sports equipment, etc.)
  List<String> lookFor;

  /// Allow-list of medical indicator terms permitted in the description
  List<String> medicalIndicators;

  /// Allow-list of explicit NSFW indicator terms permitted in the description
  List<String> nsfwIndicators;

  /// Target number of sentences in the description
  ///
  /// Minimum value: 1
  /// Maximum value: 6
  int sentenceCountTarget;

  /// Description verbosity preset
  ImageDescriptionPromptConfigStyleEnum style;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ImageDescriptionPromptConfig &&
    other.advanced == advanced &&
    _deepEquality.equals(other.customVocabulary, customVocabulary) &&
    _deepEquality.equals(other.forbiddenInferences, forbiddenInferences) &&
    other.identityInjection == identityInjection &&
    _deepEquality.equals(other.lookFor, lookFor) &&
    _deepEquality.equals(other.medicalIndicators, medicalIndicators) &&
    _deepEquality.equals(other.nsfwIndicators, nsfwIndicators) &&
    other.sentenceCountTarget == sentenceCountTarget &&
    other.style == style;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (advanced == null ? 0 : advanced!.hashCode) +
    (customVocabulary.hashCode) +
    (forbiddenInferences.hashCode) +
    (identityInjection == null ? 0 : identityInjection!.hashCode) +
    (lookFor.hashCode) +
    (medicalIndicators.hashCode) +
    (nsfwIndicators.hashCode) +
    (sentenceCountTarget.hashCode) +
    (style.hashCode);

  @override
  String toString() => 'ImageDescriptionPromptConfig[advanced=$advanced, customVocabulary=$customVocabulary, forbiddenInferences=$forbiddenInferences, identityInjection=$identityInjection, lookFor=$lookFor, medicalIndicators=$medicalIndicators, nsfwIndicators=$nsfwIndicators, sentenceCountTarget=$sentenceCountTarget, style=$style]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.advanced != null) {
      json[r'advanced'] = this.advanced;
    } else {
    //  json[r'advanced'] = null;
    }
      json[r'customVocabulary'] = this.customVocabulary;
      json[r'forbiddenInferences'] = this.forbiddenInferences;
    if (this.identityInjection != null) {
      json[r'identityInjection'] = this.identityInjection;
    } else {
    //  json[r'identityInjection'] = null;
    }
      json[r'lookFor'] = this.lookFor;
      json[r'medicalIndicators'] = this.medicalIndicators;
      json[r'nsfwIndicators'] = this.nsfwIndicators;
      json[r'sentenceCountTarget'] = this.sentenceCountTarget;
      json[r'style'] = this.style;
    return json;
  }

  /// Returns a new [ImageDescriptionPromptConfig] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ImageDescriptionPromptConfig? fromJson(dynamic value) {
    upgradeDto(value, "ImageDescriptionPromptConfig");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return ImageDescriptionPromptConfig(
        advanced: AdvancedPromptConfig.fromJson(json[r'advanced']),
        customVocabulary: json[r'customVocabulary'] is Iterable
            ? (json[r'customVocabulary'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        forbiddenInferences: json[r'forbiddenInferences'] is Iterable
            ? (json[r'forbiddenInferences'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        identityInjection: IdentityInjectionConfig.fromJson(json[r'identityInjection']),
        lookFor: json[r'lookFor'] is Iterable
            ? (json[r'lookFor'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        medicalIndicators: json[r'medicalIndicators'] is Iterable
            ? (json[r'medicalIndicators'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        nsfwIndicators: json[r'nsfwIndicators'] is Iterable
            ? (json[r'nsfwIndicators'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        sentenceCountTarget: mapValueOfType<int>(json, r'sentenceCountTarget') ?? 3,
        style: ImageDescriptionPromptConfigStyleEnum.fromJson(json[r'style']) ?? 'balanced',
      );
    }
    return null;
  }

  static List<ImageDescriptionPromptConfig> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ImageDescriptionPromptConfig>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ImageDescriptionPromptConfig.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ImageDescriptionPromptConfig> mapFromJson(dynamic json) {
    final map = <String, ImageDescriptionPromptConfig>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ImageDescriptionPromptConfig.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ImageDescriptionPromptConfig-objects as value to a dart map
  static Map<String, List<ImageDescriptionPromptConfig>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ImageDescriptionPromptConfig>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ImageDescriptionPromptConfig.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

/// Description verbosity preset
class ImageDescriptionPromptConfigStyleEnum {
  /// Instantiate a new enum with the provided [value].
  const ImageDescriptionPromptConfigStyleEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const terse = ImageDescriptionPromptConfigStyleEnum._(r'terse');
  static const balanced = ImageDescriptionPromptConfigStyleEnum._(r'balanced');
  static const rich = ImageDescriptionPromptConfigStyleEnum._(r'rich');

  /// List of all possible values in this [enum][ImageDescriptionPromptConfigStyleEnum].
  static const values = <ImageDescriptionPromptConfigStyleEnum>[
    terse,
    balanced,
    rich,
  ];

  static ImageDescriptionPromptConfigStyleEnum? fromJson(dynamic value) => ImageDescriptionPromptConfigStyleEnumTypeTransformer().decode(value);

  static List<ImageDescriptionPromptConfigStyleEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ImageDescriptionPromptConfigStyleEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ImageDescriptionPromptConfigStyleEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [ImageDescriptionPromptConfigStyleEnum] to String,
/// and [decode] dynamic data back to [ImageDescriptionPromptConfigStyleEnum].
class ImageDescriptionPromptConfigStyleEnumTypeTransformer {
  factory ImageDescriptionPromptConfigStyleEnumTypeTransformer() => _instance ??= const ImageDescriptionPromptConfigStyleEnumTypeTransformer._();

  const ImageDescriptionPromptConfigStyleEnumTypeTransformer._();

  String encode(ImageDescriptionPromptConfigStyleEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a ImageDescriptionPromptConfigStyleEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  ImageDescriptionPromptConfigStyleEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'terse': return ImageDescriptionPromptConfigStyleEnum.terse;
        case r'balanced': return ImageDescriptionPromptConfigStyleEnum.balanced;
        case r'rich': return ImageDescriptionPromptConfigStyleEnum.rich;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [ImageDescriptionPromptConfigStyleEnumTypeTransformer] instance.
  static ImageDescriptionPromptConfigStyleEnumTypeTransformer? _instance;
}



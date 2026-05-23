//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SmartAlbumReevaluateRequestDto {
  /// Returns a new [SmartAlbumReevaluateRequestDto] instance.
  SmartAlbumReevaluateRequestDto({
    this.kind,
  });

  /// Optional built-in kind to scope the re-evaluation to. Omit to re-evaluate every enabled kind.
  SmartAlbumReevaluateRequestDtoKindEnum? kind;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SmartAlbumReevaluateRequestDto &&
    other.kind == kind;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (kind == null ? 0 : kind!.hashCode);

  @override
  String toString() => 'SmartAlbumReevaluateRequestDto[kind=$kind]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.kind != null) {
      json[r'kind'] = this.kind;
    } else {
    //  json[r'kind'] = null;
    }
    return json;
  }

  /// Returns a new [SmartAlbumReevaluateRequestDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SmartAlbumReevaluateRequestDto? fromJson(dynamic value) {
    upgradeDto(value, "SmartAlbumReevaluateRequestDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SmartAlbumReevaluateRequestDto(
        kind: SmartAlbumReevaluateRequestDtoKindEnum.fromJson(json[r'kind']),
      );
    }
    return null;
  }

  static List<SmartAlbumReevaluateRequestDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SmartAlbumReevaluateRequestDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SmartAlbumReevaluateRequestDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SmartAlbumReevaluateRequestDto> mapFromJson(dynamic json) {
    final map = <String, SmartAlbumReevaluateRequestDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SmartAlbumReevaluateRequestDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SmartAlbumReevaluateRequestDto-objects as value to a dart map
  static Map<String, List<SmartAlbumReevaluateRequestDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SmartAlbumReevaluateRequestDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SmartAlbumReevaluateRequestDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

/// Optional built-in kind to scope the re-evaluation to. Omit to re-evaluate every enabled kind.
class SmartAlbumReevaluateRequestDtoKindEnum {
  /// Instantiate a new enum with the provided [value].
  const SmartAlbumReevaluateRequestDtoKindEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const travel = SmartAlbumReevaluateRequestDtoKindEnum._(r'travel');
  static const documents = SmartAlbumReevaluateRequestDtoKindEnum._(r'documents');
  static const screenshots = SmartAlbumReevaluateRequestDtoKindEnum._(r'screenshots');
  static const food = SmartAlbumReevaluateRequestDtoKindEnum._(r'food');
  static const pets = SmartAlbumReevaluateRequestDtoKindEnum._(r'pets');
  static const nature = SmartAlbumReevaluateRequestDtoKindEnum._(r'nature');

  /// List of all possible values in this [enum][SmartAlbumReevaluateRequestDtoKindEnum].
  static const values = <SmartAlbumReevaluateRequestDtoKindEnum>[
    travel,
    documents,
    screenshots,
    food,
    pets,
    nature,
  ];

  static SmartAlbumReevaluateRequestDtoKindEnum? fromJson(dynamic value) => SmartAlbumReevaluateRequestDtoKindEnumTypeTransformer().decode(value);

  static List<SmartAlbumReevaluateRequestDtoKindEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SmartAlbumReevaluateRequestDtoKindEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SmartAlbumReevaluateRequestDtoKindEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [SmartAlbumReevaluateRequestDtoKindEnum] to String,
/// and [decode] dynamic data back to [SmartAlbumReevaluateRequestDtoKindEnum].
class SmartAlbumReevaluateRequestDtoKindEnumTypeTransformer {
  factory SmartAlbumReevaluateRequestDtoKindEnumTypeTransformer() => _instance ??= const SmartAlbumReevaluateRequestDtoKindEnumTypeTransformer._();

  const SmartAlbumReevaluateRequestDtoKindEnumTypeTransformer._();

  String encode(SmartAlbumReevaluateRequestDtoKindEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a SmartAlbumReevaluateRequestDtoKindEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  SmartAlbumReevaluateRequestDtoKindEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'travel': return SmartAlbumReevaluateRequestDtoKindEnum.travel;
        case r'documents': return SmartAlbumReevaluateRequestDtoKindEnum.documents;
        case r'screenshots': return SmartAlbumReevaluateRequestDtoKindEnum.screenshots;
        case r'food': return SmartAlbumReevaluateRequestDtoKindEnum.food;
        case r'pets': return SmartAlbumReevaluateRequestDtoKindEnum.pets;
        case r'nature': return SmartAlbumReevaluateRequestDtoKindEnum.nature;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [SmartAlbumReevaluateRequestDtoKindEnumTypeTransformer] instance.
  static SmartAlbumReevaluateRequestDtoKindEnumTypeTransformer? _instance;
}



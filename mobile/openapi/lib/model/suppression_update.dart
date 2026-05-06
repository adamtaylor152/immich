//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SuppressionUpdate {
  /// Returns a new [SuppressionUpdate] instance.
  SuppressionUpdate({
    this.personIds = const [],
    this.scope,
    this.tagIds = const [],
  });

  /// Person IDs to suppress from locked browsing sessions
  List<String> personIds;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  SuppressionScope? scope;

  /// Tag IDs to suppress from locked browsing sessions
  List<String> tagIds;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SuppressionUpdate &&
    _deepEquality.equals(other.personIds, personIds) &&
    other.scope == scope &&
    _deepEquality.equals(other.tagIds, tagIds);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (personIds.hashCode) +
    (scope == null ? 0 : scope!.hashCode) +
    (tagIds.hashCode);

  @override
  String toString() => 'SuppressionUpdate[personIds=$personIds, scope=$scope, tagIds=$tagIds]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'personIds'] = this.personIds;
    if (this.scope != null) {
      json[r'scope'] = this.scope;
    } else {
    //  json[r'scope'] = null;
    }
      json[r'tagIds'] = this.tagIds;
    return json;
  }

  /// Returns a new [SuppressionUpdate] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SuppressionUpdate? fromJson(dynamic value) {
    upgradeDto(value, "SuppressionUpdate");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SuppressionUpdate(
        personIds: json[r'personIds'] is Iterable
            ? (json[r'personIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        scope: SuppressionScope.fromJson(json[r'scope']),
        tagIds: json[r'tagIds'] is Iterable
            ? (json[r'tagIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<SuppressionUpdate> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SuppressionUpdate>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SuppressionUpdate.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SuppressionUpdate> mapFromJson(dynamic json) {
    final map = <String, SuppressionUpdate>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SuppressionUpdate.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SuppressionUpdate-objects as value to a dart map
  static Map<String, List<SuppressionUpdate>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SuppressionUpdate>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SuppressionUpdate.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class PrivacyUpdate {
  /// Returns a new [PrivacyUpdate] instance.
  PrivacyUpdate({
    this.suppression,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  SuppressionUpdate? suppression;

  @override
  bool operator ==(Object other) => identical(this, other) || other is PrivacyUpdate &&
    other.suppression == suppression;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (suppression == null ? 0 : suppression!.hashCode);

  @override
  String toString() => 'PrivacyUpdate[suppression=$suppression]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.suppression != null) {
      json[r'suppression'] = this.suppression;
    } else {
    //  json[r'suppression'] = null;
    }
    return json;
  }

  /// Returns a new [PrivacyUpdate] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static PrivacyUpdate? fromJson(dynamic value) {
    upgradeDto(value, "PrivacyUpdate");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return PrivacyUpdate(
        suppression: SuppressionUpdate.fromJson(json[r'suppression']),
      );
    }
    return null;
  }

  static List<PrivacyUpdate> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <PrivacyUpdate>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = PrivacyUpdate.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, PrivacyUpdate> mapFromJson(dynamic json) {
    final map = <String, PrivacyUpdate>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = PrivacyUpdate.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of PrivacyUpdate-objects as value to a dart map
  static Map<String, List<PrivacyUpdate>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<PrivacyUpdate>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = PrivacyUpdate.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


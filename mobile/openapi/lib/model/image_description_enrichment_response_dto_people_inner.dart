//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ImageDescriptionEnrichmentResponseDtoPeopleInner {
  /// Returns a new [ImageDescriptionEnrichmentResponseDtoPeopleInner] instance.
  ImageDescriptionEnrichmentResponseDtoPeopleInner({
    required this.activity,
    required this.apparentAgeGroup,
    required this.confidence,
    required this.count,
  });

  String activity;

  String apparentAgeGroup;

  String confidence;

  num count;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ImageDescriptionEnrichmentResponseDtoPeopleInner &&
    other.activity == activity &&
    other.apparentAgeGroup == apparentAgeGroup &&
    other.confidence == confidence &&
    other.count == count;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (activity.hashCode) +
    (apparentAgeGroup.hashCode) +
    (confidence.hashCode) +
    (count.hashCode);

  @override
  String toString() => 'ImageDescriptionEnrichmentResponseDtoPeopleInner[activity=$activity, apparentAgeGroup=$apparentAgeGroup, confidence=$confidence, count=$count]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'activity'] = this.activity;
      json[r'apparent_age_group'] = this.apparentAgeGroup;
      json[r'confidence'] = this.confidence;
      json[r'count'] = this.count;
    return json;
  }

  /// Returns a new [ImageDescriptionEnrichmentResponseDtoPeopleInner] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ImageDescriptionEnrichmentResponseDtoPeopleInner? fromJson(dynamic value) {
    upgradeDto(value, "ImageDescriptionEnrichmentResponseDtoPeopleInner");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return ImageDescriptionEnrichmentResponseDtoPeopleInner(
        activity: mapValueOfType<String>(json, r'activity')!,
        apparentAgeGroup: mapValueOfType<String>(json, r'apparent_age_group')!,
        confidence: mapValueOfType<String>(json, r'confidence')!,
        count: num.parse('${json[r'count']}'),
      );
    }
    return null;
  }

  static List<ImageDescriptionEnrichmentResponseDtoPeopleInner> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ImageDescriptionEnrichmentResponseDtoPeopleInner>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ImageDescriptionEnrichmentResponseDtoPeopleInner.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ImageDescriptionEnrichmentResponseDtoPeopleInner> mapFromJson(dynamic json) {
    final map = <String, ImageDescriptionEnrichmentResponseDtoPeopleInner>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ImageDescriptionEnrichmentResponseDtoPeopleInner.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ImageDescriptionEnrichmentResponseDtoPeopleInner-objects as value to a dart map
  static Map<String, List<ImageDescriptionEnrichmentResponseDtoPeopleInner>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ImageDescriptionEnrichmentResponseDtoPeopleInner>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ImageDescriptionEnrichmentResponseDtoPeopleInner.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'activity',
    'apparent_age_group',
    'confidence',
    'count',
  };
}


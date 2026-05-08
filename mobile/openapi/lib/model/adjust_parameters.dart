//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AdjustParameters {
  /// Returns a new [AdjustParameters] instance.
  AdjustParameters({
    this.blackPoint,
    this.blueTone,
    this.brightness,
    this.contrast,
    this.hdr,
    this.highlights,
    this.saturation,
    this.shadows,
    this.skinTone,
    this.tint,
    this.vignette,
    this.warmth,
    this.whitePoint,
  });

  /// Minimum value: -100
  /// Maximum value: 100
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? blackPoint;

  /// Minimum value: -100
  /// Maximum value: 100
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? blueTone;

  /// Minimum value: -100
  /// Maximum value: 100
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? brightness;

  /// Minimum value: -100
  /// Maximum value: 100
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? contrast;

  /// Minimum value: -100
  /// Maximum value: 100
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? hdr;

  /// Minimum value: -100
  /// Maximum value: 100
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? highlights;

  /// Minimum value: -100
  /// Maximum value: 100
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? saturation;

  /// Minimum value: -100
  /// Maximum value: 100
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? shadows;

  /// Minimum value: -100
  /// Maximum value: 100
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? skinTone;

  /// Minimum value: -100
  /// Maximum value: 100
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? tint;

  /// Minimum value: -100
  /// Maximum value: 100
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? vignette;

  /// Minimum value: -100
  /// Maximum value: 100
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? warmth;

  /// Minimum value: -100
  /// Maximum value: 100
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? whitePoint;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AdjustParameters &&
    other.blackPoint == blackPoint &&
    other.blueTone == blueTone &&
    other.brightness == brightness &&
    other.contrast == contrast &&
    other.hdr == hdr &&
    other.highlights == highlights &&
    other.saturation == saturation &&
    other.shadows == shadows &&
    other.skinTone == skinTone &&
    other.tint == tint &&
    other.vignette == vignette &&
    other.warmth == warmth &&
    other.whitePoint == whitePoint;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (blackPoint == null ? 0 : blackPoint!.hashCode) +
    (blueTone == null ? 0 : blueTone!.hashCode) +
    (brightness == null ? 0 : brightness!.hashCode) +
    (contrast == null ? 0 : contrast!.hashCode) +
    (hdr == null ? 0 : hdr!.hashCode) +
    (highlights == null ? 0 : highlights!.hashCode) +
    (saturation == null ? 0 : saturation!.hashCode) +
    (shadows == null ? 0 : shadows!.hashCode) +
    (skinTone == null ? 0 : skinTone!.hashCode) +
    (tint == null ? 0 : tint!.hashCode) +
    (vignette == null ? 0 : vignette!.hashCode) +
    (warmth == null ? 0 : warmth!.hashCode) +
    (whitePoint == null ? 0 : whitePoint!.hashCode);

  @override
  String toString() => 'AdjustParameters[blackPoint=$blackPoint, blueTone=$blueTone, brightness=$brightness, contrast=$contrast, hdr=$hdr, highlights=$highlights, saturation=$saturation, shadows=$shadows, skinTone=$skinTone, tint=$tint, vignette=$vignette, warmth=$warmth, whitePoint=$whitePoint]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.blackPoint != null) {
      json[r'blackPoint'] = this.blackPoint;
    } else {
    //  json[r'blackPoint'] = null;
    }
    if (this.blueTone != null) {
      json[r'blueTone'] = this.blueTone;
    } else {
    //  json[r'blueTone'] = null;
    }
    if (this.brightness != null) {
      json[r'brightness'] = this.brightness;
    } else {
    //  json[r'brightness'] = null;
    }
    if (this.contrast != null) {
      json[r'contrast'] = this.contrast;
    } else {
    //  json[r'contrast'] = null;
    }
    if (this.hdr != null) {
      json[r'hdr'] = this.hdr;
    } else {
    //  json[r'hdr'] = null;
    }
    if (this.highlights != null) {
      json[r'highlights'] = this.highlights;
    } else {
    //  json[r'highlights'] = null;
    }
    if (this.saturation != null) {
      json[r'saturation'] = this.saturation;
    } else {
    //  json[r'saturation'] = null;
    }
    if (this.shadows != null) {
      json[r'shadows'] = this.shadows;
    } else {
    //  json[r'shadows'] = null;
    }
    if (this.skinTone != null) {
      json[r'skinTone'] = this.skinTone;
    } else {
    //  json[r'skinTone'] = null;
    }
    if (this.tint != null) {
      json[r'tint'] = this.tint;
    } else {
    //  json[r'tint'] = null;
    }
    if (this.vignette != null) {
      json[r'vignette'] = this.vignette;
    } else {
    //  json[r'vignette'] = null;
    }
    if (this.warmth != null) {
      json[r'warmth'] = this.warmth;
    } else {
    //  json[r'warmth'] = null;
    }
    if (this.whitePoint != null) {
      json[r'whitePoint'] = this.whitePoint;
    } else {
    //  json[r'whitePoint'] = null;
    }
    return json;
  }

  /// Returns a new [AdjustParameters] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AdjustParameters? fromJson(dynamic value) {
    upgradeDto(value, "AdjustParameters");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AdjustParameters(
        blackPoint: num.parse('${json[r'blackPoint']}'),
        blueTone: num.parse('${json[r'blueTone']}'),
        brightness: num.parse('${json[r'brightness']}'),
        contrast: num.parse('${json[r'contrast']}'),
        hdr: num.parse('${json[r'hdr']}'),
        highlights: num.parse('${json[r'highlights']}'),
        saturation: num.parse('${json[r'saturation']}'),
        shadows: num.parse('${json[r'shadows']}'),
        skinTone: num.parse('${json[r'skinTone']}'),
        tint: num.parse('${json[r'tint']}'),
        vignette: num.parse('${json[r'vignette']}'),
        warmth: num.parse('${json[r'warmth']}'),
        whitePoint: num.parse('${json[r'whitePoint']}'),
      );
    }
    return null;
  }

  static List<AdjustParameters> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AdjustParameters>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AdjustParameters.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AdjustParameters> mapFromJson(dynamic json) {
    final map = <String, AdjustParameters>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AdjustParameters.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AdjustParameters-objects as value to a dart map
  static Map<String, List<AdjustParameters>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AdjustParameters>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AdjustParameters.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


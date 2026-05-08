//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AssetEditActionItemDtoParameters {
  /// Returns a new [AssetEditActionItemDtoParameters] instance.
  AssetEditActionItemDtoParameters({
    required this.height,
    required this.width,
    required this.x,
    required this.y,
    required this.angle,
    required this.axis,
    required this.endMs,
    required this.startMs,
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
    this.intensity = 100,
    required this.name,
    this.enabled = true,
    this.color = '#ffffff',
    this.size = 0.06,
    required this.text,
    this.muted,
    this.volume,
    required this.rate,
  });

  /// Height of the crop
  ///
  /// Minimum value: 1
  /// Maximum value: 9007199254740991
  int height;

  /// Width of the crop
  ///
  /// Minimum value: 1
  /// Maximum value: 9007199254740991
  int width;

  /// Horizontal position as a percentage of video width
  ///
  /// Minimum value: 0
  /// Maximum value: 1
  num x;

  /// Vertical position as a percentage of video height
  ///
  /// Minimum value: 0
  /// Maximum value: 1
  num y;

  /// Straighten angle in degrees
  ///
  /// Minimum value: -45
  /// Maximum value: 45
  num angle;

  MirrorAxis axis;

  /// Speed segment end time in milliseconds
  ///
  /// Minimum value: 1
  /// Maximum value: 9007199254740991
  int endMs;

  /// Speed segment start time in milliseconds
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int startMs;

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

  /// Filter or effect intensity
  ///
  /// Minimum value: 0
  /// Maximum value: 100
  num intensity;

  /// Filter or effect name
  String name;

  bool enabled;

  /// Text color in hex format
  String color;

  /// Font size as a percentage of video height
  ///
  /// Minimum value: 0.02
  /// Maximum value: 0.2
  num size;

  String text;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? muted;

  /// Audio volume multiplier
  ///
  /// Minimum value: 0
  /// Maximum value: 2
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? volume;

  /// Playback speed multiplier
  ///
  /// Minimum value: 0.25
  /// Maximum value: 4
  num rate;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AssetEditActionItemDtoParameters &&
    other.height == height &&
    other.width == width &&
    other.x == x &&
    other.y == y &&
    other.angle == angle &&
    other.axis == axis &&
    other.endMs == endMs &&
    other.startMs == startMs &&
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
    other.whitePoint == whitePoint &&
    other.intensity == intensity &&
    other.name == name &&
    other.enabled == enabled &&
    other.color == color &&
    other.size == size &&
    other.text == text &&
    other.muted == muted &&
    other.volume == volume &&
    other.rate == rate;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (height.hashCode) +
    (width.hashCode) +
    (x.hashCode) +
    (y.hashCode) +
    (angle.hashCode) +
    (axis.hashCode) +
    (endMs.hashCode) +
    (startMs.hashCode) +
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
    (whitePoint == null ? 0 : whitePoint!.hashCode) +
    (intensity.hashCode) +
    (name.hashCode) +
    (enabled.hashCode) +
    (color.hashCode) +
    (size.hashCode) +
    (text.hashCode) +
    (muted == null ? 0 : muted!.hashCode) +
    (volume == null ? 0 : volume!.hashCode) +
    (rate.hashCode);

  @override
  String toString() => 'AssetEditActionItemDtoParameters[height=$height, width=$width, x=$x, y=$y, angle=$angle, axis=$axis, endMs=$endMs, startMs=$startMs, blackPoint=$blackPoint, blueTone=$blueTone, brightness=$brightness, contrast=$contrast, hdr=$hdr, highlights=$highlights, saturation=$saturation, shadows=$shadows, skinTone=$skinTone, tint=$tint, vignette=$vignette, warmth=$warmth, whitePoint=$whitePoint, intensity=$intensity, name=$name, enabled=$enabled, color=$color, size=$size, text=$text, muted=$muted, volume=$volume, rate=$rate]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'height'] = this.height;
      json[r'width'] = this.width;
      json[r'x'] = this.x;
      json[r'y'] = this.y;
      json[r'angle'] = this.angle;
      json[r'axis'] = this.axis;
      json[r'endMs'] = this.endMs;
      json[r'startMs'] = this.startMs;
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
      json[r'intensity'] = this.intensity;
      json[r'name'] = this.name;
      json[r'enabled'] = this.enabled;
      json[r'color'] = this.color;
      json[r'size'] = this.size;
      json[r'text'] = this.text;
    if (this.muted != null) {
      json[r'muted'] = this.muted;
    } else {
    //  json[r'muted'] = null;
    }
    if (this.volume != null) {
      json[r'volume'] = this.volume;
    } else {
    //  json[r'volume'] = null;
    }
      json[r'rate'] = this.rate;
    return json;
  }

  /// Returns a new [AssetEditActionItemDtoParameters] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AssetEditActionItemDtoParameters? fromJson(dynamic value) {
    upgradeDto(value, "AssetEditActionItemDtoParameters");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AssetEditActionItemDtoParameters(
        height: mapValueOfType<int>(json, r'height')!,
        width: mapValueOfType<int>(json, r'width')!,
        x: num.parse('${json[r'x']}'),
        y: num.parse('${json[r'y']}'),
        angle: num.parse('${json[r'angle']}'),
        axis: MirrorAxis.fromJson(json[r'axis'])!,
        endMs: mapValueOfType<int>(json, r'endMs')!,
        startMs: mapValueOfType<int>(json, r'startMs')!,
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
        intensity: num.parse('${json[r'intensity']}'),
        name: mapValueOfType<String>(json, r'name')!,
        enabled: mapValueOfType<bool>(json, r'enabled') ?? true,
        color: mapValueOfType<String>(json, r'color') ?? '#ffffff',
        size: num.parse('${json[r'size']}'),
        text: mapValueOfType<String>(json, r'text')!,
        muted: mapValueOfType<bool>(json, r'muted'),
        volume: num.parse('${json[r'volume']}'),
        rate: num.parse('${json[r'rate']}'),
      );
    }
    return null;
  }

  static List<AssetEditActionItemDtoParameters> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AssetEditActionItemDtoParameters>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AssetEditActionItemDtoParameters.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AssetEditActionItemDtoParameters> mapFromJson(dynamic json) {
    final map = <String, AssetEditActionItemDtoParameters>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AssetEditActionItemDtoParameters.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AssetEditActionItemDtoParameters-objects as value to a dart map
  static Map<String, List<AssetEditActionItemDtoParameters>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AssetEditActionItemDtoParameters>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AssetEditActionItemDtoParameters.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'height',
    'width',
    'x',
    'y',
    'angle',
    'axis',
    'endMs',
    'startMs',
    'name',
    'text',
    'rate',
  };
}


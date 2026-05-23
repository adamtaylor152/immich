//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class TextOverlayParameters {
  /// Returns a new [TextOverlayParameters] instance.
  TextOverlayParameters({
    this.color = '#ffffff',
    this.endMs,
    this.size = 0.06,
    this.startMs,
    required this.text,
    required this.x,
    required this.y,
  });

  /// Text color in hex format
  String color;

  /// Overlay end time in milliseconds
  ///
  /// Minimum value: 1
  /// Maximum value: 9007199254740991
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? endMs;

  /// Font size as a percentage of video height
  ///
  /// Minimum value: 0.02
  /// Maximum value: 0.2
  num size;

  /// Overlay start time in milliseconds
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? startMs;

  String text;

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

  @override
  bool operator ==(Object other) => identical(this, other) || other is TextOverlayParameters &&
    other.color == color &&
    other.endMs == endMs &&
    other.size == size &&
    other.startMs == startMs &&
    other.text == text &&
    other.x == x &&
    other.y == y;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (color.hashCode) +
    (endMs == null ? 0 : endMs!.hashCode) +
    (size.hashCode) +
    (startMs == null ? 0 : startMs!.hashCode) +
    (text.hashCode) +
    (x.hashCode) +
    (y.hashCode);

  @override
  String toString() => 'TextOverlayParameters[color=$color, endMs=$endMs, size=$size, startMs=$startMs, text=$text, x=$x, y=$y]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'color'] = this.color;
    if (this.endMs != null) {
      json[r'endMs'] = this.endMs;
    } else {
    //  json[r'endMs'] = null;
    }
      json[r'size'] = this.size;
    if (this.startMs != null) {
      json[r'startMs'] = this.startMs;
    } else {
    //  json[r'startMs'] = null;
    }
      json[r'text'] = this.text;
      json[r'x'] = this.x;
      json[r'y'] = this.y;
    return json;
  }

  /// Returns a new [TextOverlayParameters] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static TextOverlayParameters? fromJson(dynamic value) {
    upgradeDto(value, "TextOverlayParameters");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return TextOverlayParameters(
        color: mapValueOfType<String>(json, r'color') ?? '#ffffff',
        endMs: mapValueOfType<int>(json, r'endMs'),
        size: json[r'size'] == null
            ? 0.06
            : num.parse('${json[r'size']}'),
        startMs: mapValueOfType<int>(json, r'startMs'),
        text: mapValueOfType<String>(json, r'text')!,
        x: num.parse('${json[r'x']}'),
        y: num.parse('${json[r'y']}'),
      );
    }
    return null;
  }

  static List<TextOverlayParameters> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <TextOverlayParameters>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = TextOverlayParameters.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, TextOverlayParameters> mapFromJson(dynamic json) {
    final map = <String, TextOverlayParameters>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = TextOverlayParameters.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of TextOverlayParameters-objects as value to a dart map
  static Map<String, List<TextOverlayParameters>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<TextOverlayParameters>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = TextOverlayParameters.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'text',
    'x',
    'y',
  };
}


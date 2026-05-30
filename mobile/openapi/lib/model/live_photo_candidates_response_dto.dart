//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class LivePhotoCandidatesResponseDto {
  /// Returns a new [LivePhotoCandidatesResponseDto] instance.
  LivePhotoCandidatesResponseDto({
    this.candidates = const [],
    required this.total,
  });

  List<LivePhotoCandidateDto> candidates;

  /// Total number of candidate pairs found
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int total;

  @override
  bool operator ==(Object other) => identical(this, other) || other is LivePhotoCandidatesResponseDto &&
    _deepEquality.equals(other.candidates, candidates) &&
    other.total == total;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (candidates.hashCode) +
    (total.hashCode);

  @override
  String toString() => 'LivePhotoCandidatesResponseDto[candidates=$candidates, total=$total]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'candidates'] = this.candidates;
      json[r'total'] = this.total;
    return json;
  }

  /// Returns a new [LivePhotoCandidatesResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static LivePhotoCandidatesResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "LivePhotoCandidatesResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return LivePhotoCandidatesResponseDto(
        candidates: LivePhotoCandidateDto.listFromJson(json[r'candidates']),
        total: mapValueOfType<int>(json, r'total')!,
      );
    }
    return null;
  }

  static List<LivePhotoCandidatesResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <LivePhotoCandidatesResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = LivePhotoCandidatesResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, LivePhotoCandidatesResponseDto> mapFromJson(dynamic json) {
    final map = <String, LivePhotoCandidatesResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = LivePhotoCandidatesResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of LivePhotoCandidatesResponseDto-objects as value to a dart map
  static Map<String, List<LivePhotoCandidatesResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<LivePhotoCandidatesResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = LivePhotoCandidatesResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'candidates',
    'total',
  };
}


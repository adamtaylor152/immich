//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class RunPodBackfillResultDto {
  /// Returns a new [RunPodBackfillResultDto] instance.
  RunPodBackfillResultDto({
    this.enqueued = const [],
    this.skipped = const [],
  });

  List<String> enqueued;

  List<String> skipped;

  @override
  bool operator ==(Object other) => identical(this, other) || other is RunPodBackfillResultDto &&
    _deepEquality.equals(other.enqueued, enqueued) &&
    _deepEquality.equals(other.skipped, skipped);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (enqueued.hashCode) +
    (skipped.hashCode);

  @override
  String toString() => 'RunPodBackfillResultDto[enqueued=$enqueued, skipped=$skipped]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'enqueued'] = this.enqueued;
      json[r'skipped'] = this.skipped;
    return json;
  }

  /// Returns a new [RunPodBackfillResultDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static RunPodBackfillResultDto? fromJson(dynamic value) {
    upgradeDto(value, "RunPodBackfillResultDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return RunPodBackfillResultDto(
        enqueued: json[r'enqueued'] is Iterable
            ? (json[r'enqueued'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        skipped: json[r'skipped'] is Iterable
            ? (json[r'skipped'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<RunPodBackfillResultDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <RunPodBackfillResultDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = RunPodBackfillResultDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, RunPodBackfillResultDto> mapFromJson(dynamic json) {
    final map = <String, RunPodBackfillResultDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = RunPodBackfillResultDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of RunPodBackfillResultDto-objects as value to a dart map
  static Map<String, List<RunPodBackfillResultDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<RunPodBackfillResultDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = RunPodBackfillResultDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'enqueued',
    'skipped',
  };
}


//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

/// Media health status
class MediaHealthStatus {
  /// Instantiate a new enum with the provided [value].
  const MediaHealthStatus._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const found = MediaHealthStatus._(r'found');
  static const missing = MediaHealthStatus._(r'missing');
  static const candidate = MediaHealthStatus._(r'candidate');
  static const relinked = MediaHealthStatus._(r'relinked');
  static const dismissed = MediaHealthStatus._(r'dismissed');
  static const resolved = MediaHealthStatus._(r'resolved');
  static const unsupportedRaw = MediaHealthStatus._(r'unsupported_raw');
  static const corruptSuspect = MediaHealthStatus._(r'corrupt_suspect');
  static const corruptConfirmed = MediaHealthStatus._(r'corrupt_confirmed');
  static const trashQueued = MediaHealthStatus._(r'trash_queued');
  static const trashed = MediaHealthStatus._(r'trashed');
  static const deleteQueued = MediaHealthStatus._(r'delete_queued');
  static const deleted = MediaHealthStatus._(r'deleted');

  /// List of all possible values in this [enum][MediaHealthStatus].
  static const values = <MediaHealthStatus>[
    found,
    missing,
    candidate,
    relinked,
    dismissed,
    resolved,
    unsupportedRaw,
    corruptSuspect,
    corruptConfirmed,
    trashQueued,
    trashed,
    deleteQueued,
    deleted,
  ];

  static MediaHealthStatus? fromJson(dynamic value) => MediaHealthStatusTypeTransformer().decode(value);

  static List<MediaHealthStatus> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <MediaHealthStatus>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = MediaHealthStatus.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [MediaHealthStatus] to String,
/// and [decode] dynamic data back to [MediaHealthStatus].
class MediaHealthStatusTypeTransformer {
  factory MediaHealthStatusTypeTransformer() => _instance ??= const MediaHealthStatusTypeTransformer._();

  const MediaHealthStatusTypeTransformer._();

  String encode(MediaHealthStatus data) => data.value;

  /// Decodes a [dynamic value][data] to a MediaHealthStatus.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  MediaHealthStatus? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'found': return MediaHealthStatus.found;
        case r'missing': return MediaHealthStatus.missing;
        case r'candidate': return MediaHealthStatus.candidate;
        case r'relinked': return MediaHealthStatus.relinked;
        case r'dismissed': return MediaHealthStatus.dismissed;
        case r'resolved': return MediaHealthStatus.resolved;
        case r'unsupported_raw': return MediaHealthStatus.unsupportedRaw;
        case r'corrupt_suspect': return MediaHealthStatus.corruptSuspect;
        case r'corrupt_confirmed': return MediaHealthStatus.corruptConfirmed;
        case r'trash_queued': return MediaHealthStatus.trashQueued;
        case r'trashed': return MediaHealthStatus.trashed;
        case r'delete_queued': return MediaHealthStatus.deleteQueued;
        case r'deleted': return MediaHealthStatus.deleted;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [MediaHealthStatusTypeTransformer] instance.
  static MediaHealthStatusTypeTransformer? _instance;
}


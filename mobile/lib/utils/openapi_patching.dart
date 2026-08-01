import 'package:flutter/foundation.dart';
import 'package:openapi/api.dart';

abstract interface class _Dynamic {
  Object? resolve();
}

class _CurrentTimestamp implements _Dynamic {
  const _CurrentTimestamp();

  @override
  Object? resolve() => DateTime.now().toIso8601String();
}

const _now = _CurrentTimestamp();

@visibleForTesting
final Map<String, Map<String, Object?>> openApiPatches = {
  'UserPreferencesResponseDto': {
    'download.includeEmbeddedVideos': false,
    'folders': FoldersResponse(enabled: false, sidebarWeb: false).toJson(),
    'memories': MemoriesResponse(enabled: true, duration: 5).toJson(),
    'ratings': RatingsResponse(enabled: false).toJson(),
    'people': PeopleResponse(enabled: true, sidebarWeb: false).toJson(),
    'tags': TagsResponse(enabled: false, sidebarWeb: false).toJson(),
    'sharedLinks': SharedLinksResponse(enabled: true, sidebarWeb: false).toJson(),
    'cast': CastResponse(gCastEnabled: false).toJson(),
    'albums': {'defaultAssetOrder': 'desc'},
    'recentlyAdded': RecentlyAddedResponse(sidebarWeb: false).toJson(),
    'privacy': {
      'suppression': {'personIds': [], 'tagIds': [], 'scope': 'visible'},
    },
  },
  'ServerConfigDto': {
    'mapLightStyleUrl': 'https://tiles.immich.cloud/v1/style/light.json',
    'mapDarkStyleUrl': 'https://tiles.immich.cloud/v1/style/dark.json',
    'minFaces': 3,
    'defaultImageDescriptionRawPromptTemplate': '',
  },
  'UserResponseDto': {'profileChangedAt': _now},
  'AssetResponseDto': {'visibility': 'timeline', 'createdAt': _now, 'isEdited': false},
  'UserAdminResponseDto': {'profileChangedAt': _now},
  'LoginResponseDto': {'isOnboarded': false},
  'SyncUserV1': {'profileChangedAt': _now, 'hasProfileImage': false},
  'SyncAssetV1': {'isEdited': false},
  'ServerFeaturesDto': {
    'ocr': false,
    'realtimeTranscoding': false,
    'imageDescription': false,
    'nsfwDetection': false,
    'nsfwHiding': false,
    'physicalDeduplication': false,
  },
  'AlbumResponseDto': {'icon': null, 'parentId': null, 'sortOrder': null},
  'CLIPConfig': {
    'zeroShotTagging': {'enabled': true, 'minSimilarity': 0.25, 'maxTags': 6},
  },
  'DuplicateDetectionConfig': {
    'preferOriginalFormat': true,
    'enhancedVideo': {'enabled': true, 'frameCount': 4, 'minMatchingFrames': 2, 'maxDistance': 0.01},
  },
  'PluginResponseDto': {'methods': []},
  'QueuesResponseLegacyDto': {
    'imageDescription': {
      'jobCounts': {'active': 0, 'completed': 0, 'delayed': 0, 'failed': 0, 'paused': 0, 'waiting': 0},
      'queueStatus': {'isActive': false, 'isPaused': false},
    },
    'imageEnrichment': {
      'jobCounts': {'active': 0, 'completed': 0, 'delayed': 0, 'failed': 0, 'paused': 0, 'waiting': 0},
      'queueStatus': {'isActive': false, 'isPaused': false},
    },
    'integrityCheck': {
      'jobCounts': {'active': 0, 'completed': 0, 'delayed': 0, 'failed': 0, 'paused': 0, 'waiting': 0},
      'queueStatus': {'isActive': false, 'isPaused': false},
    },
    'mediaHealth': {
      'jobCounts': {'active': 0, 'completed': 0, 'delayed': 0, 'failed': 0, 'paused': 0, 'waiting': 0},
      'queueStatus': {'isActive': false, 'isPaused': false},
    },
    'nsfwDetection': {
      'jobCounts': {'active': 0, 'completed': 0, 'delayed': 0, 'failed': 0, 'paused': 0, 'waiting': 0},
      'queueStatus': {'isActive': false, 'isPaused': false},
    },
    'videoDuplicateDetection': {
      'jobCounts': {'active': 0, 'completed': 0, 'delayed': 0, 'failed': 0, 'paused': 0, 'waiting': 0},
      'queueStatus': {'isActive': false, 'isPaused': false},
    },
  },
  'ServerVersionResponseDto': {'prerelease': null},
  'SystemConfigDto': {
    'integrityChecks': {
      'missingFiles': {'enabled': true, 'cronExpression': '0 3 * * *'},
      'untrackedFiles': {'enabled': true, 'cronExpression': '0 3 * * *'},
      'checksumFiles': {'enabled': true, 'cronExpression': '0 3 * * *', 'timeLimit': 3600000, 'percentageLimit': 1},
    },
  },
  'SystemConfigFFmpegDto': {
    'realtime': {
      'enabled': false,
      'videoCodecs': ['h264', 'hevc'],
      'resolutions': [480, 720, 1080],
    },
  },
  'SystemConfigJobDto': {
    'integrityCheck': {'concurrency': 1},
    'videoDuplicateDetection': {'concurrency': 1},
  },
  'SystemConfigNewVersionCheckDto': {'channel': 'stable'},
  'WorkflowResponseDto': {'steps': [], 'trigger': 'AssetCreate', 'updatedAt': _now},
  'MemoriesResponse': {'duration': 5},
};

void upgradeDto(dynamic value, String targetType) {
  if (value is! Map) {
    return;
  }
  final fields = openApiPatches[targetType];
  if (fields == null) {
    return;
  }
  fields.forEach((key, defaultValue) {
    addDefault(value, key, defaultValue is _Dynamic ? defaultValue.resolve() : defaultValue);
  });
}

void addDefault(dynamic value, String keys, dynamic defaultValue) {
  // Loop through the keys and assign the default value if the key is not present
  final List<String> keyList = keys.split('.');
  dynamic current = value;

  for (int i = 0; i < keyList.length - 1; i++) {
    if (current[keyList[i]] == null) {
      current[keyList[i]] = {};
    }
    current = current[keyList[i]];
  }

  if (current[keyList.last] == null) {
    current[keyList.last] = defaultValue;
  }
}

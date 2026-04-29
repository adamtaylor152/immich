import {
  AssetStatus,
  AssetVisibility,
  WorkflowType,
  wrapper,
} from '@immich/plugin-sdk';

type AssetFileFilterConfig = {
  pattern: string;
  matchType?: 'contains' | 'exact' | 'regex';
  caseSensitive?: boolean;
};
export const assetFileFilter = () => {
  return wrapper<WorkflowType.AssetV1, AssetFileFilterConfig>(
    ({ data, config }) => {
      const { pattern, matchType = 'contains', caseSensitive = false } = config;

      const { asset } = data;

      const fileName = asset.originalFileName || '';
      const searchName = caseSensitive ? fileName : fileName.toLowerCase();
      const searchPattern = caseSensitive ? pattern : pattern.toLowerCase();

      if (matchType === 'exact') {
        return { workflow: { continue: searchName === searchPattern } };
      }

      if (matchType === 'regex') {
        const flags = caseSensitive ? '' : 'i';
        const regex = new RegExp(searchPattern, flags);
        return { workflow: { continue: regex.test(fileName) } };
      }

      return { workflow: { continue: searchName.includes(searchPattern) } };
    },
  );
};

type AssetArchiveConfig = {
  inverse?: boolean;
};
export const assetArchive = () => {
  return wrapper<WorkflowType.AssetV1, AssetArchiveConfig>(
    ({ config, data }) => {
      const target: AssetVisibility = config.inverse
        ? AssetVisibility.Timeline
        : AssetVisibility.Archive;
      if (target !== data.asset.visibility) {
        return {
          changes: {
            asset: { visibility: target },
          },
        };
      }
    },
  );
};

type AssetFavoriteConfig = {
  inverse?: boolean;
};
export const assetFavorite = () => {
  return wrapper<WorkflowType.AssetV1, AssetFavoriteConfig>(
    ({ config, data }) => {
      const target = config.inverse ? false : true;
      if (target !== data.asset.isFavorite) {
        return {
          changes: {
            asset: { isFavorite: target },
          },
        };
      }
    },
  );
};

export const assetLock = () => {
  return wrapper<WorkflowType.AssetV1>(() => ({
    changes: { asset: { visibility: AssetVisibility.Locked } },
  }));
};

type AssetTrashConfig = {
  inverse?: boolean;
};
export const assetTrash = () => {
  return wrapper<WorkflowType.AssetV1, AssetTrashConfig>(({ config }) => ({
    changes: {
      asset: config.inverse
        ? { deletedAt: null, status: AssetStatus.Active }
        : { deletedAt: new Date().toISOString(), status: AssetStatus.Trashed },
    },
  }));
};

type AssetAddToAlbumConfig = {
  albumId: string;
};
export const albumAddAssets = () => {
  return wrapper<WorkflowType.AssetV1, AssetAddToAlbumConfig>(
    ({ config, data, functions }) => {
      functions.albumAddAssets(config.albumId, [data.asset.id]);
      return {};
    },
  );
};

export const test = () => {
  return wrapper(() => ({}));
};

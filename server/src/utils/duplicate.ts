import { AssetResponseDto } from 'src/dtos/asset-response.dto';
import { mimeTypes } from 'src/utils/mime-types';

export type SuggestDuplicateOptions = {
  /**
   * When true, native camera originals (RAW, then HEIC/HEIF) are preferred over
   * re-encoded/derivative formats (e.g. JPG) regardless of file size.
   */
  preferOriginalFormat?: boolean;
};

/**
 * Counts all truthy values in the exifInfo object.
 * This matches the client implementation in web/src/lib/utils/exif-utils.ts
 *
 * @param asset Asset with optional exifInfo
 * @returns Count of truthy EXIF values
 */
export const getExifCount = (asset: AssetResponseDto): number => {
  return Object.values(asset.exifInfo ?? {}).filter(Boolean).length;
};

/**
 * Ranks an asset by how "original" its format is, for the duplicate-keep
 * preference. Native camera originals outrank re-encoded/derivative formats:
 *  - 2: RAW (DNG, CR2, NEF, ...) — the truest original
 *  - 1: HEIC/HEIF — Apple's native capture format
 *  - 0: everything else (JPG, PNG, ...) — typically a re-encoded copy
 *
 * @param asset Asset to rank
 * @returns Format rank (higher is more preferred)
 */
export const getFormatRank = (asset: AssetResponseDto): number => {
  const fileName = asset.originalFileName ?? '';
  if (mimeTypes.isRaw(fileName)) {
    return 2;
  }
  if (mimeTypes.isHeic(fileName)) {
    return 1;
  }
  return 0;
};

/**
 * Suggests the best duplicate asset to keep from a list of duplicates.
 *
 * The best asset is determined by the following criteria:
 *  1. Highest format rank, when {@link SuggestDuplicateOptions.preferOriginalFormat}
 *     is enabled (RAW > HEIC/HEIF > other). A native original always wins over a
 *     re-encoded copy, even if the copy is larger on disk.
 *  2. Largest image file size in bytes
 *  3. Largest count of EXIF data (as tie-breaker)
 *
 * @param assets List of duplicate assets
 * @param options Suggestion options
 * @returns The best asset to keep, or undefined if empty list
 */
export const suggestDuplicate = (
  assets: AssetResponseDto[],
  { preferOriginalFormat = false }: SuggestDuplicateOptions = {},
): AssetResponseDto | undefined => {
  if (assets.length === 0) {
    return undefined;
  }

  let duplicateAssets = [...assets];

  // Prefer native originals (RAW > HEIC > others) over re-encoded copies,
  // regardless of file size. Narrow to the highest format rank present, then let
  // the size/EXIF logic below choose among same-tier candidates.
  if (preferOriginalFormat) {
    const highestRank = Math.max(...duplicateAssets.map((asset) => getFormatRank(asset)));
    duplicateAssets = duplicateAssets.filter((asset) => getFormatRank(asset) === highestRank);
  }

  // Sort by file size ascending (smallest first)
  duplicateAssets = duplicateAssets.toSorted(
    (a, b) => (a.exifInfo?.fileSizeInByte ?? 0) - (b.exifInfo?.fileSizeInByte ?? 0),
  );

  // Get the largest file size (last element after sorting)
  const largestFileSize = duplicateAssets.at(-1)?.exifInfo?.fileSizeInByte ?? 0;

  // Filter to keep only assets with the largest file size
  duplicateAssets = duplicateAssets.filter((asset) => (asset.exifInfo?.fileSizeInByte ?? 0) === largestFileSize);

  // If there are multiple assets with the same file size, sort by EXIF count
  if (duplicateAssets.length >= 2) {
    duplicateAssets = duplicateAssets.toSorted((a, b) => getExifCount(a) - getExifCount(b));
  }

  // Return the last asset (highest EXIF count among highest file size)
  return duplicateAssets.at(-1);
};

/**
 * Suggests the best duplicate asset IDs to keep from a list of duplicates.
 * Returns an array with a single asset ID (the best candidate), or empty if no assets.
 *
 * @param assets List of duplicate assets
 * @param options Suggestion options
 * @returns Array of suggested asset IDs to keep (0 or 1 element)
 */
export const suggestDuplicateKeepAssetIds = (
  assets: AssetResponseDto[],
  options?: SuggestDuplicateOptions,
): string[] => {
  const suggested = suggestDuplicate(assets, options);
  return suggested ? [suggested.id] : [];
};

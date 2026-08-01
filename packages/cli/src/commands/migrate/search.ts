import { AssetVisibility, type AssetResponseDto, type MetadataSearchDto } from '@immich/sdk';
import type { ServerClient } from 'src/commands/migrate/client';

// searchAssetBuilder on the server defaults to visibility=timeline and filters to exactly
// that single value, so a full-library walk MUST make one pass per visibility. Locked/Hidden
// require an elevated session (not available to an API key) and are out of scope.
const VISIBILITIES = [AssetVisibility.Timeline, AssetVisibility.Archive];

/** Yields every asset matching `baseDto`, across timeline + archive, following pagination. */
export async function* searchAllAssets(
  client: ServerClient,
  baseDto: MetadataSearchDto,
  shouldIncludeTrashed: boolean,
): AsyncGenerator<AssetResponseDto> {
  for (const visibility of VISIBILITIES) {
    let page: number | null = 1;
    while (page !== null) {
      const res = await client.searchAssets({
        ...baseDto,
        visibility,
        withDeleted: shouldIncludeTrashed,
        withExif: true,
        size: 1000,
        page,
      });
      for (const asset of res.assets.items) {
        yield asset;
      }
      page = res.assets.nextPage ? Number(res.assets.nextPage) : null;
    }
  }
}

/** Collects just the source asset IDs matching a filter (album/tag/person membership). */
export async function collectAssetIds(
  client: ServerClient,
  filter: MetadataSearchDto,
  shouldIncludeTrashed: boolean,
): Promise<string[]> {
  const ids: string[] = [];
  for await (const asset of searchAllAssets(client, filter, shouldIncludeTrashed)) {
    ids.push(asset.id);
  }
  return ids;
}

import { Injectable } from '@nestjs/common';
import { SystemConfig } from 'src/config';
import { OnEvent } from 'src/decorators';
import { BootstrapEventPriority, ImmichWorker } from 'src/enum';
import { BaseService } from 'src/services/base.service';

type BuiltInKind = keyof SystemConfig['smartAlbums']['builtIn'];

/**
 * Per-config memoized cache of lowercased tag-trigger sets. Keyed on the
 * `builtIn` config object reference — when config is reloaded by SystemConfig,
 * the reference changes and the cache is rebuilt lazily.
 */
const tagTriggerCache = new WeakMap<SystemConfig['smartAlbums']['builtIn'], Map<BuiltInKind, Set<string>>>();

const getTagTriggerSet = (builtIn: SystemConfig['smartAlbums']['builtIn'], kind: BuiltInKind): Set<string> => {
  let perConfig = tagTriggerCache.get(builtIn);
  if (!perConfig) {
    perConfig = new Map();
    tagTriggerCache.set(builtIn, perConfig);
  }
  let set = perConfig.get(kind);
  if (!set) {
    set = new Set(builtIn[kind].tagTriggers.map((t) => t.toLowerCase()));
    perConfig.set(kind, set);
  }
  return set;
};

@Injectable()
export class SmartAlbumService extends BaseService {
  /**
   * On server startup, ensure the 6 built-in smart albums exist for every
   * active user. Idempotent — safe to call on every server start. Gated on
   * `smartAlbums.enabled` so users who haven't opted in don't get six surprise
   * albums silently injected into their library.
   *
   * Runs on the API worker only (one process), AFTER SystemConfig has loaded
   * its values from the database.
   */
  @OnEvent({
    name: 'AppBootstrap',
    priority: BootstrapEventPriority.SystemConfig + 1,
    workers: [ImmichWorker.Api],
  })
  async onBootstrap(): Promise<void> {
    const { smartAlbums } = await this.getConfig({ withCache: true });
    if (!smartAlbums.enabled) {
      return;
    }

    const users = await this.userRepository.getList({ withDeleted: false });
    for (const user of users) {
      try {
        await this.ensureBuiltInAlbumsForUser(user.id);
      } catch (error) {
        this.logger.warn(
          `Failed to ensure smart albums for user ${user.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Evaluate an asset against all enabled smart-album rules. Called after a
   * description completes successfully — receives the asset's id, owner id,
   * and the tags emitted by the description model.
   *
   * Tag matching is case-insensitive. CLIP query similarity is stubbed — see
   * the TODO comment below.
   */
  async evaluate(input: { assetId: string; ownerId: string; tags: string[] }): Promise<void> {
    const { assetId, ownerId, tags } = input;
    const { smartAlbums } = await this.getConfig({ withCache: true });

    if (!smartAlbums.enabled) {
      return;
    }

    const builtInKinds = Object.keys(smartAlbums.builtIn) as BuiltInKind[];
    const albumIdByKind = await this.smartAlbumRepository.getAllSmartAlbumIdsForOwner(ownerId);
    const candidateAlbumIds: string[] = [];
    for (const kind of builtInKinds) {
      const id = albumIdByKind.get(kind);
      if (id) {
        candidateAlbumIds.push(id);
      }
    }
    const excludedAlbumIds = await this.smartAlbumRepository.getExcludedSmartAlbumIds(assetId, candidateAlbumIds);

    const lowerTags = tags.map((t) => t.toLowerCase());

    const currentKinds = new Set(await this.smartAlbumRepository.getMatchingKinds(assetId, ownerId));
    const matchedKinds = new Set<string>();

    for (const kind of builtInKinds) {
      const kindConfig = smartAlbums.builtIn[kind];
      if (!kindConfig.enabled) {
        continue;
      }

      const smartAlbumId = albumIdByKind.get(kind);
      if (!smartAlbumId) {
        // User not yet bootstrapped — ensureBuiltInAlbumsForUser will create it.
        continue;
      }

      if (excludedAlbumIds.has(smartAlbumId)) {
        continue;
      }

      // Tag match: case-insensitive comparison against tagTriggers.
      const tagTriggerLower = getTagTriggerSet(smartAlbums.builtIn, kind);
      const hasTagMatch = lowerTags.some((tag) => tagTriggerLower.has(tag));

      if (hasTagMatch) {
        matchedKinds.add(kind);
        await this.smartAlbumRepository.addAssetToSmartAlbum(smartAlbumId, assetId, 'tag');
      }

      // TODO(smart-albums): CLIP query similarity matching. Requires encoding
      // each builtIn[kind].clipQueries[i] via machineLearningRepository.encodeText,
      // caching the resulting embeddings, then computing cosine distance against
      // smart_search.embedding. Deferred to a follow-up PR to keep PR 6 focused
      // on the table/service foundation. For now, only tag-based matching fires.
    }

    // Removal: for each kind the asset was previously in that no longer matches,
    // remove it so that stale memberships don't linger when tags change.
    for (const kind of currentKinds) {
      if (!matchedKinds.has(kind)) {
        const smartAlbumId = albumIdByKind.get(kind as BuiltInKind);
        if (smartAlbumId) {
          await this.smartAlbumRepository.removeAssetFromSmartAlbum(smartAlbumId, assetId);
        }
      }
    }
  }

  /**
   * Ensure the 6 built-in smart albums exist for the given user. Idempotent —
   * safe to call on every server start or user creation event.
   */
  async ensureBuiltInAlbumsForUser(ownerId: string): Promise<void> {
    const { smartAlbums } = await this.getConfig({ withCache: true });
    if (!smartAlbums.enabled) {
      return;
    }
    const builtInKinds = Object.keys(smartAlbums.builtIn) as BuiltInKind[];
    const kinds = builtInKinds.map((kind) => ({
      kind,
      name: smartAlbums.builtIn[kind].name,
    }));
    await this.smartAlbumRepository.ensureForUser(ownerId, kinds);
  }
}

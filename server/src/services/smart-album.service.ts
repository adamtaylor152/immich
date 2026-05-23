import { Injectable } from '@nestjs/common';
import { OnEvent } from 'src/decorators';
import { BaseService } from 'src/services/base.service';

const BUILT_IN_KINDS = ['travel', 'documents', 'screenshots', 'food', 'pets', 'nature'] as const;
type BuiltInKind = (typeof BUILT_IN_KINDS)[number];

@Injectable()
export class SmartAlbumService extends BaseService {
  /**
   * On server startup, ensure the 6 built-in smart albums exist for every
   * active user. Idempotent — safe to call on every server start.
   * Runs after SystemConfig bootstrap (priority > 100 means later).
   */
  @OnEvent({ name: 'AppBootstrap' })
  async onBootstrap(): Promise<void> {
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

    const lowerTags = tags.map((t) => t.toLowerCase());

    const currentKinds = new Set(await this.smartAlbumRepository.getMatchingKinds(assetId, ownerId));
    const matchedKinds = new Set<string>();

    for (const kind of BUILT_IN_KINDS) {
      const kindConfig = smartAlbums.builtIn[kind as BuiltInKind];
      if (!kindConfig.enabled) {
        continue;
      }

      const smartAlbumId = await this.smartAlbumRepository.getSmartAlbumIdForOwnerAndKind(ownerId, kind);
      if (!smartAlbumId) {
        // User not yet bootstrapped — ensureBuiltInAlbumsForUser will create it.
        continue;
      }

      if (await this.smartAlbumRepository.isExcluded(smartAlbumId, assetId)) {
        continue;
      }

      // Tag match: case-insensitive comparison against tagTriggers.
      const tagTriggerLower = new Set(kindConfig.tagTriggers.map((t) => t.toLowerCase()));
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
        const smartAlbumId = await this.smartAlbumRepository.getSmartAlbumIdForOwnerAndKind(ownerId, kind);
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
    const kinds = BUILT_IN_KINDS.map((kind) => ({
      kind,
      name: smartAlbums.builtIn[kind as BuiltInKind].name,
    }));
    await this.smartAlbumRepository.ensureForUser(ownerId, kinds);
  }
}

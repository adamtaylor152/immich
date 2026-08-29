import { Injectable } from '@nestjs/common';
import { SystemConfig } from 'src/config';
import { OnEvent, OnJob } from 'src/decorators';
import { BootstrapEventPriority, ImmichWorker, JobName, JobStatus, QueueName } from 'src/enum';
import { ArgOf } from 'src/repositories/event.repository';
import { BaseService } from 'src/services/base.service';
import { JobOf } from 'src/types';
import { dot, l2Normalize, parseEmbedding } from 'src/utils/embedding';
import { isSmartSearchEnabled } from 'src/utils/misc';

type BuiltInKind = keyof SystemConfig['smartAlbums']['builtIn'];

/**
 * Per-config memoized cache of lowercased tag-trigger sets. Keyed on the
 * `builtIn` config object reference — when config is reloaded by SystemConfig,
 * the reference changes and the cache is rebuilt lazily.
 */
const tagTriggerCache = new WeakMap<SystemConfig['smartAlbums']['builtIn'], Map<BuiltInKind, Set<string>>>();

/**
 * Strip control characters + newlines + escape codes from user-controlled
 * values before they hit the logger. Defense against CWE-117 log injection.
 * Caps length at 64 chars so logs don't bloat on a pathological input.
 */
const sanitizeForLog = (value: string): string =>
  // eslint-disable-next-line no-control-regex
  value.replaceAll(/[\u{0000}-\u{001F}\u{007F}]/gu, '?').slice(0, 64);

/**
 * Memoized textual-CLIP embeddings for smart-album `clipQueries`, keyed on
 * `<modelName>\0<query>`. The model name is part of the key so a CLIP model
 * change naturally invalidates every cached query (stale entries for the old
 * model are harmless — a handful of small vectors). The promise itself is
 * cached so concurrent evaluations share a single ML round-trip; failed
 * promises are evicted so the next evaluation retries.
 */
const clipQueryCache = new Map<string, Promise<Float32Array | undefined>>();

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
   * Tag matching is case-insensitive. CLIP query similarity compares the
   * asset's smart_search visual embedding against each configured query
   * phrase (encoded via the textual CLIP model) and matches when the cosine
   * similarity meets the kind's threshold.
   *
   * Pass `onlyKind` to scope the evaluation to a single built-in kind. The
   * admin "Re-evaluate this album" button uses this to avoid touching
   * memberships of unrelated kinds. When set, other kinds are neither added
   * NOR removed for this asset — same semantics as if those kinds were
   * disabled for this single call.
   */
  async evaluate(input: { assetId: string; ownerId: string; tags: string[]; onlyKind?: string }): Promise<void> {
    const { assetId, ownerId, tags, onlyKind } = input;
    const { smartAlbums, machineLearning } = await this.getConfig({ withCache: true });

    if (!smartAlbums.enabled) {
      return;
    }

    const allBuiltInKinds = Object.keys(smartAlbums.builtIn) as BuiltInKind[];
    // When scoped to a single kind, treat the others as if disabled for this
    // call — they are neither matched nor removed.
    const builtInKinds = onlyKind ? allBuiltInKinds.filter((k) => k === onlyKind) : allBuiltInKinds;
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

    // CLIP matching requires smart search (the smart_search embedding table is
    // only populated when it is on). The asset vector is loaded lazily — at
    // most one DB round-trip per evaluate, and none when every enabled kind
    // already resolves via tags-only config (empty clipQueries).
    const clipEligible = isSmartSearchEnabled(machineLearning);
    let assetVectorPromise: Promise<Float32Array | undefined> | undefined;
    const getAssetVector = () => (assetVectorPromise ??= this.loadAssetVector(assetId));

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

      // CLIP match: cosine similarity between the asset's smart_search visual
      // embedding and each configured query phrase (encoded via the textual
      // CLIP model, cached per model+query). ML unavailability degrades
      // gracefully — matchesClipQueries logs and returns false, never throws.
      const hasClipMatch =
        clipEligible && kindConfig.clipQueries.length > 0
          ? await this.matchesClipQueries(
              machineLearning.clip,
              kindConfig.clipQueries,
              kindConfig.threshold,
              getAssetVector,
            )
          : false;

      if (hasTagMatch || hasClipMatch) {
        matchedKinds.add(kind);
        const matchReason = hasTagMatch && hasClipMatch ? 'both' : hasTagMatch ? 'tag' : 'clip';
        await this.smartAlbumRepository.addAssetToSmartAlbum(smartAlbumId, assetId, matchReason);
      }
    }

    // Removal: for each kind the asset was previously in that no longer matches,
    // remove it so that stale memberships don't linger when tags change. When
    // scoped to a single kind via onlyKind, we MUST limit the removal loop to
    // that one kind too — otherwise re-evaluating "food" would silently strip
    // the asset out of "pets" or "travel" because matchedKinds only contains
    // food matches.
    for (const kind of currentKinds) {
      if (onlyKind && kind !== onlyKind) {
        continue;
      }
      if (!matchedKinds.has(kind)) {
        const smartAlbumId = albumIdByKind.get(kind as BuiltInKind);
        if (smartAlbumId) {
          await this.smartAlbumRepository.removeAssetFromSmartAlbum(smartAlbumId, assetId);
        }
      }
    }
  }

  /**
   * Load and L2-normalize the asset's smart_search visual embedding. Returns
   * undefined (after logging) when the asset has no embedding yet or the read
   * fails — CLIP matching is then skipped for this evaluation.
   */
  private async loadAssetVector(assetId: string): Promise<Float32Array | undefined> {
    try {
      const row = await this.searchRepository.getEmbedding(assetId);
      const parsed = parseEmbedding(row?.embedding);
      return parsed ? l2Normalize(parsed) : undefined;
    } catch (error) {
      this.logger.warn(
        `Smart-album CLIP matching skipped — failed to load embedding for asset ${assetId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  /**
   * True when the asset's visual embedding is within the similarity threshold
   * of ANY configured query phrase. Query embeddings are encoded via the
   * textual CLIP endpoint and memoized per (model, query). ML failures are
   * logged and treated as "no match" so tag matching keeps working.
   */
  private async matchesClipQueries(
    clip: SystemConfig['machineLearning']['clip'],
    queries: string[],
    threshold: number,
    getAssetVector: () => Promise<Float32Array | undefined>,
  ): Promise<boolean> {
    const assetVector = await getAssetVector();
    if (!assetVector) {
      return false;
    }
    for (const query of queries) {
      try {
        const queryVector = await this.getClipQueryEmbedding(clip, query);
        // Both vectors are unit-length, so the dot product IS the cosine
        // similarity (equivalently 1 - pgvector's <=> cosine distance).
        if (queryVector && dot(assetVector, queryVector) >= threshold) {
          return true;
        }
      } catch (error) {
        this.logger.warn(
          `Smart-album CLIP matching unavailable for query "${sanitizeForLog(query)}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return false;
  }

  private getClipQueryEmbedding(
    clip: SystemConfig['machineLearning']['clip'],
    query: string,
  ): Promise<Float32Array | undefined> {
    const cacheKey = `${clip.modelName}\u{0}${query}`;
    const cached = clipQueryCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const promise = this.machineLearningRepository
      .encodeText(query, { modelName: clip.modelName })
      .then((raw) => {
        const parsed = parseEmbedding(raw);
        return parsed ? l2Normalize(parsed) : undefined;
      })
      .catch((error) => {
        // Drop the failed promise so the next evaluation retries.
        clipQueryCache.delete(cacheKey);
        throw error;
      });
    clipQueryCache.set(cacheKey, promise);
    return promise;
  }

  /**
   * When the master smartAlbums toggle flips from false → true, backfill the
   * six built-in albums for every existing user so they populate without a
   * server restart.
   */
  // workers: [Api] only — backfillAllUsers writes album rows for every user,
  // which we don't want to multiply by replica count in multi-node deployments.
  @OnEvent({ name: 'ConfigUpdate', server: true, workers: [ImmichWorker.Api] })
  async onConfigUpdate({ newConfig, oldConfig }: ArgOf<'ConfigUpdate'>): Promise<void> {
    const wasDisabled = !oldConfig.smartAlbums.enabled;
    const isNowEnabled = newConfig.smartAlbums.enabled;
    if (wasDisabled && isNowEnabled) {
      await this.backfillAllUsers();
    }
  }

  /**
   * Bulk re-evaluate every already-described image asset against the smart-album
   * rules. Called by the admin-triggered re-evaluate endpoint. The evaluation is
   * cheap (tags are already stored; CLIP query embeddings are encoded once and
   * cached) so we do it inline rather than fanning out per-asset jobs.
   */
  @OnJob({ name: JobName.SmartAlbumReevaluateAll, queue: QueueName.BackgroundTask })
  async handleReevaluateAll(data: JobOf<JobName.SmartAlbumReevaluateAll>): Promise<JobStatus> {
    const { smartAlbums } = await this.getConfig({ withCache: false });
    if (!smartAlbums.enabled) {
      return JobStatus.Skipped;
    }

    const kind = (data as { kind?: string } | undefined)?.kind;
    if (kind && !(kind in smartAlbums.builtIn)) {
      // Sanitize: strip control chars + newlines + cap length so an admin-supplied
      // `kind` cannot inject log lines (CWE-117).
      const safeKind = sanitizeForLog(kind);
      this.logger.warn(`Smart-album re-evaluate dispatched with unknown kind "${safeKind}" — skipping`);
      return JobStatus.Skipped;
    }

    const assets = this.assetJobRepository.streamForSmartAlbumReevaluation();
    for await (const asset of assets) {
      try {
        await this.evaluate({
          assetId: asset.id,
          ownerId: asset.ownerId,
          tags: asset.tags ?? [],
          onlyKind: kind,
        });
      } catch (error) {
        this.logger.warn(
          `Smart-album re-evaluate failed for asset ${asset.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return JobStatus.Success;
  }

  /**
   * Backfill the 6 built-in smart albums for every active user. Called when the
   * master `smartAlbums.enabled` toggle flips from false → true so that existing
   * users get their albums without waiting for a server restart.
   */
  async backfillAllUsers(): Promise<void> {
    const users = await this.userRepository.getList({ withDeleted: false });
    for (const user of users) {
      try {
        await this.ensureBuiltInAlbumsForUser(user.id);
      } catch (error) {
        this.logger.warn(
          `Failed to backfill smart albums for user ${user.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Ensure the 6 built-in smart albums exist for the given user. Idempotent —
   * safe to call on every server start or user creation event.
   *
   * Performance (server.md Medium #bootstrap): query existing automation rules
   * through the phase-aware repository (legacy through dual-write, fork sidecar
   * after cutover) before creating static upstream album rows.
   * for this owner FIRST and only pass missing kinds to the repository. This
   * skips the per-kind advisory-lock transaction when nothing is missing —
   * common case after a server restart.
   */
  async ensureBuiltInAlbumsForUser(ownerId: string): Promise<void> {
    const { smartAlbums } = await this.getConfig({ withCache: true });
    if (!smartAlbums.enabled) {
      return;
    }
    const builtInKinds = Object.keys(smartAlbums.builtIn) as BuiltInKind[];
    const existing = await this.smartAlbumRepository.getAllSmartAlbumIdsForOwner(ownerId);
    const kinds = builtInKinds
      .filter((kind) => !existing.has(kind))
      .map((kind) => ({
        kind,
        name: smartAlbums.builtIn[kind].name,
      }));
    if (kinds.length === 0) {
      return;
    }
    await this.smartAlbumRepository.ensureForUser(ownerId, kinds);
  }
}

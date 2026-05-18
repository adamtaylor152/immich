import { Injectable } from '@nestjs/common';
import { Insertable } from 'kysely';
import { SystemConfig } from 'src/config';
import { CLIP_ZERO_SHOT_LABELS, CLIP_ZERO_SHOT_PROMPT } from 'src/constants/clip-zero-shot-labels';
import { ZERO_SHOT_TAG_NAMESPACE } from 'src/constants/zero-shot-tag';
import { TagAssetTable } from 'src/schema/tables/tag-asset.table';
import { BaseService } from 'src/services/base.service';
import { isSmartSearchEnabled } from 'src/utils/misc';
import { upsertTags } from 'src/utils/tag';

type LabelEmbedding = { label: string; embedding: Float32Array };

// One cache entry per CLIP model name. We memoize the promise so concurrent
// callers share a single ML round-trip during cold start.
const VOCABULARY_CACHE = new Map<string, Promise<LabelEmbedding[]>>();

@Injectable()
export class ZeroShotTaggingService extends BaseService {
  /**
   * Apply zero-shot CLIP tags to an asset using its existing visual
   * embedding. Failures are logged but never thrown - tagging is a
   * best-effort enrichment, never a hard dependency of encoding.
   */
  async tagAsset(assetId: string, ownerId: string, assetEmbedding: string): Promise<void> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isSmartSearchEnabled(machineLearning)) {
      return;
    }
    const settings = machineLearning.clip.zeroShotTagging;
    if (!settings.enabled) {
      return;
    }
    try {
      const vector = parseEmbedding(assetEmbedding);
      if (!vector) {
        return;
      }
      const labels = await this.getVocabularyEmbeddings(machineLearning.clip);
      if (labels.length === 0) {
        return;
      }
      const scored = scoreLabels(vector, labels, settings);
      if (scored.length === 0) {
        return;
      }
      await this.applyTags(
        assetId,
        ownerId,
        scored.map((entry) => `${ZERO_SHOT_TAG_NAMESPACE}/${entry.label}`),
      );
    } catch (error) {
      this.logger.warn(
        `Zero-shot tagging failed for asset ${assetId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async getVocabularyEmbeddings(clip: SystemConfig['machineLearning']['clip']): Promise<LabelEmbedding[]> {
    const cacheKey = clip.modelName;
    const cached = VOCABULARY_CACHE.get(cacheKey);
    if (cached) {
      return cached;
    }
    const promise = this.encodeVocabulary(clip).catch((error) => {
      // Drop the failed promise so the next call retries.
      VOCABULARY_CACHE.delete(cacheKey);
      throw error;
    });
    VOCABULARY_CACHE.set(cacheKey, promise);
    return promise;
  }

  private async encodeVocabulary(clip: SystemConfig['machineLearning']['clip']): Promise<LabelEmbedding[]> {
    this.logger.log(`Encoding ${CLIP_ZERO_SHOT_LABELS.length} zero-shot labels for model ${clip.modelName}`);
    const results: LabelEmbedding[] = [];
    for (const label of CLIP_ZERO_SHOT_LABELS) {
      const raw = await this.machineLearningRepository.encodeText(CLIP_ZERO_SHOT_PROMPT(label), {
        modelName: clip.modelName,
      });
      const parsed = parseEmbedding(raw);
      if (parsed) {
        results.push({ label, embedding: l2Normalize(parsed) });
      }
    }
    return results;
  }

  private async applyTags(assetId: string, ownerId: string, tags: string[]): Promise<void> {
    if (tags.length === 0) {
      return;
    }
    const upserted = await upsertTags(this.tagRepository, { userId: ownerId, tags });
    const items: Insertable<TagAssetTable>[] = upserted.map((tag) => ({ tagId: tag.id, assetId }));
    const inserted = await this.tagRepository.upsertAssetIds(items);
    if (inserted.length > 0) {
      await this.eventRepository.emit('AssetTag', { assetId });
    }
  }
}

const parseEmbedding = (raw: string | undefined | null): Float32Array | undefined => {
  if (!raw) {
    return;
  }
  // pgvector / ML service format: "[0.01, 0.02, ...]"
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return;
  }
  const parts = trimmed.slice(1, -1).split(',');
  const out = new Float32Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const value = Number.parseFloat(parts[i]);
    if (!Number.isFinite(value)) {
      return;
    }
    out[i] = value;
  }
  return out;
};

const l2Normalize = (vector: Float32Array): Float32Array => {
  let sumSq = 0;
  for (const v of vector) {
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq);
  if (norm === 0) {
    return vector;
  }
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    out[i] = vector[i] / norm;
  }
  return out;
};

const dot = (a: Float32Array, b: Float32Array): number => {
  if (a.length !== b.length) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
};

type Scored = { label: string; score: number };

export const scoreLabels = (
  assetEmbedding: Float32Array,
  labels: LabelEmbedding[],
  options: { minSimilarity: number; maxTags: number },
): Scored[] => {
  const normalized = l2Normalize(assetEmbedding);
  const scored: Scored[] = [];
  for (const { label, embedding } of labels) {
    const score = dot(normalized, embedding); // cosine on unit vectors
    if (score >= options.minSimilarity) {
      scored.push({ label, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, options.maxTags);
};

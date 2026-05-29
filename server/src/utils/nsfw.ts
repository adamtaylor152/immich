/**
 * Shared NSFW-derivation helpers.
 *
 * The denormalized `asset.is_nsfw` boolean column is owned by
 * `image-enrichment.service` but the JSONB blob it shadows
 * (`asset_metadata` `ml-enrichment`) is writable via the public metadata-write
 * API (`AssetService.upsertMetadata` / `upsertBulkMetadata`). To keep the two
 * in sync we extract the derivation rules here so both writers apply the same
 * logic.
 *
 * Rule precedence (matches `ImageEnrichmentService.getEffectiveNsfw` /
 * `isDescriptionNsfwLikely`):
 *   1. `nsfwDetection.review.isNsfw` — manual override wins
 *   2. `nsfwDetection.result.isNsfw` — model says NSFW
 *   3. `description.result.safety` — high-confidence NSFW + (strong indicator
 *      OR strong text-pattern match) on the description side
 *   4. nsfwDetection succeeded but classified safe → false
 *   5. otherwise undefined (caller treats as "do not change")
 */

const HIGH_CONFIDENCE = 'high';

const STRONG_NSFW_INDICATORS = new Set([
  'adult-nudity',
  'bare-buttocks',
  'bondage',
  'explicit',
  'exposed-genitals',
  'genital',
  'genitals',
  'naked',
  'nude',
  'nudity',
  'pornography',
  'restrained',
  'restraint',
  'sex-toy',
  'sexual-activity',
]);

const STRONG_NSFW_TEXT_PATTERN =
  /\b(naked|nude|nudity|genitals?|penis|vagina|buttocks?|sexual activity|sex toy|bondage|restrained|restraint)\b/i;

const normalizeTag = (tag: string) =>
  tag
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9 _-]/g, '')
    .replaceAll(/\s+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const getString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const getBoolean = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);

const getStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
};

const isDescriptionResultNsfwLikely = (description: unknown): boolean => {
  if (!isRecord(description)) {
    return false;
  }
  const safety = isRecord(description.safety) ? description.safety : undefined;
  if (!safety) {
    return false;
  }
  const isNsfwLikely = getBoolean(safety.is_nsfw_likely);
  const confidence = getString(safety.confidence);
  if (!isNsfwLikely || confidence?.toLowerCase() !== HIGH_CONFIDENCE) {
    return false;
  }

  for (const indicator of getStringArray(safety.indicators)) {
    if (STRONG_NSFW_INDICATORS.has(normalizeTag(indicator))) {
      return true;
    }
  }

  const descriptionText = getString(description.description) ?? '';
  const reason = getString(safety.reason) ?? '';
  return STRONG_NSFW_TEXT_PATTERN.test([descriptionText, reason].join(' '));
};

/**
 * Derive the effective NSFW boolean from a raw `ml-enrichment` metadata value
 * accepted via the public API. Returns `undefined` when the value is unstructured
 * or doesn't make the NSFW determination explicit — callers should treat that as
 * "do not change the column" (matching the runtime semantics of `getEffectiveNsfw`).
 */
export const deriveIsNsfwFromMetadata = (value?: unknown): boolean | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const nsfwDetection = isRecord(value.nsfwDetection) ? value.nsfwDetection : undefined;
  const review = nsfwDetection && isRecord(nsfwDetection.review) ? nsfwDetection.review : undefined;
  if (review) {
    const reviewedIsNsfw = getBoolean(review.isNsfw);
    if (reviewedIsNsfw !== undefined) {
      return reviewedIsNsfw;
    }
  }

  const nsfwStatus = nsfwDetection ? getString(nsfwDetection.status) : undefined;

  if (nsfwDetection && nsfwStatus === 'success') {
    const result = isRecord(nsfwDetection.result) ? nsfwDetection.result : undefined;
    const isNsfwResult = result ? getBoolean(result.isNsfw) : undefined;
    if (isNsfwResult === true) {
      return true;
    }
  }

  const description = isRecord(value.description) ? value.description : undefined;
  if (description && getString(description.status) === 'success' && isDescriptionResultNsfwLikely(description.result)) {
    return true;
  }

  if (nsfwDetection && nsfwStatus === 'success') {
    const result = isRecord(nsfwDetection.result) ? nsfwDetection.result : undefined;
    const isNsfwResult = result ? getBoolean(result.isNsfw) : undefined;
    if (isNsfwResult === false) {
      return false;
    }
  }

  return undefined;
};

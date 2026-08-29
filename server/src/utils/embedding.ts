/**
 * Small vector helpers shared by the CLIP-based enrichment features
 * (zero-shot tagging, smart-album CLIP query matching).
 */

export const parseEmbedding = (raw: string | undefined | null): Float32Array | undefined => {
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
    // eslint-disable-next-line unicorn/prefer-number-coercion -- Number('') is 0, which would silently accept empty segments; parseFloat keeps them NaN so the guard below rejects malformed vectors.
    const value = Number.parseFloat(parts[i]);
    if (!Number.isFinite(value)) {
      return;
    }
    out[i] = value;
  }
  return out;
};

export const l2Normalize = (vector: Float32Array): Float32Array => {
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

export const dot = (a: Float32Array, b: Float32Array): number => {
  if (a.length !== b.length) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
};

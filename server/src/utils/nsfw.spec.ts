import { deriveIsNsfwFromMetadata } from 'src/utils/nsfw';

describe('deriveIsNsfwFromMetadata', () => {
  it('returns undefined for unstructured input', () => {
    expect(deriveIsNsfwFromMetadata()).toBeUndefined();
    expect(deriveIsNsfwFromMetadata(null)).toBeUndefined();
    expect(deriveIsNsfwFromMetadata('not-a-record')).toBeUndefined();
    expect(deriveIsNsfwFromMetadata([])).toBeUndefined();
    expect(deriveIsNsfwFromMetadata({})).toBeUndefined();
  });

  it('honors review override (marked-safe) over a positive model result', () => {
    expect(
      deriveIsNsfwFromMetadata({
        nsfwDetection: {
          status: 'success',
          result: { isNsfw: true, score: 0.95, labels: {} },
          review: { action: 'marked-safe', isNsfw: false },
        },
      }),
    ).toBe(false);
  });

  it('honors review override (marked-nsfw) over a negative model result', () => {
    expect(
      deriveIsNsfwFromMetadata({
        nsfwDetection: {
          status: 'success',
          result: { isNsfw: false, score: 0.05, labels: {} },
          review: { action: 'marked-nsfw', isNsfw: true },
        },
      }),
    ).toBe(true);
  });

  it('returns true when nsfwDetection.result.isNsfw is true', () => {
    expect(
      deriveIsNsfwFromMetadata({
        nsfwDetection: { status: 'success', result: { isNsfw: true, score: 0.9, labels: {} } },
      }),
    ).toBe(true);
  });

  it('returns false when nsfwDetection succeeded and is not NSFW (with no description path)', () => {
    expect(
      deriveIsNsfwFromMetadata({
        nsfwDetection: { status: 'success', result: { isNsfw: false, score: 0.05, labels: {} } },
      }),
    ).toBe(false);
  });

  it('returns true via the description path when nsfwDetection is absent and indicators are strong', () => {
    expect(
      deriveIsNsfwFromMetadata({
        description: {
          status: 'success',
          result: {
            description: 'a benign sentence',
            safety: { is_nsfw_likely: true, confidence: 'high', indicators: ['nudity'], reason: '' },
          },
        },
      }),
    ).toBe(true);
  });

  it('returns true via the description text pattern even without strong indicators', () => {
    expect(
      deriveIsNsfwFromMetadata({
        description: {
          status: 'success',
          result: {
            description: 'contains explicit nude content',
            safety: { is_nsfw_likely: true, confidence: 'high', indicators: [], reason: '' },
          },
        },
      }),
    ).toBe(true);
  });

  it('returns undefined when description path lacks high confidence', () => {
    expect(
      deriveIsNsfwFromMetadata({
        description: {
          status: 'success',
          result: {
            description: 'maybe explicit',
            safety: { is_nsfw_likely: true, confidence: 'medium', indicators: ['nudity'] },
          },
        },
      }),
    ).toBeUndefined();
  });

  it('returns undefined when description path is not nsfw-likely', () => {
    expect(
      deriveIsNsfwFromMetadata({
        description: {
          status: 'success',
          result: {
            description: 'a benign photo',
            safety: { is_nsfw_likely: false, confidence: 'high', indicators: [] },
          },
        },
      }),
    ).toBeUndefined();
  });

  it('returns false when nsfwDetection succeeded as safe and description is also safe', () => {
    expect(
      deriveIsNsfwFromMetadata({
        nsfwDetection: { status: 'success', result: { isNsfw: false, score: 0.05, labels: {} } },
        description: {
          status: 'success',
          result: {
            description: 'a benign photo',
            safety: { is_nsfw_likely: false, confidence: 'high', indicators: [] },
          },
        },
      }),
    ).toBe(false);
  });

  it('returns true when nsfwDetection succeeded as safe but description path triggers', () => {
    expect(
      deriveIsNsfwFromMetadata({
        nsfwDetection: { status: 'success', result: { isNsfw: false, score: 0.05, labels: {} } },
        description: {
          status: 'success',
          result: {
            description: 'contains explicit nude content',
            safety: { is_nsfw_likely: true, confidence: 'high', indicators: [] },
          },
        },
      }),
    ).toBe(true);
  });
});

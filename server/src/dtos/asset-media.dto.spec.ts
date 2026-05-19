import { AssetMediaCreateDto } from 'src/dtos/asset-media.dto';
import { describe, expect, it } from 'vitest';

// Direct-validation harness: AssetMediaCreateDto is a class created from a zod
// schema via createZodDto. The schema is exposed on the class.
const validate = (input: Record<string, unknown>) => AssetMediaCreateDto.schema.safeParse(input);

const baseValid = {
  fileCreatedAt: '2024-01-01T00:00:00.000Z',
  fileModifiedAt: '2024-01-01T00:00:00.000Z',
  assetData: 'placeholder',
};

describe('AssetMediaCreateDto.duration preprocess', () => {
  it('accepts integer milliseconds (modern client contract)', () => {
    const result = validate({ ...baseValid, duration: 42_123 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.duration).toBe(42_123);
    }
  });

  it('accepts numeric string and coerces to integer (multipart form-data)', () => {
    const result = validate({ ...baseValid, duration: '42123' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.duration).toBe(42_123);
    }
  });

  it("converts hh:mm:ss.SSSSSS strings (immich-go's formatDuration default)", () => {
    const result = validate({ ...baseValid, duration: '00:00:00.000000' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.duration).toBe(0);
    }
  });

  it('converts hh:mm:ss.SSS strings (pre-3.0 Immich contract)', () => {
    const result = validate({ ...baseValid, duration: '01:02:03.456' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.duration).toBe(3_723_456);
    }
  });

  it('converts hh:mm:ss strings (no fractional)', () => {
    const result = validate({ ...baseValid, duration: '00:00:42' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.duration).toBe(42_000);
    }
  });

  it('truncates fractional seconds beyond millisecond precision', () => {
    const result = validate({ ...baseValid, duration: '00:00:01.234567' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.duration).toBe(1234);
    }
  });

  it('handles hour values greater than 24', () => {
    const result = validate({ ...baseValid, duration: '25:30:15.999' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.duration).toBe(25 * 3_600_000 + 30 * 60_000 + 15 * 1000 + 999);
    }
  });

  it('accepts missing duration (optional)', () => {
    const result = validate(baseValid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.duration).toBeUndefined();
    }
  });

  it('rejects unparseable string', () => {
    const result = validate({ ...baseValid, duration: 'banana' });
    expect(result.success).toBe(false);
  });

  it('rejects negative integer', () => {
    const result = validate({ ...baseValid, duration: -5 });
    expect(result.success).toBe(false);
  });
});

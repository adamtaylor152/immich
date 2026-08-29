import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashFile, hashFileMatching, SHA1_HEX_LENGTH, SHA256_HEX_LENGTH } from './hash-file';

// Known-good vectors for the empty input
// sha1('')   = da39a3ee5e6b4b0d3255bfef95601890afd80709 (40 chars)
// sha256('') = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 (64 chars)
const EMPTY_SHA1 = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// Known-good vectors for the ASCII string "abc"
// sha1('abc')   = a9993e364706816aba3e25717850c26c9cd0d89d
// sha256('abc') = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
const ABC_SHA1 = 'a9993e364706816aba3e25717850c26c9cd0d89d';
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('hashFile', () => {
  afterEach(() => {
    vi.doUnmock('hash-wasm');
    vi.resetModules();
  });

  it('computes SHA-256 by default and returns a 64-character hex digest', async () => {
    const file = new File(['abc'], 'test.bin');

    const hex = await hashFile(file);

    expect(hex).toBe(ABC_SHA256);
    expect(hex).toHaveLength(SHA256_HEX_LENGTH);
  });

  it('produces the canonical SHA-256 digest for an empty file', async () => {
    const file = new File([], 'empty.bin');

    const hex = await hashFile(file);

    expect(hex).toBe(EMPTY_SHA256);
  });

  it('computes SHA-1 when explicitly requested (for legacy comparison)', async () => {
    const file = new File(['abc'], 'test.bin');

    const hex = await hashFile(file, 'SHA-1');

    expect(hex).toBe(ABC_SHA1);
    expect(hex).toHaveLength(SHA1_HEX_LENGTH);
  });

  it('streams content larger than the chunk size and produces the same digest as a single pass', async () => {
    // Larger than HASH_CHUNK_SIZE (5 MiB) to exercise the chunked loop.
    const chunkSize = 5 * 1024 * 1024;
    const blob = new Uint8Array(chunkSize + 1024).fill(0x42);
    const file = new File([blob], 'large.bin');

    const hex = await hashFile(file);

    // 64 hex chars and deterministic
    expect(hex).toHaveLength(SHA256_HEX_LENGTH);
    const second = await hashFile(file);
    expect(second).toBe(hex);
  });

  it('hashFileWasm and hashFileJs produce identical output for the same input', async () => {
    const { hashFileWasm, hashFileJs } = await import('./hash-file');
    for (const size of [0, 1, 1024, 10_000]) {
      const file = new File([new Uint8Array(size)], 'x.bin');
      for (const algorithm of ['SHA-1', 'SHA-256'] as const) {
        const [wasmHash, jsHash] = await Promise.all([hashFileWasm(file, algorithm), hashFileJs(file, algorithm)]);
        expect(wasmHash).toBe(jsHash);
      }
    }
  });

  it('falls back to the JS implementation when the WASM path throws', async () => {
    vi.doMock('hash-wasm', () => ({
      createSHA1: () => Promise.reject(new Error('boom')),
      createSHA256: () => Promise.reject(new Error('boom')),
    }));
    vi.resetModules();

    const { hashFile: hashFileMocked } = await import('./hash-file');
    const file = new File(['abc'], 'a.txt');
    await expect(hashFileMocked(file)).resolves.toBe(ABC_SHA256);
    await expect(hashFileMocked(file, 'SHA-1')).resolves.toBe(ABC_SHA1);
  });
});

describe('hashFileMatching', () => {
  it('uses SHA-1 when the reference hex looks like a legacy SHA-1', async () => {
    const file = new File(['abc'], 'test.bin');
    // Reference checksum from an existing legacy asset (length 40 ⇒ SHA-1)
    const reference = EMPTY_SHA1;

    const hex = await hashFileMatching(file, reference);

    expect(hex).toBe(ABC_SHA1);
    expect(hex).toHaveLength(SHA1_HEX_LENGTH);
  });

  it('uses SHA-256 when the reference hex looks like a SHA-256', async () => {
    const file = new File(['abc'], 'test.bin');
    // Reference checksum from a new asset (length 64 ⇒ SHA-256)
    const reference = EMPTY_SHA256;

    const hex = await hashFileMatching(file, reference);

    expect(hex).toBe(ABC_SHA256);
    expect(hex).toHaveLength(SHA256_HEX_LENGTH);
  });

  it('defaults to SHA-256 when the reference length is unknown', async () => {
    const file = new File(['abc'], 'test.bin');

    const hex = await hashFileMatching(file, 'not-a-real-checksum');

    expect(hex).toBe(ABC_SHA256);
  });
});

import { sha1 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createSHA1, createSHA256 } from 'hash-wasm';

const HASH_CHUNK_SIZE = 5 * 1024 * 1024;

/**
 * Length of a SHA-1 hex digest. Used by the server to detect legacy assets.
 */
export const SHA1_HEX_LENGTH = 40;

/**
 * Length of a SHA-256 hex digest. Used by the server for assets created after the SHA-256 transition.
 */
export const SHA256_HEX_LENGTH = 64;

export type HashAlgorithm = 'SHA-1' | 'SHA-256';

const hashChunks = async (file: File, update: (chunk: Uint8Array) => void) => {
  for (let offset = 0; offset < file.size; offset += HASH_CHUNK_SIZE) {
    const slice = file.slice(offset, Math.min(offset + HASH_CHUNK_SIZE, file.size));

    const buffer = await slice.arrayBuffer();

    update(new Uint8Array(buffer));
  }
};

export async function hashFileWasm(file: File, algorithm: HashAlgorithm = 'SHA-256'): Promise<string> {
  const factory = await (algorithm === 'SHA-1' ? createSHA1() : createSHA256());
  const hasher = factory.init();

  await hashChunks(file, (chunk) => hasher.update(chunk));

  return hasher.digest();
}

export async function hashFileJs(file: File, algorithm: HashAlgorithm = 'SHA-256'): Promise<string> {
  const hasher = algorithm === 'SHA-1' ? sha1.create() : sha256.create();

  await hashChunks(file, (chunk) => hasher.update(chunk));

  return bytesToHex(hasher.digest());
}

/**
 * Streams the file through the requested hash algorithm in fixed-size chunks so we never
 * load the whole asset into memory. Defaults to SHA-256 to match the server-side checksum
 * (server still accepts SHA-1 for backward compatibility, but new uploads should use SHA-256).
 * Uses the hash-wasm implementation with a pure-JS fallback.
 */
export async function hashFile(file: File, algorithm: HashAlgorithm = 'SHA-256'): Promise<string> {
  try {
    return await hashFileWasm(file, algorithm);
  } catch {
    return hashFileJs(file, algorithm);
  }
}

/**
 * Picks the hash algorithm matching a server-returned hex checksum's length, then hashes the
 * file with it. Useful when comparing a locally-computed checksum against an existing asset:
 * legacy assets have SHA-1 (40 hex chars), new assets have SHA-256 (64 hex chars).
 */
export async function hashFileMatching(file: File, referenceHex: string): Promise<string> {
  const algorithm: HashAlgorithm = referenceHex.length === SHA1_HEX_LENGTH ? 'SHA-1' : 'SHA-256';
  return hashFile(file, algorithm);
}

type HashFileMessage = { file: File; algorithm?: HashAlgorithm };

const isHashFileMessage = (data: unknown): data is HashFileMessage => {
  return (
    typeof data === 'object' && data !== null && 'file' in data && (data as { file: unknown }).file instanceof File
  );
};

// Only register the worker message listener when running inside an actual DedicatedWorker
// (skips registration when this module is imported by the main thread, e.g. unit tests).
const workerScope = (globalThis as { WorkerGlobalScope?: new () => unknown }).WorkerGlobalScope;
const inWorkerScope = workerScope !== undefined && globalThis instanceof workerScope;

if (inWorkerScope) {
  addEventListener('message', (event: MessageEvent<File | HashFileMessage>) => {
    const payload = event.data;
    const file = isHashFileMessage(payload) ? payload.file : payload;
    const algorithm = isHashFileMessage(payload) ? payload.algorithm : undefined;

    void hashFile(file, algorithm)
      .then((result) => postMessage({ result }))
      .catch((error: unknown) => postMessage({ error: error instanceof Error ? error.message : String(error) }));
  });
}

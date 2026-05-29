import { Injectable } from '@nestjs/common';
import { compareSync, hash } from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createHash, createPublicKey, createVerify, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';

@Injectable()
export class CryptoRepository {
  randomUUID(): string {
    return randomUUID();
  }

  randomBytes(size: number) {
    return randomBytes(size);
  }

  hashBcrypt(data: string | Buffer, saltOrRounds: string | number) {
    return hash(data, saltOrRounds);
  }

  compareBcrypt(data: string | Buffer, encrypted: string) {
    return compareSync(data, encrypted);
  }

  hashSha256(value: string) {
    return createHash('sha256').update(value).digest();
  }

  verifySha256(value: string, encryptedValue: string, publicKey: string) {
    const publicKeyBuffer = Buffer.from(publicKey, 'base64');
    const cryptoPublicKey = createPublicKey({
      key: publicKeyBuffer,
      type: 'spki',
      format: 'pem',
    });

    const verifier = createVerify('SHA256');
    verifier.update(value);
    verifier.end();
    const encryptedValueBuffer = Buffer.from(encryptedValue, 'base64');
    return verifier.verify(cryptoPublicKey, encryptedValueBuffer);
  }

  hashSha1(value: string | Buffer): Buffer {
    return createHash('sha1').update(value).digest();
  }

  /**
   * Streams a file from disk and returns a digest.
   *
   * @param filepath Path to the file (or Buffer accepted by createReadStream).
   * @param algorithm Hash algorithm; defaults to `sha1` for backward
   *   compatibility with legacy callers (library scan, motion-photo extract).
   *   New code that needs to verify against a stored asset checksum should
   *   pass the algorithm explicitly — see `hashFileMatching` for a helper.
   */
  hashFile(filepath: string | Buffer, algorithm: 'sha1' | 'sha256' = 'sha1'): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const hash = createHash(algorithm);
      const stream = createReadStream(filepath);
      stream.on('error', (error) => reject(error));
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest()));
    });
  }

  /**
   * Hashes a file with the algorithm that produces the same digest length as
   * the supplied reference. Used when comparing a freshly-computed digest of a
   * moved/copied file against the checksum already stored for the asset, where
   * the stored algorithm may be either SHA-1 (legacy rows, 20 bytes) or
   * SHA-256 (new rows, 32 bytes). Unknown lengths fall back to SHA-1.
   */
  hashFileMatching(filepath: string | Buffer, reference: Buffer): Promise<Buffer> {
    const algorithm = reference.length === 32 ? 'sha256' : 'sha1';
    return this.hashFile(filepath, algorithm);
  }

  randomBytesAsText(bytes: number) {
    return randomBytes(bytes).toString('base64').replaceAll(/\W/g, '');
  }

  signJwt(payload: string | object | Buffer, secret: string, options?: jwt.SignOptions): string {
    return jwt.sign(payload, secret, { algorithm: 'HS256', ...options });
  }

  verifyJwt<T = any>(token: string, secret: string): T {
    return jwt.verify(token, secret, { algorithms: ['HS256'] }) as T;
  }
}

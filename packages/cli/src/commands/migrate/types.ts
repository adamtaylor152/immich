// Raw options as produced by commander for the `migrate` command.
export interface MigrateRawOptions {
  fromUrl?: string;
  fromKey?: string;
  toUrl?: string;
  toKey?: string;
  ledger: string;
  concurrency: string | number;
  dryRun: boolean;
  includeTrashed: boolean;
  retryFailed: boolean;
  faces: boolean; // --no-faces sets this to false
  serve: boolean;
  port: string | number;
}

// Normalized options used throughout the migration.
export interface MigrateOptions {
  from: { url: string; key: string };
  to: { url: string; key: string };
  ledger: string;
  concurrency: number;
  dryRun: boolean;
  includeTrashed: boolean;
  retryFailed: boolean;
  faces: boolean;
  serve: boolean;
  port: number;
}

// The phases a single run steps through, in order. Also the keys used for phase cursors.
export const PHASES = [
  'enumerate',
  'dedupe',
  'transfer',
  'metadata',
  'tags',
  'albums',
  'stacks',
  'people',
  'audit',
] as const;
export type Phase = (typeof PHASES)[number];

// Snapshot of a source asset persisted in the ledger. Kept flat/JSON-friendly.
export interface AssetRecord {
  aId: string;
  checksum: string; // base64 SHA-256/SHA-1 as reported by SERVER A (recomputed to SHA-256 on transfer)
  filename: string;
  type: string;
  fileCreatedAt: string;
  fileModifiedAt: string;
  isFavorite: boolean;
  visibility: string;
  livePhotoVideoAId: string | null;
  description: string | null;
  dateTimeOriginal: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
}

// Live progress shared with the dashboard.
export interface MigrateStatus {
  running: boolean;
  paused: boolean;
  phase: Phase | 'idle' | 'done';
  dryRun: boolean;
  startedAt: string | null;
  from: string;
  to: string;
  user: string;
  counts: Record<string, number>;
  message: string;
  error: string | null;
}

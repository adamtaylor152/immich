import Database from 'better-sqlite3';
import type { AssetRecord } from 'src/commands/migrate/types';

export interface AlbumSnapshot {
  aId: string;
  name: string;
  description: string;
  icon: string | null;
  order?: string;
  sortOrder: number | null;
  parentAId: string | null;
  thumbAId: string | null;
}

export interface StackSnapshot {
  primaryAId: string;
  memberAIds: string[];
}

export interface PersonSnapshot {
  aId: string;
  name: string;
  birthDate: string | null;
  isHidden: boolean;
  isFavorite: boolean;
  color: string | null;
}

interface AssetRow {
  a_id: string;
  checksum: string;
  filename: string;
  type: string;
  file_created_at: string;
  file_modified_at: string;
  is_favorite: number;
  visibility: string;
  live_video_a_id: string | null;
  description: string | null;
  date_time_original: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  b_id: string | null;
  b_checksum: string | null;
  via: string | null;
  uploaded: number;
  meta_applied: number;
  error: string | null;
}

const rowToRecord = (r: AssetRow): AssetRecord => ({
  aId: r.a_id,
  checksum: r.checksum,
  filename: r.filename,
  type: r.type,
  fileCreatedAt: r.file_created_at,
  fileModifiedAt: r.file_modified_at,
  isFavorite: !!r.is_favorite,
  visibility: r.visibility,
  livePhotoVideoAId: r.live_video_a_id,
  description: r.description,
  dateTimeOriginal: r.date_time_original,
  latitude: r.latitude,
  longitude: r.longitude,
  rating: r.rating,
});

/**
 * Durable, crash-safe migration state. Every completed unit of work is committed here
 * *after* SERVER B confirms it, so any interruption resumes without redoing finished
 * work. Reads that drive work queues are streamed (`.iterate()`) so memory stays flat
 * regardless of library size.
 */
export class Ledger {
  private readonly db: Database.Database;
  // Compiled-statement cache: keeps the hot per-asset paths from re-compiling SQL 500k times.
  private readonly stmtCache = new Map<string, Database.Statement>();
  private stmt(sql: string): Database.Statement {
    let s = this.stmtCache.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmtCache.set(sql, s);
    }
    return s;
  }

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS asset (
        a_id TEXT PRIMARY KEY, checksum TEXT NOT NULL, filename TEXT, type TEXT,
        file_created_at TEXT, file_modified_at TEXT, is_favorite INTEGER,
        visibility TEXT, live_video_a_id TEXT, description TEXT, date_time_original TEXT,
        latitude REAL, longitude REAL, rating INTEGER,
        b_id TEXT, b_checksum TEXT, via TEXT, uploaded INTEGER DEFAULT 0, meta_applied INTEGER DEFAULT 0, error TEXT
      );
      CREATE INDEX IF NOT EXISTS asset_checksum ON asset(checksum);
      CREATE INDEX IF NOT EXISTS asset_uploaded ON asset(uploaded);
      CREATE INDEX IF NOT EXISTS asset_meta ON asset(meta_applied);
      CREATE TABLE IF NOT EXISTS album (
        a_id TEXT PRIMARY KEY, name TEXT, description TEXT, icon TEXT, sort_order INTEGER,
        album_order TEXT, parent_a_id TEXT, thumb_a_id TEXT, b_id TEXT, linked INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS tag (a_id TEXT PRIMARY KEY, a_value TEXT, b_id TEXT, assigned INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS stack (
        primary_a_id TEXT PRIMARY KEY, member_a_ids TEXT, b_id TEXT, done INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS person (
        a_id TEXT PRIMARY KEY, name TEXT, birth_date TEXT, is_hidden INTEGER, is_favorite INTEGER,
        color TEXT, b_id TEXT, done INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS cursor (name TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS run (
        id INTEGER PRIMARY KEY CHECK (id = 1), started_at TEXT, from_url TEXT, to_url TEXT,
        user_email TEXT, dry_run INTEGER
      );
    `);
  }

  // --- run metadata ---
  initRun(meta: { fromUrl: string; toUrl: string; userEmail: string; startedAt: string; dryRun: boolean }) {
    this.db
      .prepare(
        `INSERT INTO run (id, started_at, from_url, to_url, user_email, dry_run) VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET from_url = excluded.from_url, to_url = excluded.to_url,
         user_email = excluded.user_email`,
      )
      .run(meta.startedAt, meta.fromUrl, meta.toUrl, meta.userEmail, meta.dryRun ? 1 : 0);
  }

  // --- cursors ---
  getCursor(name: string): string | undefined {
    return (this.stmt('SELECT value FROM cursor WHERE name = ?').get(name) as { value: string } | undefined)?.value;
  }
  setCursor(name: string, value: string) {
    this.db
      .prepare('INSERT INTO cursor (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value')
      .run(name, value);
  }

  // --- assets ---
  upsertAsset(r: AssetRecord) {
    this.stmt(
      `
    INSERT INTO asset (a_id, checksum, filename, type, file_created_at, file_modified_at, is_favorite,
      visibility, live_video_a_id, description, date_time_original, latitude, longitude, rating)
    VALUES (@a_id, @checksum, @filename, @type, @file_created_at, @file_modified_at, @is_favorite,
      @visibility, @live_video_a_id, @description, @date_time_original, @latitude, @longitude, @rating)
    ON CONFLICT(a_id) DO UPDATE SET
      checksum = excluded.checksum, filename = excluded.filename, type = excluded.type,
      file_created_at = excluded.file_created_at, file_modified_at = excluded.file_modified_at,
      is_favorite = excluded.is_favorite, visibility = excluded.visibility,
      live_video_a_id = excluded.live_video_a_id, description = excluded.description,
      date_time_original = excluded.date_time_original, latitude = excluded.latitude,
      longitude = excluded.longitude, rating = excluded.rating
    `,
    ).run({
      a_id: r.aId,
      checksum: r.checksum,
      filename: r.filename,
      type: r.type,
      file_created_at: r.fileCreatedAt,
      file_modified_at: r.fileModifiedAt,
      is_favorite: r.isFavorite ? 1 : 0,
      visibility: r.visibility,
      live_video_a_id: r.livePhotoVideoAId,
      description: r.description,
      date_time_original: r.dateTimeOriginal,
      latitude: r.latitude,
      longitude: r.longitude,
      rating: r.rating,
    });
  }

  upsertAssets(records: AssetRecord[]) {
    this.db.transaction((rows: AssetRecord[]) => {
      for (const row of rows) {
        this.upsertAsset(row);
      }
    })(records);
  }

  // `bChecksum` is the checksum SERVER B actually stores (SHA-256). For a legacy SHA-1
  // asset this differs from the source `checksum`, so the audit must verify against this.
  setAssetUploaded(aId: string, bId: string, via: 'upload' | 'duplicate' | 'present', bChecksum: string) {
    this.stmt('UPDATE asset SET b_id = ?, b_checksum = ?, via = ?, uploaded = 1, error = NULL WHERE a_id = ?').run(
      bId,
      bChecksum,
      via,
      aId,
    );
  }
  setAssetMetaApplied(aId: string) {
    this.stmt('UPDATE asset SET meta_applied = 1 WHERE a_id = ?').run(aId);
  }
  setAssetError(aId: string, message: string) {
    this.stmt('UPDATE asset SET error = ? WHERE a_id = ?').run(message.slice(0, 1000), aId);
  }
  clearErrors() {
    this.stmt('UPDATE asset SET error = NULL WHERE error IS NOT NULL').run();
    // Face reassignment is best-effort and swallows failures, so a person processed before
    // the destination finished face detection is marked done with nothing attached.
    // --retry-failed must reopen them, otherwise those names can never be reattached.
    this.stmt('UPDATE person SET done = 0').run();
  }

  bId(aId: string): string | undefined {
    return (
      (this.stmt('SELECT b_id FROM asset WHERE a_id = ?').get(aId) as { b_id: string | null } | undefined)?.b_id ??
      undefined
    );
  }

  // Batches are materialized (`.all()`), never streamed, because better-sqlite3 forbids
  // writes while a statement's iterator is open — and workers write progress per item.
  // Erroring rows are excluded so a persistent failure can't loop forever; `--retry-failed`
  // (clearErrors) puts them back in scope.
  nextUploadBatch(limit: number): AssetRecord[] {
    const rows = this.stmt('SELECT * FROM asset WHERE uploaded = 0 AND error IS NULL LIMIT ?').all(limit) as AssetRow[];
    return rows.map((row) => rowToRecord(row));
  }
  nextMetaBatch(limit: number): AssetRecord[] {
    const sql = 'SELECT * FROM asset WHERE uploaded = 1 AND meta_applied = 0 AND error IS NULL LIMIT ?';
    return (this.stmt(sql).all(limit) as AssetRow[]).map((row) => rowToRecord(row));
  }
  // Keyset-paginated so neither of these materializes the whole asset table; callers stream
  // a page at a time and memory stays bounded regardless of library size. Ordering by the
  // primary key makes `a_id > after` a stable, index-backed cursor.
  pendingChecksums(after: string, limit: number): Array<{ aId: string; checksum: string }> {
    const sql = 'SELECT a_id, checksum FROM asset WHERE uploaded = 0 AND a_id > ? ORDER BY a_id LIMIT ?';
    const rows = this.stmt(sql).all(after, limit) as Array<{ a_id: string; checksum: string }>;
    return rows.map((r) => ({ aId: r.a_id, checksum: r.checksum }));
  }
  auditRows(
    after: string,
    limit: number,
  ): Array<{ aId: string; checksum: string; bChecksum: string | null; filename: string; uploaded: boolean }> {
    const sql = 'SELECT a_id, checksum, b_checksum, filename, uploaded FROM asset WHERE a_id > ? ORDER BY a_id LIMIT ?';
    const rows = this.stmt(sql).all(after, limit) as Array<{
      a_id: string;
      checksum: string;
      b_checksum: string | null;
      filename: string;
      uploaded: number;
    }>;
    return rows.map((r) => ({
      aId: r.a_id,
      checksum: r.checksum,
      bChecksum: r.b_checksum,
      filename: r.filename,
      uploaded: !!r.uploaded,
    }));
  }

  // --- albums ---
  upsertAlbum(a: AlbumSnapshot) {
    this.db
      .prepare(
        `INSERT INTO album (a_id, name, description, icon, sort_order, album_order, parent_a_id, thumb_a_id)
         VALUES (@a_id, @name, @description, @icon, @sort_order, @album_order, @parent_a_id, @thumb_a_id)
         ON CONFLICT(a_id) DO UPDATE SET name = excluded.name, description = excluded.description,
           icon = excluded.icon, sort_order = excluded.sort_order, album_order = excluded.album_order,
           parent_a_id = excluded.parent_a_id, thumb_a_id = excluded.thumb_a_id`,
      )
      .run({
        a_id: a.aId,
        name: a.name,
        description: a.description,
        icon: a.icon,
        sort_order: a.sortOrder,
        album_order: a.order ?? null,
        parent_a_id: a.parentAId,
        thumb_a_id: a.thumbAId,
      });
  }
  allAlbums(): Array<AlbumSnapshot & { bId: string | null; linked: boolean }> {
    const rows = this.stmt('SELECT * FROM album').all() as Array<{
      a_id: string;
      name: string;
      description: string;
      icon: string | null;
      sort_order: number | null;
      album_order: string | null;
      parent_a_id: string | null;
      thumb_a_id: string | null;
      b_id: string | null;
      linked: number;
    }>;
    return rows.map((r) => ({
      aId: r.a_id,
      name: r.name,
      description: r.description,
      icon: r.icon,
      sortOrder: r.sort_order,
      order: r.album_order ?? undefined,
      parentAId: r.parent_a_id,
      thumbAId: r.thumb_a_id,
      bId: r.b_id,
      linked: !!r.linked,
    }));
  }
  albumBId(aId: string): string | undefined {
    return (
      (this.stmt('SELECT b_id FROM album WHERE a_id = ?').get(aId) as { b_id: string | null } | undefined)?.b_id ??
      undefined
    );
  }
  setAlbumBId(aId: string, bId: string) {
    this.stmt('UPDATE album SET b_id = ? WHERE a_id = ?').run(bId, aId);
  }
  setAlbumLinked(aId: string) {
    this.stmt('UPDATE album SET linked = 1 WHERE a_id = ?').run(aId);
  }

  // --- tags ---
  upsertTag(aId: string, value: string) {
    this.stmt(
      'INSERT INTO tag (a_id, a_value) VALUES (?, ?) ON CONFLICT(a_id) DO UPDATE SET a_value = excluded.a_value',
    ).run(aId, value);
  }
  setTagBId(aId: string, bId: string) {
    this.stmt('UPDATE tag SET b_id = ? WHERE a_id = ?').run(bId, aId);
  }
  setTagAssigned(aId: string) {
    this.stmt('UPDATE tag SET assigned = 1 WHERE a_id = ?').run(aId);
  }
  allTags(): Array<{ aId: string; value: string; bId: string | null; assigned: boolean }> {
    const rows = this.stmt('SELECT * FROM tag').all() as Array<{
      a_id: string;
      a_value: string;
      b_id: string | null;
      assigned: number;
    }>;
    return rows.map((r) => ({ aId: r.a_id, value: r.a_value, bId: r.b_id, assigned: !!r.assigned }));
  }

  // --- stacks ---
  upsertStack(s: StackSnapshot) {
    this.db
      .prepare(
        `INSERT INTO stack (primary_a_id, member_a_ids) VALUES (?, ?)
         ON CONFLICT(primary_a_id) DO UPDATE SET member_a_ids = excluded.member_a_ids`,
      )
      .run(s.primaryAId, JSON.stringify(s.memberAIds));
  }
  setStackDone(primaryAId: string, bId: string) {
    this.stmt('UPDATE stack SET b_id = ?, done = 1 WHERE primary_a_id = ?').run(bId, primaryAId);
  }
  stacksToDo(): StackSnapshot[] {
    const rows = this.stmt('SELECT * FROM stack WHERE done = 0').all() as Array<{
      primary_a_id: string;
      member_a_ids: string;
    }>;
    return rows.map((r) => ({ primaryAId: r.primary_a_id, memberAIds: JSON.parse(r.member_a_ids) as string[] }));
  }

  // --- people ---
  upsertPerson(p: PersonSnapshot) {
    this.db
      .prepare(
        `INSERT INTO person (a_id, name, birth_date, is_hidden, is_favorite, color)
         VALUES (@a_id, @name, @birth_date, @is_hidden, @is_favorite, @color)
         ON CONFLICT(a_id) DO UPDATE SET name = excluded.name, birth_date = excluded.birth_date,
           is_hidden = excluded.is_hidden, is_favorite = excluded.is_favorite, color = excluded.color`,
      )
      .run({
        a_id: p.aId,
        name: p.name,
        birth_date: p.birthDate,
        is_hidden: p.isHidden ? 1 : 0,
        is_favorite: p.isFavorite ? 1 : 0,
        color: p.color,
      });
  }
  setPersonDone(aId: string, bId: string) {
    this.stmt('UPDATE person SET b_id = ?, done = 1 WHERE a_id = ?').run(bId, aId);
  }
  peopleToDo(): PersonSnapshot[] {
    const rows = this.stmt('SELECT * FROM person WHERE done = 0').all() as Array<{
      a_id: string;
      name: string;
      birth_date: string | null;
      is_hidden: number;
      is_favorite: number;
      color: string | null;
    }>;
    return rows.map((r) => ({
      aId: r.a_id,
      name: r.name,
      birthDate: r.birth_date,
      isHidden: !!r.is_hidden,
      isFavorite: !!r.is_favorite,
      color: r.color,
    }));
  }

  // --- counts for dashboard / audit ---
  count(sql: string): number {
    return (this.stmt(sql).get() as { n: number }).n;
  }
  counts(): Record<string, number> {
    return {
      assetsTotal: this.count('SELECT COUNT(*) n FROM asset'),
      assetsUploaded: this.count('SELECT COUNT(*) n FROM asset WHERE uploaded = 1'),
      assetsMeta: this.count('SELECT COUNT(*) n FROM asset WHERE meta_applied = 1'),
      assetsFailed: this.count('SELECT COUNT(*) n FROM asset WHERE error IS NOT NULL'),
      albumsTotal: this.count('SELECT COUNT(*) n FROM album'),
      albumsLinked: this.count('SELECT COUNT(*) n FROM album WHERE linked = 1'),
      tagsTotal: this.count('SELECT COUNT(*) n FROM tag'),
      tagsAssigned: this.count('SELECT COUNT(*) n FROM tag WHERE assigned = 1'),
      stacksTotal: this.count('SELECT COUNT(*) n FROM stack'),
      stacksDone: this.count('SELECT COUNT(*) n FROM stack WHERE done = 1'),
      peopleTotal: this.count('SELECT COUNT(*) n FROM person'),
      peopleDone: this.count('SELECT COUNT(*) n FROM person WHERE done = 1'),
    };
  }

  close() {
    this.db.close();
  }
}

# Upstream-Reversion-Compatible Fork Schema Design

- **Date:** 2026-07-15
- **Status:** Approved design
- **Applies to:** Immich Enhanced releases based on official Immich 3.0 and later

## Objective

Rebuild the fork so an installation can move between the fork and official
Immich without deleting fork data:

```text
fork active -> official Immich active -> fork active again
```

Official Immich must be able to boot, migrate, and operate while fork-owned
state remains dormant in PostgreSQL. Returning to the fork must reactivate
compatible fork state after reconciliation.

This is not a promise that an old fork image can open an arbitrarily newer
official database. A return requires a fork release based on at least the
official database's current version.

## Compatibility Contract

- The contract starts with official Immich 3.0.
- A fork release can hand off to the official release on which it is based.
- Once handed off, normal official Immich upgrades may continue.
- Returning requires a fork release that explicitly supports the database's
  current official version.
- Fork data is not deleted during handoff.
- Official Immich is allowed to ignore all dormant fork data.
- Fork features and privacy filtering are inactive while official Immich is
  running.

## Database Ownership

### Upstream layer

Official Immich owns its schema and migration history:

- Official migration files remain unchanged.
- `kysely_migrations` contains only official migration records.
- The fork runs the official migrator before its own migrator.
- Fork code does not rename, reorder, or edit an already-released official
  migration.
- Fork changes must not alter the meaning of upstream-owned columns,
  constraints, enum values, defaults, or triggers.

This separation is required because Kysely rejects databases whose executed
migration list contains migrations absent from the active provider.

### Fork extension layer

Fork state lives in an `immich_fork` PostgreSQL schema:

- Fork migrations use a separate `immich_fork.migrations` ledger.
- Fork tables use fork-owned names and contracts.
- References to upstream entities are logical identifiers. Database foreign
  keys to upstream tables are avoided where they could obstruct an official
  migration.
- A reconciliation process detects deleted or missing upstream records when
  the fork returns.
- `immich_fork.state` records whether fork behavior is active, the fork schema
  version, the supported upstream version, and the latest handoff checkpoint.

### Sidecar model

Fork additions currently embedded in upstream tables move to sidecar storage:

| Current concern                         | New ownership                                     |
| --------------------------------------- | ------------------------------------------------- |
| NSFW and suppression state              | `immich_fork.asset_privacy`                       |
| Album parent, icon, and ordering        | `immich_fork.album_metadata` and hierarchy tables |
| Physical deduplication mappings         | Fork-owned file and asset mapping tables          |
| SHA-256 and additional hashes           | Fork-owned checksum table                         |
| Image/video descriptions and enrichment | Fork-owned enrichment tables                      |
| Media health and best-photo results     | Fork-owned result tables                          |
| Smart-album rules and exclusions        | Fork-owned automation tables                      |
| RunPod and fork-only configuration      | Fork-owned configuration tables                   |

Fork services join sidecars when active. Official Immich never needs to query
them.

Behavior-changing triggers on upstream tables are eliminated where practical.
Any unavoidable trigger must check `immich_fork.state.active` and be disabled
during official operation.

## Storage Compatibility

Official Immich must never need a fork mapping row to locate or preserve an
original file.

Physical deduplication must use upstream-transparent filesystem behavior:

- Each upstream asset retains a valid path managed according to official
  expectations.
- Shared bytes use hardlinks or reflinks where supported.
- Deleting one asset cannot remove another asset's only readable copy.
- A handoff is refused while any asset depends exclusively on a fork canonical
  reference.

The migration verifies paths, sizes, link behavior, and checksums before
declaring storage compatible.

## Fork-to-Official Handoff

1. Enter maintenance mode and stop writes.
2. Require a verified PostgreSQL backup and media-volume snapshot.
3. Confirm the fork release supports the intended official release.
4. Run bundled official migrations.
5. Verify the official migration ledger and public schema.
6. Confirm no active fork trigger, constraint, or storage mapping can affect
   official operation.
7. Set `immich_fork.state.active = false` and disable remaining fork triggers.
8. Record the upstream version, fork schema version, and checkpoint timestamp.
9. Boot the matching official image and run the official-image smoke suite.

No fork data is deleted.

### Behavior under official Immich

- Fork privacy and NSFW filtering is inactive. Previously hidden assets may be
  visible.
- Nested albums appear using official upstream behavior.
- Smart-album automation stops; existing upstream album memberships remain.
- Health, scoring, enrichment, RunPod, and other fork-only state is ignored.
- New official assets, albums, and users do not receive fork sidecars until the
  fork returns.
- Generated descriptions and tags are invisible to upstream only when they
  have been moved entirely into fork-owned storage.

## Official-to-Fork Return

1. Stop official Immich and take a new backup.
2. Inspect the official migration ledger before normal fork startup.
3. Refuse startup unless the fork supports the database's current official
   version.
4. Run official migrations first; normally this is a no-op.
5. Run `immich_fork.migrations`.
6. Reconcile dormant state:
   - remove or archive sidecars whose upstream records were deleted;
   - initialize safe defaults for new upstream records;
   - validate stored identifiers and filesystem references;
   - preserve compatible enrichment, review, and hierarchy state;
   - rebuild missing or stale derived indexes and caches.
7. Enable approved fork triggers and set `immich_fork.state.active = true`.
8. Queue regeneration only for missing or stale derived data.

Activation occurs only after every reconciliation gate succeeds. A failure
leaves the fork inactive.

## Migration for Existing Fork Installations

Existing installations require an expand-backfill-cutover sequence. The full
conversion must not run as an unbounded normal-startup migration.

### Phase 1: compatibility release

An intermediate release continues to understand the legacy schema while it:

- creates `immich_fork` and its independent migration ledger;
- creates sidecar tables without changing current reads;
- records legacy fork migration history in an audit table;
- dual-writes new fork data to legacy and sidecar storage;
- backfills sidecars in bounded, resumable batches;
- exposes progress, failures, and remaining counts through an admin UI or CLI.

Legacy storage remains authoritative during this phase.

### Phase 2: data conversion

Each feature has a separately checkpointed conversion job:

- privacy and NSFW state;
- album hierarchy, icons, and ordering;
- enrichment, descriptions, and generated tags;
- smart-album rules and exclusions;
- media-health, best-photo, and duplicate-frame state;
- preferences and RunPod configuration;
- physical deduplication and storage normalization;
- checksum normalization.

#### Checksum conversion

Current rows using the fork-only `sha256` enum value cannot be relabelled as
SHA-1.

For every affected asset, the conversion:

1. Preserves SHA-256 in the fork checksum sidecar.
2. Reads the original file and computes the upstream-compatible checksum.
3. Updates upstream checksum fields consistently.
4. Records verification evidence and progress.
5. Refuses final cutover if any required original cannot be read or verified.

After no upstream row uses the fork-only enum value, the compatibility cutover
may rebuild the upstream enum to its official shape. This must be performed as
a separately tested, transactional schema operation.

#### Generated metadata conversion

- Values with definite fork provenance move into fork sidecars.
- Generated blocks are removed from upstream fields only when original user
  content can be reconstructed exactly.
- Ambiguous values remain in upstream storage to prevent user-data loss.

### Phase 3: cutover window

After all backfills report zero outstanding records:

1. Enter maintenance mode and stop writes.
2. Take a database backup and media snapshot.
3. Run the final dual-write delta reconciliation.
4. Compare legacy and sidecar row counts and content hashes.
5. Switch fork reads to sidecars and stop legacy writes.
6. Disable legacy triggers.
7. Move legacy fork tables to `immich_fork_legacy` where safe after removing
   cross-schema constraints that could obstruct upstream.
8. Leave approved inert legacy columns dormant until a later verified cleanup.
9. Preserve legacy migration records in the fork audit table.
10. Remove only allowlisted fork records from `kysely_migrations`.
11. Establish the applied fork-v2 baseline in `immich_fork.migrations`.
12. Run the unchanged official migrator to apply pending official migrations.
13. Boot the official image and run compatibility tests.
14. Mark the conversion complete.

Migration-ledger changes run under a database lock. Unknown migration names
cause an immediate refusal. No heuristic deletion is allowed.

### Existing-installation rollback

- Before ledger cutover, rollback means deploying the previous fork release;
  legacy storage remains authoritative.
- After ledger cutover, rollback means restoring the mandatory checkpoint
  backup.
- The migrator never attempts to reverse ledger surgery automatically.
- Legacy tables remain read-only for at least one release cycle and are not
  deleted as part of compatibility enablement.

## Verification Matrix

The following lifecycle paths must pass:

1. Fresh official 3.x to fresh fork.
2. Current legacy fork to isolated-schema fork.
3. Isolated-schema fork to official Immich.
4. Official Immich after upgrades to a compatible fork.

CI fixtures cover:

- a clean upstream 3.0 database;
- the current fork schema with representative fork data;
- a large-library conversion;
- a database dormant under official Immich for multiple upgrades;
- interrupted and partially completed backfills;
- a sanitized production-shaped snapshot before releasing the conversion.

### Required invariants

- User, asset, album, face, tag, and shared-link counts remain consistent.
- Every upstream asset has a readable original.
- File size and checksum verification succeeds.
- No asset relies exclusively on a fork physical-file mapping.
- Fork privacy, enrichment, and hierarchy records retain their source IDs.
- New official records receive safe defaults when the fork returns.
- Deleted official records cannot reactivate orphaned fork state.
- `kysely_migrations` matches the bundled official migration history.
- `immich_fork.migrations` contains only fork history.
- No active fork trigger, foreign key, default, or enum value changes official
  behavior.

### Official-image compatibility suite

The actual matching official container runs against the migrated database and
must successfully:

- start and complete migrations;
- authenticate and return server information;
- load timeline and search results;
- upload, edit, and delete assets;
- create and delete albums;
- run background jobs;
- support official mobile upload, sync, browsing, and asset viewing;
- restart without migration or schema errors.

The compatible fork then runs against the same, mutated database and must
reconcile and reactivate its state.

## Failure Policy

The process fails closed on:

- an unknown migration record;
- an unreadable original during checksum conversion;
- a sidecar count or content-hash mismatch;
- an unsafe physical-deduplication reference;
- an unsupported official database version;
- writes detected during final reconciliation;
- an official-image compatibility test failure.

A failure does not delete legacy data, continue ledger changes, or partially
activate fork behavior.

## Release Gate

Every release claiming reversion support must pass:

```text
previous fork
  -> isolated-schema fork
  -> matching official Immich
  -> official upgrade
  -> compatible fork
```

Each fork image includes a machine-readable supported-version manifest.
Compatibility is a tested release property, not only a documentation claim.

## Explicit Non-Goals

- Supporting an old fork image against an arbitrarily newer official database.
- Making fork features function while the official image is running.
- Deleting fork data during handoff.
- Automatically rolling back a completed ledger cutover.
- Guaranteeing that ambiguous generated metadata can be removed from upstream
  fields without user review.

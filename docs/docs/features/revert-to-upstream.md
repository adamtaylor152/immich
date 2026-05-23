# Reverting Back to Upstream Immich

This page explains how to migrate a database that was managed by this fork back to the official `immich-app/immich` release, so you can switch your `docker-compose.yml` to `ghcr.io/immich-app/immich-server:release` and keep using your existing assets.

The fork ships an `immich-admin schema-revert-to-upstream` CLI command that rolls back every fork-only database migration and reconciles the migration tracking table so upstream's startup migrator sees the database as fully up to date.

> [!CAUTION]
> This is a destructive operation. Some fork-only data (described below) is deleted permanently. **Take a database backup before you run this command.** See [Backup and Restore](../administration/backup-and-restore.md).

## When You Need This

You need to run the revert if any of the following are true:

- You installed the fork at any point and then ran the server (so fork migrations were applied).
- You want to switch to the official `ghcr.io/immich-app/immich-server` image.
- You see schema-related startup errors from upstream Immich after swapping the image without first reverting.

If you have never run this fork's server image against your database, you do not need this command — your database is still pure upstream.

## What Gets Reverted

The command rolls back the following fork-only migrations, in reverse order, by calling each one's `down()`:

| Migration                                              | What it added                                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `1778000000000-PhysicalDeduplication`                  | `physical_file` table; `asset.physicalOriginalFileId`, `asset_file.physicalFileId` columns                           |
| `1778255964846-PhysicalDeduplicationSchemaReconcile`   | Constraint renames + `migration_overrides` row                                                                       |
| `1778300000000-AddVideoDuplicateFrames`                | `asset_video_duplicate_frame` table                                                                                  |
| `1778788656647-AddVideoDuplicateFrameTriggerOverride`  | `migration_overrides` row                                                                                            |
| `1778900000000-CreateAssetHealthTables`                | `asset_health`, `asset_health_run`, `asset_health_candidate` tables                                                  |
| `1779000000000-AddAssetBestPhotoScore`                 | `asset_best_photo_score` table                                                                                       |
| `1779100000000-ReconcileAssetHealthAndBestPhotoSchema` | Indexes + `migration_overrides` rows                                                                                 |
| `1779200000000-AddAssetExifDescriptionTrigramIndex`    | `idx_asset_exif_description_trigram` GIN index on `asset_exif.description`                                           |
| `1779300000000-AddSmartSearchDescriptionTable`         | `smart_search_description` table                                                                                     |
| `1779400000000-UpdateWorkflowTables`                   | Workflow table updates (byte-identical to upstream's `1778614946174-UpdateWorkflowTables`; left in place, see below) |
| `1779500000000-ReconcileSchemaDrift`                   | Constraint renames + FK reconciliations                                                                              |

After the rollback, the command inserts a row into `kysely_migrations` recording upstream's `1778614946174-UpdateWorkflowTables` as applied. That migration's actual schema effects were already applied by our fork's identical-content `1779400000000-UpdateWorkflowTables`, so this is just a name reconciliation — no DDL runs.

## Data That Is Lost

The tables and columns listed above are dropped, so the following data is **deleted permanently**:

- **Physical-file deduplication graph.** Per-physical-file rows in `physical_file` and the back-references from `asset` and `asset_file`. After revert, upstream Immich treats every asset as having its own original file again.
- **Video duplicate frame embeddings.** Rows in `asset_video_duplicate_frame`.
- **Asset health scan history.** Rows in `asset_health`, `asset_health_run`, `asset_health_candidate`.
- **Best-photo scores.** Rows in `asset_best_photo_score`.
- **VLM image-description embeddings.** Rows in `smart_search_description` (the CLIP-text embeddings of generated `AI description:` blocks, used by smart search). The human-readable `AI description:` text itself lives in the upstream-owned asset description field and is **preserved**.

## Data That Is Preserved

Everything that lives in upstream-owned tables is preserved:

- All assets, originals, sidecars, thumbnails, faces, people, albums, partners, libraries.
- Asset descriptions (including any `AI description:` text the fork added), tags, OCR text, EXIF metadata.
- Existing CLIP smart-search embeddings in `smart_search`.
- Users, sessions, sharing links, activity, notifications, API keys.
- Workflows and plugins.

## Prerequisites

- A recent database backup. See [Backup and Restore](../administration/backup-and-restore.md).
- The fork's `immich-server` container running (the command runs inside it).
- You are an administrator of the host.

## Running the Revert

### 1. Back up the database

Follow [Backup and Restore](../administration/backup-and-restore.md). Do not skip this — there is no `down()` for the revert.

### 2. Run the command

While still on the fork image, [attach to the container](/guides/docker-help.md#attach-to-a-container) and run:

```bash
immich-admin schema-revert-to-upstream
```

The command prints a warning summarizing what will be dropped and prompts you to type `revert` to confirm. After confirmation it rolls back each fork migration, prints the list, and ends with downgrade instructions.

For unattended / scripted use, skip the prompt with `--yes`:

```bash
immich-admin schema-revert-to-upstream --yes
```

### 3. Stop the fork container

```bash
docker compose stop immich-server
```

### 4. Switch the image and restart

In your `docker-compose.yml`, change:

```yaml
services:
  immich-server:
    image: ghcr.io/immich-app/immich-server:release
```

(Or pin to a specific upstream version tag.) Then:

```bash
docker compose pull immich-server
docker compose up -d immich-server
```

### 5. Verify upstream startup

Tail logs:

```bash
docker compose logs -f immich-server
```

You should see upstream's migrator log no pending migrations, the API come up, and assets list correctly in the web UI.

## What If Something Goes Wrong

The revert is run as a sequence of `down()` migrations and a single tracking-table insert. If any `down()` fails partway, the command exits with a non-zero code and prints the failing migration name. The database is in a partial state at that point — restore from the backup you took in step 1 and report the issue.

The command itself is idempotent: if you re-run it against a database that's already at upstream (specifically, one where `1779400000000-UpdateWorkflowTables` is not in `kysely_migrations`), it prints a friendly message and exits without modifying anything.

## Manual Verification Queries

If you want to spot-check the schema before swapping images, attach to the database (see [Postgres Standalone](../administration/postgres-standalone.md)) and run:

```sql
-- Fork tables should all be gone
\dt physical_file
\dt asset_video_duplicate_frame
\dt asset_health
\dt asset_health_candidate
\dt asset_health_run
\dt asset_best_photo_score
\dt smart_search_description

-- Last applied migration should be upstream's UpdateWorkflowTables
SELECT name FROM kysely_migrations ORDER BY name DESC LIMIT 3;

-- Fork-only columns on asset should be gone
\d asset
\d asset_file
```

## Caveats

### CLIP embedding dimension

This fork ships a different default CLIP model (`ViT-B-16-SigLIP-384__webli`, 768-dim) than upstream (`ViT-B-32__openai`, 512-dim). The revert command does **not** touch the `smart_search.embedding` column dimension or your CLIP model setting.

After downgrading, if you had been using the fork's default CLIP model, the upstream server will still see 768-dim embeddings in the database and will continue using whatever CLIP model is configured in your system config — there is no incompatibility at the DB level until you change the CLIP model. If you want to revert to upstream's default CLIP model, do so via **Administration → Settings → Machine Learning** after the downgrade is complete; Immich's existing model-swap flow will resize the column and re-queue smart-search jobs.

### Residual config rows

Fork-only feature flags written to `system_config` and `system_metadata` (for example, image-description settings) remain in the database after revert. Upstream Immich reads these tables by key and ignores unknown keys, so they do not cause errors. They are left in place so you can re-upgrade to the fork later without losing your prior configuration.

### Re-upgrading to the fork

If you later want to switch back to the fork image, you need one manual SQL step **before** starting the fork container, because the revert recorded upstream's `1778614946174-UpdateWorkflowTables` in `kysely_migrations` — that name does not exist on the fork's migration disk, and the fork's migrator runs in strict mode (it will refuse to start with "corrupted migration list" if there's an applied migration it can't find on disk).

After stopping the fork container, but before starting it, attach to the database (see [Postgres Standalone](../administration/postgres-standalone.md)) and run:

```sql
DELETE FROM kysely_migrations WHERE name = '1778614946174-UpdateWorkflowTables';
```

Then start the fork container. The fork migrator will re-apply every fork migration. Two important consequences:

- **Workflow and plugin rows are wiped.** Fork migration `1779400000000-UpdateWorkflowTables` does an unconditional `DROP TABLE workflow; CREATE TABLE workflow …` (and likewise for `plugin`, `workflow_action`, `workflow_filter`, `plugin_action`, `plugin_filter`). This is byte-identical to upstream's `1778614946174-UpdateWorkflowTables` and behaves the same way it did the first time upstream applied it. Any workflows or installed plugins you configured on upstream will be lost. Re-install plugins and re-configure workflows after the fork is up.
- **Fork-only data starts empty.** Best-photo scores, asset-health history, the physical-file dedup graph, video duplicate frame embeddings, and VLM description embeddings all start empty and will be regenerated by the fork's background jobs.

# Reverting Back to Official Immich

The supported procedure depends on which fork release first opened your database.

## Compatibility-certified releases (3.0 and later)

Databases converted by a compatibility-certified 3.x fork can move to the exact certified official Immich image without deleting fork data. The fork keeps official migrations in `public.kysely_migrations` and stores fork-owned state in the isolated `immich_fork` schema. During official operation, those sidecars remain dormant in the database.

Do not change only the image tag. Follow the complete [fork-to-official handoff and return runbook](../administration/upstream-handoff.md). It requires:

- completed, resumable backfills for every fork sidecar family;
- a fresh database backup and matching media snapshot;
- maintenance mode and a digest-bound, locked cutover;
- the exact certified official image, currently `ghcr.io/immich-app/immich-server:v3.1.0`;
- a compatible fork release before returning from official Immich.

Official Immich owns plugin and workflow data. The compatibility process does not copy, translate, delete, or sidecar `plugin`, `plugin_method`, `workflow`, or `workflow_step` rows. Existing official workflows, workflows created while on the fork, and workflows created during official operation remain in the official tables. The fork restores the matching official plugin host ABI when it starts again.

Original Immich users upgrading directly to this fork retain their official data. Fork sidecars are initialized from public rows or safe defaults; official workflow data is left unchanged.

While the official image is running, fork-only behavior is unavailable. In particular, assets hidden only by fork privacy filters can become visible through official timelines, search, albums, downloads, sharing, and mobile clients. Review that exposure before handoff.

On return, `prepare-fork` validates the exact official ledger, reconciles non-workflow sidecars, archives sidecars whose public records were deleted, supplies defaults for newly created official records, and activates fork features only after reconciliation completes. Fork data that is not applicable while official Immich runs remains dormant rather than being dropped.

The local synthetic certification does not replace the release gate against a sanitized production-shaped clone. Complete that external gate before using the cutover in production.

## Pre-compatibility fork releases

Older fork releases wrote fork migrations and columns directly into the public schema and do not have a safe in-place downgrade. Their historical `down()` migrations are not exhaustive. For those databases, retain the original safety rule: restore a matched database and media backup taken before the fork first opened the database, or remain on the fork until it has been upgraded and successfully converted by a compatibility release.

Never point an official image at an unconverted legacy-fork database. It may reject the migration ledger or leave a schema that neither implementation can safely operate.

## Backups remain mandatory

Even on a compatibility-certified release, take and verify both the database backup and media snapshot immediately before handoff. A failure before the checkpoint transaction commits rolls back. A failure in the unchanged official migrator after checkpoint commit crosses the rollback boundary and requires restoring the matched database and media checkpoints.

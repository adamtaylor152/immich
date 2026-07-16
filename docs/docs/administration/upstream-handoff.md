# Certified upstream handoff and fork return

This procedure applies only to a compatibility-certified fork database whose
supported official release is listed in
`server/src/fork-schema/supported-versions.json`. The currently certified image
is exactly `ghcr.io/immich-app/immich-server:v3.0.3`. Never replace that tag
with `latest`, `release`, or another floating tag.

The return mechanism is supported for the certified 3.0 release line and later
certified 3.x releases only. A pre-3.0 fork, an uncertified official version, or
a database without a completed compatibility cutover must be restored from its
database and media checkpoints instead.

:::danger Mandatory release gate
The synthetic container certification in the repository does not certify your
installation. Before release, repeat the complete sequence against a sanitized,
production-shaped clone. Interrupt and resume every backfill and storage
verification job, compare final row and file digests, and boot exact official
`v3.0.3`. This external gate cannot be claimed by a local test run.
:::

## Data ownership and markers

Workflow and plugin tables remain ordinary upstream tables. The fork does not
create a workflow sidecar, copy workflow rows into `immich_fork`, translate
steps, or replay a workflow-specific backfill.

The legacy fork migration
`1779400000000-UpdateWorkflowTables` ran SQL equivalent to official migration
`1778614946174-UpdateWorkflowTables`. During the locked cutover, a current-fork
database aliases only that ledger name and preserves its timestamp. The
workflow/plugin schema fingerprint, counts, and row digests must remain exact.
An original-Immich database already containing `1778614946174` is not aliased.

The command refuses to continue if both markers exist, neither marker exists
while workflow tables exist, or the marker and exact schema fingerprint
disagree. Do not repair these cases by manually editing the ledger.

## Checkpoints and destructive boundary

Take immutable, mutually consistent checkpoints of both PostgreSQL and every
media root. Record their real identifiers. Storage verification requires the
media snapshot ID; a blank, inferred, or newly substituted identifier blocks
preflight. Keep both checkpoints until the fork has returned and passed final
validation.

The ledger alias and compatibility activation commit atomically. A failure
before that commit leaves the old ledger authoritative. Any official migration
failure after the cutover commit requires restoring **both** the database and
media checkpoints. Do not retry by editing released migrations or ledger rows.

## Exact operator sequence

Enter maintenance mode and stop all other API, microservices, and worker
containers before running these commands. Substitute the two immutable IDs from
your checkpoint system.

```bash
export DATABASE_BACKUP_ID='backup-immutable-id'
export MEDIA_SNAPSHOT_ID='media-snapshot-immutable-id'

immich-admin fork-schema status
immich-admin fork-schema start
# Interrupt the worker once, restart it, and then:
immich-admin fork-schema resume
immich-admin fork-schema verify

immich-admin fork-schema-cutover verify-storage start \
  --database-backup-id "$DATABASE_BACKUP_ID" \
  --media-snapshot-id "$MEDIA_SNAPSHOT_ID"
# Interrupt verification once, restart it, and then:
immich-admin fork-schema-cutover verify-storage resume \
  --database-backup-id "$DATABASE_BACKUP_ID" \
  --media-snapshot-id "$MEDIA_SNAPSHOT_ID"

REPORT_DIGEST="$(immich-admin fork-schema-cutover preflight \
  --database-backup-id "$DATABASE_BACKUP_ID" \
  --media-snapshot-id "$MEDIA_SNAPSHOT_ID" \
  --format digest)"

immich-admin fork-schema-cutover apply \
  --database-backup-id "$DATABASE_BACKUP_ID" \
  --media-snapshot-id "$MEDIA_SNAPSHOT_ID" \
  --report-digest "$REPORT_DIGEST"

immich-admin fork-handoff prepare-official
```

Save the canonical JSON printed by `prepare-official`. It names exact image
`ghcr.io/immich-app/immich-server:v3.0.3`. Keep maintenance enabled while
capturing that checkpoint, then stop the fork server. From a one-shot admin
process using the same fork image, run `immich-admin disable-maintenance-mode`
and immediately start the exact official image without changing the tag. This
normal official boot applies every pending certified migration; verify the
public ledger is the full `v3.0.3` manifest before API operations.

Authenticate, list and execute an existing workflow, create a new workflow,
and upload, download, and delete a disposable asset. Confirm database counts
and media bytes after each operation.

## Return to the compatible fork

Re-enter maintenance mode and stop the official container. Before fork startup,
inspect `public.kysely_migrations` and compare it with the exact certified
manifest. Fork startup validates this official ledger before it runs the normal
official provider and then the isolated fork provider.

```bash
immich-admin fork-handoff prepare-fork --batch-size 100
immich-admin fork-schema status
```

Return reconciliation archives and removes only orphaned non-workflow
sidecars, seeds defaults for new upstream IDs, rebuilds derived fork indexes,
and activates fork reads in the final transaction. It must not mutate
`plugin`, `plugin_method`, `workflow`, or `workflow_step`. Verify that workflows
which existed before handoff and workflows created by official Immich are both
still readable and executable as upstream data.

If exact ledger validation, sidecar reconciliation, workflow digest comparison,
or final activation fails, leave maintenance mode enabled and restore the
database and media checkpoints together.

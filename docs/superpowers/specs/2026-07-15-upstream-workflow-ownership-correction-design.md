# Upstream Workflow Ownership Correction

## Status

Approved on 2026-07-15 as a corrective addendum to
`2026-07-15-upstream-reversion-compatible-fork-schema-design.md`.

## Decision

Workflow and plugin behavior is upstream-owned from this migration forward.
The fork will not maintain a workflow sidecar, backfill workflow rows, translate
workflow data, or preserve fork-specific workflow runtime behavior.

The catch-up replaces the fork's workflow server, web, mobile, plugin SDK,
schema definitions, and migrations with the supported original Immich release.
Fork-specific workflow privacy and enrichment gates are not carried forward.

Workflow rows are not disposable. They require no data conversion because the
fork migration `1779400000000-UpdateWorkflowTables` executes the same `up()` SQL
as original Immich v3.0.3 migration
`1778614946174-UpdateWorkflowTables`. Only the migration name and the fork's
defensive `down()` implementation differ.

## Installation Classification

Workflow handling is selected from exact migration history plus an exact schema
fingerprint. Table names alone are never sufficient.

### Original-Immich installation

An installation is classified as original-Immich when:

- `public.kysely_migrations` contains
  `1778614946174-UpdateWorkflowTables`;
- it does not contain `1779400000000-UpdateWorkflowTables`;
- the workflow/plugin catalog matches an accepted official schema stage for the
  supported release.

For this class, workflow/plugin DDL, ledger rows, and data are immutable during
fork compatibility setup and legacy-ledger cutover. Preflight records their
counts and digests, and apply proves they remain unchanged.

### Current-fork installation

An installation is classified as current-fork when:

- `public.kysely_migrations` contains
  `1779400000000-UpdateWorkflowTables`;
- it does not contain `1778614946174-UpdateWorkflowTables`;
- the workflow/plugin catalog exactly matches the post-`UpdateWorkflowTables`
  official schema stage;
- later official workflow migrations are not falsely marked as applied.

For this class, the locked ledger transaction replaces only the legacy migration
name with the official migration name. It preserves the original timestamp and
does not update, copy, delete, or recreate any workflow/plugin row or table.

### Ambiguous installation

The following conditions abort without mutation:

- both workflow migration names are present;
- neither name is present when workflow/plugin tables exist;
- the marker and schema fingerprint disagree;
- a later official workflow migration is recorded but its schema effect is
  absent, or present without its ledger record;
- the workflow/plugin catalog contains an unknown or mixed shape.

There is no heuristic repair and no table-name-based fallback.

## Locked Ledger Alias

The alias runs inside the same maintenance-window migration lock and pre-commit
transaction as the legacy ledger cutover:

1. Lock the official ledger and every workflow/plugin table involved in the
   fingerprint and row digest.
2. Re-run installation classification under those locks.
3. Verify the expected preflight digest.
4. For current-fork installations, copy the legacy row to
   `immich_fork.migration_audit`, including its original timestamp, both names,
   schema fingerprint, row digests, and report digest.
5. Delete exactly `1779400000000-UpdateWorkflowTables`.
6. Insert exactly `1778614946174-UpdateWorkflowTables` with the preserved
   timestamp.
7. Re-read the tables and prove schema fingerprints, row counts, and row digests
   did not change.
8. Commit the alias, remaining allowlisted ledger surgery, audit evidence, and
   fork checkpoint as one transaction.
9. Run the unchanged official migrator after commit. It applies later upstream
   migrations such as `1779806699547-AddPluginTemplates` and
   `1782414436633-AddPluginMethodAllowedHosts` normally.

A post-commit official migration failure requires restoring the mandatory
checkpoint. Released official migrations are never edited or invoked manually.

## Upstream-First Runtime

After source catch-up:

- workflow/plugin repositories and public schema come from upstream;
- workflow/plugin APIs, DTOs, jobs, SDKs, web UI, and mobile clients come from
  upstream;
- no `immich_fork` workflow/plugin sidecars exist;
- no workflow/plugin backfill kind exists;
- fork return reconciliation treats workflow/plugin state as ordinary upstream
  public data and does not transform it;
- future workflow changes arrive through upstream migrations.

Other fork features remain independent. Physical deduplication, media health,
best photos, smart albums, nested albums, RunPod/enrichment, album metadata, and
privacy do not call the workflow subsystem. The previous coupling was only a
workflow-side privacy gate, which this decision removes.

## Fail-Closed Cutover Requirements

The workflow correction does not waive the remaining Task 9 safety findings.
Before ledger cutover can be approved, preflight and apply also:

- require exactly every declared backfill kind, with zero remaining work, no
  active claim, no error, and a valid final digest;
- require complete checksum and upstream-path coverage for every applicable
  asset;
- bind a fresh filesystem verification checkpoint and media-snapshot identity
  into the report digest;
- validate the complete fork migration ledger against its provider;
- digest and lock every fork-owned table, including orphan and derived-result
  tables;
- compare the complete public and `immich_fork` catalogs against versioned
  official/fork manifests rather than selected name patterns;
- keep legacy reads authoritative until the locked cutover transaction changes
  authority;
- implement the documented digest-only preflight and named apply option.

## Verification Matrix

1. **Non-empty original installation:** Seed official plugins, methods,
   workflows, and steps; run compatibility setup and cutover; assert unchanged
   pre-migrator schema fingerprint, ledger timestamp, counts, and row digests.
2. **Non-empty current fork:** Seed the same tables under the legacy marker; run
   alias; assert only the migration name changes and every timestamp, count, and
   row digest is unchanged.
3. **Later upstream migrations:** After alias, run the unchanged official
   migrator; assert plugin templates, hashes, and allowed-host columns are added
   without losing seeded rows.
4. **Both markers:** Assert preflight refuses and no ledger/table row changes.
5. **Missing marker:** Present workflow/plugin tables without either marker;
   assert refusal rather than inference.
6. **Schema mismatch:** Alter one workflow/plugin column, constraint, index,
   trigger, or override; assert refusal.
7. **Transaction failure:** Fail after deleting the legacy marker; assert the
   original marker and all audit/ledger state roll back.
8. **Official round trip:** Boot the supported official container after alias,
   execute an existing workflow, create a new upstream workflow, then boot the
   compatible fork and prove both remain intact.

## Release Boundary

The ledger alias is never a normal startup migration. It is available only
through the explicit maintenance-mode cutover command after a verified database
backup and approved preflight digest. Original-Immich users do not execute the
alias branch.

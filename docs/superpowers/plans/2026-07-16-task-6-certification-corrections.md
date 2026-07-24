# Task 6 Certification Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the local three-lane certification prove the complete saved-plan contract, including normal fork operation after return, meaningful sidecar preservation/default/orphan behavior, full official API operations, a second official restart, and complete CI triggers.

**Architecture:** Extend the existing phase-driven e2e fixtures rather than adding a second harness. Record canonical public and sidecar evidence in the current-fork seed state, mutate that same database under exact official v3.0.3, then reconcile in maintenance and restart the fork normally before final assertions. Keep official and fork process transitions in the shell harness; keep data assertions in Vitest.

**Tech Stack:** TypeScript, Vitest, PostgreSQL, Docker Compose, Bash, Immich REST API.

## Global Constraints

- Do not modify protected official workflow migration sources.
- Use exact image `ghcr.io/immich-app/immich-server:v3.0.3` from `supported-versions.json`.
- Every checked plan invariant must have a concrete assertion; otherwise uncheck it and document the limitation.
- Preserve the external sanitized-production-clone release gate as still outstanding.

---

### Task 1: Full fixture and evidence contract

**Files:**

- Modify: `e2e/src/specs/server/fork-schema-certification.ts`
- Modify: `e2e/src/specs/server/fork-schema-current-fork-cutover.e2e-spec.ts`
- Modify: `e2e/src/specs/server/fork-schema-roundtrip.e2e-spec.ts`

**Interfaces:**

- Produces saved public counts/digests and canonical evidence for privacy, albums, enrichment, automation, health, storage, and checksum.
- Produces IDs for a retained original asset, a deleted original asset with sidecars, an original album, and the original workflow.

- [x] **Step 1: Write RED return assertions** for exact public counts/digests, non-default sidecar preservation, official-row defaults, deleted-sidecar absence/orphan evidence, and maintenance false under authenticated normal API.
- [x] **Step 2: Run `fork-return` against the prior state and confirm it fails** because the saved evidence and normal restart do not exist.
- [x] **Step 3: Seed meaningful non-default rows** in every sidecar family after the initial backfills, save canonical sorted-row digests, and identify the original record that official will delete.
- [x] **Step 4: Expand official operations** to server info, timeline, search, edit, album create/delete, job health, existing-workflow execution, second-workflow creation, retained official asset/album creation, and deletion of the original sidecar-backed asset.
- [x] **Step 5: Run focused e2e typecheck/lint** and confirm the expanded fixtures compile cleanly.

### Task 2: Real process transitions and second official restart

**Files:**

- Modify: `scripts/test-fork-roundtrip.sh`
- Modify: `docs/docs/administration/upstream-handoff.md`

**Interfaces:**

- Produces two healthy official boots on the same database.
- Produces maintenance reconciliation followed by a one-shot maintenance disable and healthy normal fork API/microservices boot.

- [x] **Step 1: Add the second official stop/start** between two explicit official phases and require microservices readiness on both boots.
- [x] **Step 2: Keep return reconciliation in maintenance**, stop the maintenance worker after `prepare-fork`, run one-shot `disable-maintenance-mode`, assert exit 0 and DB false, then start normal fork and wait for API plus microservices readiness.
- [x] **Step 3: Run the final return assertions only after normal startup** and fail if maintenance remains enabled.
- [x] **Step 4: Update operator docs** with the same maintenance-exit and normal-start sequence.
- [x] **Step 5: Run `bash -n` and focused lane certification** until the corrected return lane is green.

### Task 3: CI, full verification, and correction commit

**Files:**

- Modify: `.github/workflows/fork-roundtrip.yml`
- Modify: `.superpowers/sdd/task-6-report.md`
- Modify: `docs/superpowers/plans/2026-07-15-upstream-reversion-compatible-fork-schema.md`

**Interfaces:**

- Produces CI triggers for repositories, commands, admin module, storage initialization, fork schema, harness, docs, and compatibility workflows.

- [x] **Step 1: Broaden CI paths** to `server/src/repositories/**`, `server/src/commands/**`, `server/src/app.module.ts`, `server/src/services/storage.service.ts`, and existing fork-schema/e2e/script surfaces.
- [x] **Step 2: Run the complete clean `all` certification** and require exit 0 with all three lanes.
- [x] **Step 3: Run server/e2e typecheck, focused lint, unit suites, and four fork-schema medium suites** with zero failures.
- [x] **Step 4: Update report and plan checkboxes** only for assertions proven by the fresh run; retain the external release gate limitation.
- [x] **Step 5: Run GitNexus `detect_changes`, staged diff/protected-file audit, and commit the correction separately.**

## Completion evidence

- Independent review `.superpowers/sdd/task-6-review.md` returned `REQUEST CHANGES`; all three findings are closed by this correction wave.
- The final clean `FORK_ROUNDTRIP_LANE=all` run exited 0 and emitted `Local synthetic certification completed for: all` against exact official digest `sha256:c716dc20f957aafd89fa9d284a2ec63e25c9e2d8d8e87c6197d540a3dce237db`.
- The fork restores the official v3 core-plugin host ABI at runtime without migrating, copying, or sidecarring workflow data. The fork privacy auth gate remains enforced.
- Non-finite PostgreSQL evidence is represented by explicit string sentinels, so SQL `NaN` cannot compare equal to SQL `NULL` through JSON persistence.
- The ML-disabled certification environment explicitly disables image description and NSFW detection through authenticated system config before the final workflow probe; all unrelated config is preserved.
- The external sanitized production-shaped clone release gate remains outstanding.

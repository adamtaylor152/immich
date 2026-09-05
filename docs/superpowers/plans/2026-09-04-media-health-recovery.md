# Media Health Recovery Implementation Plan

> Execute with `superpowers:executing-plans`, using strict test-first changes in the existing `aj/immich-missing-files-repair-45bc00` worktree.

## Task 1: Authenticate and scope health operations

**Files:** `server/src/controllers/media-health.controller.ts`, `server/src/services/media-health.service.ts`, `server/src/repositories/media-health.repository.ts`, `server/src/types.ts`, their existing specs.

1. Add failing tests proving scans carry `auth.user.id` and finding actions cannot fetch another owner's records.
2. Run the narrow specs and confirm the expected failures.
3. Pass the authenticated owner id through controller, service, jobs, repository lists, finding lookup, and asset streams. Preserve ownerless internal jobs for backwards compatibility.
4. Re-run the narrow specs.

## Task 2: Exact dual-digest missing-file lookup

**Files:** `server/src/services/media-health.service.ts`, `server/src/repositories/media-health.repository.ts`, `server/src/repositories/fork-schema.repository.ts` only if an existing digest read cannot be reused, existing service/repository specs.

1. Add failing tests for SHA-1-only, SHA-256-only, dual-match ranking, conflicting digest evidence, unsupported file exclusion, and foreign path redaction.
2. Confirm the failures.
3. Reuse `CryptoRepository.hashFileDigests`, `mimeTypes.isAsset`, storage walking, and existing checksum tables to search tracked assets first and managed roots second.
4. Replace visual-only validation for managed originals with exact digest validation; retain visual matching only for legacy external-library assets.
5. Re-run the narrow specs.

## Task 3: Safe relink through physical-file ownership

**Files:** `server/src/services/media-health.service.ts`, `server/src/repositories/physical-file.repository.ts`, `server/src/repositories/media-health.repository.ts`, existing specs.

1. Add a failing test proving a foreign-user exact match relinks only the selected owned asset, records both digests, and never queues file deletion.
2. Confirm the failure.
3. Reuse the existing physical-file candidate/link and advisory-lock operations; add only the smallest transaction method needed to atomically update the missing asset and fork checksum sidecar.
4. Re-hash at action time and fail closed on mismatch/conflict.
5. Re-run the narrow specs.

## Task 4: Owner-local orphan restore

**Files:** `server/src/controllers/media-health.controller.ts`, `server/src/dtos/media-health.dto.ts`, `server/src/services/media-health.service.ts`, `server/src/types.ts`, existing specs; web client files only if the existing action surface needs one button.

1. Add failing tests for owner-local roots, XMP/unsupported skipping, tracked-path skipping, either-digest duplicate suppression, and successful asset registration.
2. Confirm the failures.
3. Add one queued Media Health action that walks only the requesting user's upload/library roots and registers supported untracked files through existing asset/physical/checksum/event/job repositories.
4. Generate API bindings only if the route changes require it; add the smallest existing-view action needed to invoke it.
5. Re-run the narrow specs.

## Task 5: Regression and scope verification

1. Run Media Health unit/repository specs and the existing Integrity medium spec.
2. Run server typecheck/lint for touched files using repository scripts.
3. Run GitNexus `detect_changes` against `fork/main`; investigate any unexpected process or symbol impact.
4. Review the final diff for owner leakage, arbitrary-path trust, source deletion, duplicate creation, and generated-file drift.
5. Commit only the intended tracked changes.

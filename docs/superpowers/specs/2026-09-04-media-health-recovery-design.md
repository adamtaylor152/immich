# Media Health Recovery Design

## Goal

Extend Media Health so a signed-in user can recover a missing asset from an exact byte-for-byte copy anywhere in Immich-managed user storage, and can restore supported untracked media from only their own managed storage without creating checksum duplicates.

## Boundaries

- Missing-asset actions are scoped to findings owned by the authenticated user.
- Recovery may inspect known assets and managed `upload`/`library` roots for every user, but the API never accepts or exposes an arbitrary server path.
- Orphan import scans only the authenticated user's managed roots.
- XMP and every other non-image/non-video file are skipped through the existing MIME registry.
- Existing scheduled/admin health jobs remain compatible; user-triggered jobs carry an owner id.
- No filesystem deletion, scheduler, dry-run mode, global import, or path-picker UI.

## Checksum compatibility

Read the asset's public checksum plus the fork checksum sidecar. A 20-byte value is a SHA-1 candidate and a 32-byte value is a SHA-256 candidate, regardless of the historical algorithm label. Candidate files are streamed once with the existing dual-digest helper. Either matching digest is sufficient; both matching is preferred. If SHA-1 and SHA-256 identify different candidate files, the finding remains unresolved for manual review.

Every candidate is re-hashed immediately before relink. Successful recovery/import writes both digests so old ambiguous records converge on the current representation.

## Recovery flow

1. Scan only the requesting user's database assets for missing originals.
2. For selected owned findings, walk all users' managed upload/library roots and compare both digests, skipping unsupported files and applying a size prefilter when the stored size is trustworthy.
3. Persist opaque candidate ids. Redact candidate paths outside the requester's roots in API responses.
4. Relink only after owner revalidation, candidate re-hash, checksum conflict rejection, and physical-file mapping under existing repository locking. Never enqueue source deletion.

Managed lookup visits at most 10,000 paths and selects at most 10 GiB for hashing per run. When either limit is reached, the run reports an incomplete lookup and candidate/finding evidence records `searchTruncated`. Partial results cannot be automatically relinked because an unvisited file could reveal conflicting checksum evidence. The bounded crawl currently starts from the beginning; resumable traversal is not implemented.

User-triggered lookup requests have a five-minute cooldown after the owner's latest missing-media run. Run admission is serialized in the database across API processes; requests within the cooldown return HTTP 429 without queueing another job. Lookup failures, including queue submission and traversal errors, finalize the run as failed. A candidate disappearing after hashing fails only its own entry in a bulk relink.

## Orphan flow

Walk the requesting user's managed upload/library roots. Skip tracked paths and unsupported/metadata files. Hash each remaining file once. If either digest already belongs to one of that user's assets, do nothing. Otherwise create the normal internal asset record, physical-file mapping, checksum sidecar, metadata job, and asset-created event using existing repositories.

## Verification

Unit tests cover owner propagation, either-digest matching, conflicts, foreign-path redaction, supported-file filtering, and duplicate suppression. Repository tests cover owner-scoped finding access. Existing Media Health and Integrity tests remain green.

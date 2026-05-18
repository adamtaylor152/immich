# Fork follow-ups

Outstanding work surfaced by the multi-agent reviews after the May 2026
`upstream/main` merge (commits `993e0f812` … `708573eb7`). Items here were
deliberately deferred because they need a runtime resource we didn't have
locally (live Postgres, ML infra, schema migration), span more surface area
than the merge-hardening pass wanted to touch, or are speculative until
upstream lands a related feature.

Each entry: **summary · why deferred · what to do · acceptance criteria · pointers**.

---

## P1 — Performance: denormalize `asset.is_nsfw`

**Summary.** [`nsfwAssetIdExists`](server/src/utils/database.ts) does up to four
`jsonb #>>` extractions, a `jsonb_array_elements_text` unnest, a per-element
`regexp_replace`, and a case-insensitive `~*` regex against the freeform
`description` text — *per row*. This EXISTS subquery runs on every timeline
page, every search, every workflow eligibility check, every
`withImageEnrichmentFilter` call. On libraries with millions of metadata rows
it dominates query cost (estimated 50–200ms per filtered list page).

**Why deferred.** Schema change + migration + backfill across every asset's
`asset_metadata.MlEnrichment` row. Not safe to land alongside a privacy
hardening pass without a maintenance window or feature flag.

**What to do.**
1. Add a `boolean is_nsfw` column on the `asset` table (or a one-row-per-asset
   `asset_flags` side table to avoid touching the hot row).
2. Add a migration that backfills from `asset_metadata.MlEnrichment` using the
   same logic as `nsfwAssetIdExists`.
3. Update every code path that writes `asset_metadata.MlEnrichment` (NSFW
   detection job, manual review actions, description-based NSFW inference) to
   also set the flag.
4. Replace `nsfwAssetIdExists(...)` call sites with `where asset.is_nsfw =
   false` (or the inverted variant in `withImageEnrichmentFilter`). Keep the
   JSON evaluation only as the *source-of-truth* used at write time.

**Acceptance criteria.**
- Timeline query EXPLAIN ANALYZE for a 1M-asset library shows >10× speedup on
  the NSFW filter clause.
- Manual `UPDATE asset_metadata SET value = '...'` outside the application path
  triggers a backfill job (or is documented as unsupported).
- No regression in NSFW filtering on shared links, sync, search, person
  thumbnails, notifications.

**Pointers.** [server/src/utils/database.ts:109-141](server/src/utils/database.ts:109);
all call sites grep `nsfwAssetIdExists|nsfwAssetExists|withoutNsfwAssets|withImageEnrichmentFilter`.

---

## P2 — Media-health: ffmpeg per-asset timeout × queue concurrency

**Summary.** [`validateAssetIntegrity`](server/src/services/media-health.service.ts)
calls `ffmpeg -v error -i <path> -f null -` with a 120-second hard timeout
inside a streaming `for await` loop. A library of thousands of large videos +
one truly corrupt file that hangs ffmpeg can eat 120s before the loop
progresses. The MediaHealth queue is now at concurrency=2 (was 1), so two
workers can stall simultaneously. No resumable cursor — a crash mid-scan
restarts from scratch.

**Why deferred.** Needs a queue-level rate-limit design choice and ideally a
chunked cursor backed by `media_health_run` state. The 120s timeout is also
load-bearing for legitimately large 4K source files; just shrinking it would
cause false-positive "corrupt" markings.

**What to do.**
1. Configure per-worker ffmpeg concurrency via Bull's rate-limit options (not
   queue concurrency) so a single worker can pipeline a few decodes without
   overwhelming the box.
2. Persist a "last scanned asset id" cursor on the `media_health_run` row so
   resuming a failed scan skips already-scanned assets.
3. Consider a shorter "fast probe" pass (ffprobe-only) before the full decode,
   to surface obvious problems quickly and reserve the 120s budget for assets
   that warrant it.
4. Surface a circuit breaker: if N consecutive assets time out, finish the run
   with `partial` status and emit an admin notification.

**Acceptance criteria.**
- A 1M-asset corrupt scan resumes from the cursor on worker restart.
- An asset that hangs ffmpeg does not block other assets in the same scan from
  making progress.

**Pointers.** [server/src/services/media-health.service.ts:370](server/src/services/media-health.service.ts:370)
(`handleCorruptScan`), [:703](server/src/services/media-health.service.ts:703)
(`validateAssetIntegrity`), [server/src/config.ts:279](server/src/config.ts:279).

---

## P3 — Test coverage gaps

Three medium-test specs that lock in the privacy + data-loss fork
differentiators. All require a live Postgres (medium tests run against a
real DB via `MediumTestContext`), which is why they weren't written in the
hardening pass.

### P3a — `WorkflowRepository.isWorkflowEligible` privacy gate

**File.** `server/test/medium/specs/workflow/workflow-privacy.spec.ts` (new)
or alongside `workflow-core-plugin.spec.ts`.

**Cases.** All `HIGH` priority — this is the load-bearing guarantee that
NSFW/hidden assets don't reach plugins:
- returns false for `visibility = Hidden`
- returns false for `visibility = Locked`
- returns false for `deletedAt != null`
- returns false when `asset_metadata.MlEnrichment` row encodes NSFW
- returns false for non-existent `assetId`
- returns true for a plain Timeline asset (no NSFW metadata, NSFW detection
  disabled)
- with `requireEnrichment = true`, returns false when MlEnrichment row missing
  even if visibility is Timeline (proves the fail-closed at upload time)

**Pointers.** [server/src/repositories/workflow.repository.ts:135](server/src/repositories/workflow.repository.ts:135);
[server/test/medium/specs/workflow/workflow-core-plugin.spec.ts](server/test/medium/specs/workflow/workflow-core-plugin.spec.ts)
for the harness pattern.

### P3b — Workflow plugin write-restriction

**File.** `server/test/medium/specs/workflow/workflow-execution-write.spec.ts`
(new).

**Cases.** All `HIGH`:
- a plugin returning `{ asset: { visibility: 'timeline' } }` on a `Hidden`
  asset must leave `asset.visibility` unchanged (proves no SQL UPDATE is
  emitted for the `visibility` column).
- a plugin returning `{ asset: { visibility: 'timeline', isFavorite: true } }`
  applies `isFavorite` but does not touch `visibility`.

**Pointers.** [server/src/services/workflow-execution.service.ts:285](server/src/services/workflow-execution.service.ts:285)
(the explicit `update` allow-list).

### P3c — Physical deduplication refcount + dry-run

**File.** `server/test/medium/specs/services/physical-deduplication.service.spec.ts`
(new). No spec exists today.

**Cases.** All `HIGH` (data loss risk):
- refuses to queue `FileDelete` when the master path doesn't exist on disk
  (proves the on-disk verification guard in commit `2601fc311`).
- refuses to queue `FileDelete` for a generated file when the master's
  generated file is missing on disk.
- link creation is idempotent on retry — re-running on a corpus already
  deduped is a no-op.
- dry-run mode emits no `FileDelete` jobs and does not call
  `storageRepository.unlink`.
- when a physical_file row is still referenced by another asset, deletion is
  suppressed (refcount check).

**Pointers.** [server/src/services/physical-deduplication.service.ts](server/src/services/physical-deduplication.service.ts).

---

## P4 — Defensive: new `WorkflowTrigger` values must call `isWorkflowEligible`

**Summary.** Today only `WorkflowTrigger.AssetCreate` has a job handler. The
enum already declares `PersonRecognized` (wired to `AssetPersonV1`) and
upstream may add more. The privacy gate is per-handler, not type-system
enforced — a new trigger handler that forgets to call `isWorkflowEligible`
would silently leak Hidden/Locked/NSFW assets.

**Why deferred.** No handler exists yet, and the right enforcement mechanism
(static analysis vs runtime assertion vs unit test) depends on what upstream's
handler looks like.

**What to do.** Options, pick one when the next handler lands:
1. A unit-level architecture test that uses the TypeScript AST to find every
   `@OnJob({ name: JobName.Workflow* })` handler and assert each one calls
   `workflowRepository.isWorkflowEligible`.
2. Factor the eligibility check into a guard inside `execute()` so all
   trigger paths funnel through it.
3. A runtime warning at startup that scans `WorkflowTrigger` enum members and
   asserts a corresponding `OnJob` exists, with a check that the handler's
   AST references `isWorkflowEligible`.

**Pointers.** [server/src/enum.ts:1279-1282](server/src/enum.ts:1279)
(`WorkflowTrigger`), [server/src/services/workflow-execution.service.ts:281](server/src/services/workflow-execution.service.ts:281)
(`execute`), [server/src/utils/workflow.ts:5-6](server/src/utils/workflow.ts:5)
(trigger → event-data type mapping).

---

## P5 — Plugin SDK: declared `visibility` / `status` / `deletedAt` fields

**Summary.** [`AssetV1`](packages/plugin-sdk/src/types.ts) declares
`visibility: AssetVisibility`, `status: AssetStatus`, `deletedAt: Date | null`
as non-nullable. The fork's gate (`isWorkflowEligible`) ensures these always
fall in a narrowed safe set — `visibility ∈ {Timeline, Archive}`,
`status = Active`, `deletedAt = null` — but plugin authors writing against
the type signature have no way to know that. A future addition to the
allow-list, or a new trigger, could silently widen the contract.

**Why deferred.** The SDK is upstream-owned. Forking the type either creates
divergence pain on every upstream bump, or requires a deliberate upstream PR.

**What to do.**
- Open an upstream issue/PR proposing to narrow the SDK types to the safe
  subset, since the gate is server-enforced anyway.
- Until then, document the narrowed contract in the fork's plugin docs so
  third-party plugin authors don't write code that depends on seeing
  `Hidden`/`Locked` etc.

**Pointers.** [packages/plugin-sdk/src/types.ts](packages/plugin-sdk/src/types.ts)
(`AssetV1`), [server/src/repositories/workflow.repository.ts:135](server/src/repositories/workflow.repository.ts:135).

---

## P6 — Best-photos: dead video-scoring schema

**Summary.** `best_photos.service.ts` declares video-scoring columns
(`bestFrameTimestampMs`, `frameScore`, `frameMetadata`) but
[`isEligible`](server/src/services/best-photos.service.ts:102) filters to
`AssetType.Image` only. The columns are always `null`.

**What to do.** Pick one:
1. Implement video scoring (sample frames after transcoding/thumbnail
   generation — the TODO at line 144-145 spells out the approach).
2. Drop the unused columns + schema + the dead TODO.

**Pointers.** [server/src/services/best-photos.service.ts:102](server/src/services/best-photos.service.ts:102),
[:144](server/src/services/best-photos.service.ts:144).

---

## P7 — Image enrichment: 24-tag truncation drops NSFW tags

**Summary.** [`image-enrichment.service.ts:766`](server/src/services/image-enrichment.service.ts:766)
builds a tag Set then `[...tags].slice(0, 24)`. NSFW tags appended later
(around line 749-754) can fall outside the 24-slot budget if `result.tags`
already filled it — silently dropping the most privacy-relevant tags.

**What to do.** Reserve budget for NSFW tags by prepending them to the Set,
or split into "always-applied" (NSFW-derived, no cap) and "capped"
(description-derived, 24 slot limit) buckets.

**Pointers.** [server/src/services/image-enrichment.service.ts:749-766](server/src/services/image-enrichment.service.ts:749).

---

## P8 — Ask-search: silent empty results for unresolvable locations

**Summary.** [`search.service.ts:355-356`](server/src/services/search.service.ts:355)
extracts location phrases like `"in my hometown"` and title-cases them into a
strict `filters.city = "My Hometown"` match. If the phrase doesn't resolve to
a known city, the query returns zero results with no user feedback.

**What to do.** When a location filter is derived from a phrase that doesn't
match any known location, push a `warnings: [...]` entry on the response DTO
so the UI can surface "Couldn't find a place matching 'my hometown' — showing
unfiltered results" or similar.

**Pointers.** [server/src/services/search.service.ts:355](server/src/services/search.service.ts:355).

---

## Status of resolved items

For reference, the following review findings *were* fixed in the hardening
pass — included here only so future reviewers know not to re-surface them.
See commits `b99720a54`, `2601fc311`, `708573eb7`.

- Workflow plugins receiving NSFW/hidden assets (gate + emit moved to
  `AssetMetadataExtracted`)
- Plugin `albumAddAssets` host-function bypass (synthesized AuthDto sets
  `hideNsfwAssets: true`)
- Plugins writing `visibility` to un-hide assets (explicit allow-list,
  `isFavorite` only)
- Duplicate `'asset.isFavorite'` in `workflowAssetV1` column list
- `pnpm run check` failing on cold clone (server `check` script now builds
  `@immich/plugin-sdk` first)
- Physical-dedup orphaning duplicates when the master file is missing on disk
  (`storageRepository.checkFileExists` guard)
- `image-enrichment` read-modify-write race (`withAssetMetadataLock`)
- Media-health corrupt-scan per-asset UPDATE round-trips (batched
  `markResolvedMany`)
- Media-health O(N·M) library traversal in `handleLocateMissing` (cached
  basename→paths index)
- ML queue concurrency=1 backfill bottleneck (bumped to 2)
- `BestPhotosRepository.deleteForAssets` `@GenerateSql` decorator declaring
  scalar instead of array (`[[DummyValue.UUID]]`)

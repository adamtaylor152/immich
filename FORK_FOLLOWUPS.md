# Fork follow-ups

Outstanding work surfaced by the multi-agent reviews after the May 2026
`upstream/main` merge (commits `993e0f812` … `708573eb7`). Items here were
deliberately deferred because they need a runtime resource we didn't have
locally (live Postgres, ML infra, schema migration), span more surface area
than the merge-hardening pass wanted to touch, or are speculative until
upstream lands a related feature.

Each entry: **summary · why deferred · what to do · acceptance criteria · pointers**.

---

## P1 — Performance: denormalize `asset.is_nsfw` — ✅ RESOLVED

**Resolution (Aug 2026).** Fully implemented: the `asset.is_nsfw` column plus
partial index and metadata backfill shipped in migration
`2100000000010-AddAssetIsNsfwIndex`; `AssetRepository.upsertMetadata`
(`syncIsNsfwForItems`) keeps the boolean in sync on every `MlEnrichment`
write; reads go through the phase-aware `nsfwAssetIdExists` in
[server/src/utils/database.ts](server/src/utils/database.ts) (legacy/dual-write/ready
read `asset.is_nsfw`, active reads the `immich_fork.asset_privacy` sidecar,
fail-closed); catalog entries are certified in `fork-v2-catalog.json`.
Remaining caveat: out-of-band `UPDATE asset_metadata` statements that bypass
the application write path do not trigger the sync and are **unsupported**
(documented here per the acceptance criteria).

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

## P3d — NSFW privacy gaps in sync, shared links, notifications, person — ✅ RESOLVED

**Resolution (Aug 2026).** All four surfaces are now gated and covered by
medium tests:

- **Partner sync delta** — gates already existed
  (`withHiddenContentFilter` on `PartnerAssetsSync.getUpserts`/`getBackfill`);
  added non-elevated vs elevated exclusion tests for both the full payload
  and the backfill path in
  `server/test/medium/specs/sync/sync-partner-asset.spec.ts`.
- **Shared link** — gate already existed (`nsfwOptions` on
  `SharedLinkService.get` + `applyNsfwPrivacy` thumbnail blanking); added an
  explicit direct-`get(auth, id)` test in
  `server/test/medium/specs/services/shared-link.service.spec.ts`.
- **Notifications** — gate already existed
  (`getAlbumThumbnailAttachment` + `getEmailHiddenContentFilter`); created
  `server/test/medium/specs/services/notification.service.spec.ts` asserting
  album-invite/update emails blank an NSFW album thumbnail and keep a safe one.
- **Person face thumbnail selection** — this one was a real gap: fixed at the
  root in `PersonRepository.getRandomFace` (orders candidate faces by the
  phase-aware `nsfwAssetIdExists` ascending so a safe face wins whenever one
  exists; NSFW-only people still get a thumbnail), benefiting both
  `PersonService.createNewFeaturePhoto` and
  `MediaService.handleQueueGenerateThumbnails`. Covered by
  "does not select an NSFW asset as person thumbnail when a safe face exists"
  in `server/test/medium/specs/repositories/person.repository.spec.ts`
  (verified to fail without the fix).

**Summary.** The fork has explicit NSFW-privacy commits for map markers
(`9ab65954d`), duplicate activity (`9ab65954d`), shared-link contexts
(`633707b2c`), and sync privacy (`117352d28`). Test coverage exists for some
but not all surfaces. The May 2026 review found **no NSFW assertions** in:

- **Sync delta for partner/shared timeline.** A regression that drops the
  NSFW filter from the partner sync payload would silently leak suppressed
  asset IDs cross-account.
- **Shared link asset listing.** `getById` on a shared link could surface
  NSFW assets the owner has marked hidden.
- **Notification "memory" / "on this day".** Scheduled memory notifications
  could include NSFW assets in their thumbnail set.
- **Person face thumbnail selection.** Without an explicit filter, a
  person's representative thumbnail can be picked from their NSFW assets.

**Why deferred.** Medium tests, need a live Postgres.

**What to do.** Add four medium-test specs, all HIGH priority (privacy
correctness):

| File | Test |
|---|---|
| `server/src/services/sync.service.spec.ts` | `excludes NSFW asset ids from partner/shared sync payloads` |
| `server/src/services/shared-link.service.spec.ts` | `getById omits NSFW assets from shared link asset set` |
| `server/src/services/notification.service.spec.ts` | `does not surface NSFW assets in scheduled memory notifications` |
| `server/src/services/person.service.spec.ts` | `does not select NSFW asset as person thumbnail` |

Each should: seed a Timeline asset + a paired `asset_metadata.MlEnrichment`
NSFW row for the same owner, exercise the service endpoint, assert the NSFW
asset is *not* in the returned set.

**Pointers.** Existing fork NSFW privacy commits — `9ab65954d`, `1fe292cfb`,
`633707b2c`, `117352d28`, `7c6d85773` — touch these surfaces; the tests they
ship cover map markers + duplicates but not the four above.

---

## P3e — Additional service test gaps (medium priority)

Smaller coverage holes that aren't load-bearing on privacy but would catch
real regressions:

**Image enrichment review controls** ([server/src/services/image-enrichment.service.ts:148-213](server/src/services/image-enrichment.service.ts:148)):
- `marked-nsfw` review writes review metadata, sets `isNsfw=true`, creates
  nsfw_asset row, sets `reviewedBy`
- Re-reviewing replaces prior `reviewedAt`/`reviewedBy`
- Auto-`accepted` review is overwritable by manual `marked-safe`
- Detection failure leaves no stale review object / no nsfw_asset row

**Media health additional cases** ([server/src/services/media-health.service.ts](server/src/services/media-health.service.ts)):
- `dismiss` clears finding without affecting asset
- `relinkMissing` rejects candidate path that fails validation
- Partial failure: one asset throws during scan, others still recorded
- Combined missing+corrupt scan finishes corrupt run when missing run errors mid-batch

**Web fork features** (HIGH priority for best-photos NSFW filter):
- `web/src/routes/(user)/best-photos/+page.ts` loader filters out NSFW/hidden
  assets from the feed
- Ask-search service forwards query + respects NSFW filter flag
- Mobile-nav advanced-search slider binds + emits

**Mobile NSFW actions** ([mobile/lib/presentation/widgets/action_buttons/mark_nsfw_action_button.widget.dart](mobile/lib/presentation/widgets/action_buttons/mark_nsfw_action_button.widget.dart)):
- Tapping invokes `ActionService.markNsfw` with current selection
- `markNsfw` posts to `/nsfw` with selected asset ids + updates local store
- `markSafe` inverse path removes asset from NSFW set

---

## P9 — Hash caching (LOW)

**Summary.** [`physical-deduplication.service.ts:229`](server/src/services/physical-deduplication.service.ts:229)
streams `hashFile` (good) but doesn't cache results. If the same canonical
file is processed twice in one migration run, there's no in-memory dedupe.
Low impact unless full re-runs are common; add a `Map<path, hash>` if it
shows up in profiling. Left here rather than fixed because real-world impact
is unclear without profiling data.

---

## Status of resolved items

For reference, the following review findings *were* fixed in the hardening
passes — included here only so future reviewers know not to re-surface them.

**Privacy & data-loss** (`b99720a54`, `2601fc311`):
- Workflow plugins receiving NSFW/hidden assets (gate + emit moved to
  `AssetMetadataExtracted`)
- Plugin `albumAddAssets` host-function bypass (synthesized AuthDto sets
  `hideNsfwAssets: true`)
- Plugins writing `visibility` to un-hide assets — the explicit allow-list
  permits `visibility` writes (so upstream's archive/lock plugin methods
  still work) but the read-side `isWorkflowEligible` gate prevents Hidden/
  Locked assets from ever reaching a plugin, closing the un-hide path
- Physical-dedup orphaning duplicates when the master file is missing on disk
  (`storageRepository.checkFileExists` guard)
- Defensive: every workflow trigger now routes through `execute()` which runs
  `isWorkflowEligible` per-asset — new triggers can't forget the gate

**Performance** (`708573eb7`):
- `image-enrichment` read-modify-write race (`withAssetMetadataLock`)
- Media-health corrupt-scan per-asset UPDATE round-trips (batched
  `markResolvedMany`)
- Media-health O(N·M) library traversal in `handleLocateMissing` (cached
  basename→paths index)
- ML queue concurrency=1 backfill bottleneck (bumped to 2)

**Correctness & cleanup** (this round + earlier):
- Duplicate `'asset.isFavorite'` in `workflowAssetV1` column list
- `pnpm run check` failing on cold clone (server `check` script now builds
  `@immich/plugin-sdk` first)
- `BestPhotosRepository.deleteForAssets` `@GenerateSql` decorator declaring
  scalar instead of array (`[[DummyValue.UUID]]`)
- Image enrichment 24-tag truncation could drop NSFW/medical tags — required
  tags now reserve budget before description tags
- Ask-search silent empty results — possessive/generic phrases ("my hometown",
  "the beach") now emit a warning instead of forcing a no-match city filter
- Best-photos magic constants extracted to `FACE_COUNT_CAP` / `PER_FACE_WEIGHT`
- Media-health non-null assertions on `createdRun!.id` rewritten as explicit
  branches
- Physical-dedup "feature disabled" log noise demoted from WARN to debug

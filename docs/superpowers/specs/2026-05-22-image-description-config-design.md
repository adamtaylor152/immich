# Configurable Image Description, Identity-Aware Captions, and Smart Auto-Albums

**Status:** Draft — pending implementation planning
**Date:** 2026-05-22
**Owner:** AJ Taylor

## Problem

Immich's current image-description feature produces generic captions ("a man sitting on a bed with clothes on the floor") that aren't useful for search or browsing a personal library. Two root causes:

1. **No identity awareness.** The VLM has no access to the named-person data Immich already has from face recognition, so descriptions never include names like "Conner playing baseball."
2. **One-size-fits-all prompt.** The prompt at `machine-learning/immich_ml/models/image_description.py:17` is hard-coded. Admins can't tune for their library's content, vocabulary, or detail level.

Additionally, Immich has no Google-Photos-style smart collections (Travel, Documents, Screenshots). Tags from the description pipeline already contain the signal needed; only the surface to consume that signal is missing.

## Goals

- Make the description prompt, vocabulary, and behavioral knobs configurable via the existing Admin UI.
- Inject Immich's named-face data — i.e. faces a user has manually named in Immich's face-recognition UI — into descriptions so they become identity-aware. The system never invents or auto-infers names; it only surfaces names already curated by users.
- Ship a curated set of built-in smart auto-albums that consume tags + CLIP signal.
- Keep the existing JSON-schema contract intact so the NSFW/medical post-processing pipeline doesn't break.
- System-wide configuration (not per-user) for prompt and triggers; smart-album *contents* are per-user.

## Non-Goals (v1)

- External VLM providers (OpenAI, Anthropic, hosted services).
- User-defined custom smart-album kinds beyond the six built-ins.
- Per-user prompt overrides.
- Automatic re-description of all historical assets at upgrade time (admin opt-in only).
- Custom permissions / sharing semantics for smart albums (inherit existing album behavior).

## Architecture: Approach A — Server-driven, dumb ML

Server assembles the prompt from SystemConfig per request, sends `{image, prompt, vocabulary}` to the ML service, ML returns raw JSON, server validates / normalizes / applies smart-album rules.

Rationale: matches Immich's existing pattern (config in server's `SystemConfig`, ML stateless), avoids two sources of truth, keeps the ML service independently deployable, and the per-request prompt payload (~2KB) is negligible vs. the image.

Rejected alternatives:

- **Stateful ML with its own config** — two sources of truth, drift risk, harder rollback.
- **Built-in ML profiles with server overrides** — couples server↔ML versions.

## Component design

### 1. Config schema additions

Under `machineLearning.imageDescription` in `server/src/config.ts`:

```typescript
imageDescription: {
  // existing fields preserved
  enabled: boolean;
  acceleration: MachineLearningHardwareAcceleration;
  modelName: string;
  fallbackModelName: string;
  device: string;

  // NEW: structured prompt config
  prompt: {
    style: 'terse' | 'balanced' | 'rich';      // default 'balanced'
    sentenceCountTarget: number;               // default 3, range 1-6
    lookFor: string[];                         // e.g. ['brands', 'sports equipment']
    customVocabulary: string[];                // e.g. ['prescription-bottle']
    nsfwIndicators: string[];                  // editable allow-list; defaults to current NSFW_TAGS
    medicalIndicators: string[];               // editable allow-list; defaults to current MEDICAL_TAGS
    forbiddenInferences: string[];             // e.g. ['diagnoses', 'medication names']
    identityInjection: {
      enabled: boolean;                        // default true
      maxNames: number;                        // default 5
      minFaceConfidence: number;               // default 0.7
    };
    advanced: {
      enabled: boolean;                        // default false
      rawPromptTemplate: string;               // must include {schema} when validation strict
      placeholderValidation: 'strict' | 'warn';
    };
  };
}
```

New top-level block:

```typescript
smartAlbums: {
  enabled: boolean;
  builtIn: {
    travel:      { enabled: boolean; name: string; tagTriggers: string[]; clipQueries: string[]; threshold: number };
    documents:   { enabled: boolean; name: string; tagTriggers: string[]; clipQueries: string[]; threshold: number };
    screenshots: { enabled: boolean; name: string; tagTriggers: string[]; clipQueries: string[]; threshold: number };
    food:        { enabled: boolean; name: string; tagTriggers: string[]; clipQueries: string[]; threshold: number };
    pets:        { enabled: boolean; name: string; tagTriggers: string[]; clipQueries: string[]; threshold: number };
    nature:      { enabled: boolean; name: string; tagTriggers: string[]; clipQueries: string[]; threshold: number };
  };
}
```

Defaults preserve current behavior: prompt config defaults reproduce the hard-coded `IMAGE_DESCRIPTION_PROMPT`, NSFW/medical indicator lists default to the current Python constants.

Default smart-album triggers:

| Kind         | Default tag triggers                                                                | Default CLIP queries                                  |
| ------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Travel       | airport, beach, mountain, landmark, hotel, passport, suitcase, tourist              | "vacation travel landscape", "tourist destination"    |
| Documents    | receipt, document, invoice, paperwork, scan, id-card                                | "paper document", "receipt or invoice"                |
| Screenshots  | screenshot, ui, screen-capture, user-interface                                      | "phone or computer screenshot"                        |
| Food         | food, meal, dish, restaurant, plate, cooking                                        | "plated food meal", "restaurant dish"                 |
| Pets         | pet, dog, cat, puppy, kitten                                                        | "domestic pet animal"                                 |
| Nature       | nature, forest, mountain, ocean, sunset, wildlife, flower                           | "natural landscape", "wildlife"                       |

Default threshold: 0.28 (cosine similarity on CLIP embeddings). Tunable per album.

### 2. Prompt assembler service

New `ImageDescriptionPromptAssembler` in the server. Single public method:

```typescript
build(input: {
  config: ImageDescriptionConfig['prompt'];
  knownPersons: { name: string; faceConfidence: number; boxCenter: [number, number] }[];
}): { prompt: string; expectedSchemaVersion: string }
```

Assembly order when `advanced.enabled === false`:

1. **Role line** — unchanged from today.
2. **Identity hint** — only when `identityInjection.enabled` and at least one known person survives `minFaceConfidence`. Format:
   ```
   Known people detected in this image (use these names when describing them; do not invent names):
   - Conner (top-left area)
   - Sarah (center)
   ```
   Position derived from face-box centroid bucketed to a 3×3 grid label.
3. **Style hint** — derived from `style` and `sentenceCountTarget`:
   - terse → one factual sentence
   - balanced → 2–3 sentences capturing subject/activity/environment/objects
   - rich → 3–5 sentences capturing mood, season/time-of-day if visible, plus the balanced fields
4. **Look-for hint** — only when `lookFor` non-empty: `"When relevant and visibly supported, note: <list>."`
5. **Vocabulary hint** — only when `customVocabulary` non-empty: `"Prefer these tag values when applicable: <list>."`
6. **Fixed JSON schema** — identical to today's `description / people / environment / objects / visible_text / context / tags / safety / medical` shape. Always emitted so post-processing keeps working.
7. **Safety / medical rule blocks** — assembled from `nsfwIndicators` / `medicalIndicators` / `forbiddenInferences` lists.
8. **Standard rules** — JSON-only, no markdown, factual, "avoid moralizing language."

Advanced mode (`advanced.enabled === true`): server substitutes `{names}`, `{schema}`, `{vocabulary}`, `{style_hint}` placeholders in `rawPromptTemplate`. `placeholderValidation: 'strict'` rejects save when `{schema}` is missing; `'warn'` saves with a UI flag.

### 3. Identity post-validator service

New `IdentityPostValidator`:

```typescript
validate(description: string, knownPersons: KnownPerson[]): {
  description: string;
  flags: { hallucinatedNames?: string[]; ambiguousReferences?: string[] };
}
```

Rules:

- Any name in the description not present in `knownPersons` → strip and replace with "someone" (model hallucination).
- If description contains a generic person reference (`"a young boy"`, `"a woman"`, etc.) AND zero names AND exactly one known person matches the demographic by face-box position → substitute the name.
- Multi-person ambiguity (multiple known persons, no name in description) → leave generic; record `multi-person-ambiguous` flag in metadata.
- The post-validator only deletes or substitutes from the known-persons list — never fabricates.

### 4. Smart album service

New `SmartAlbumService` invoked from `image-enrichment.service.ts` after a successful description.

Data model:

```sql
-- New table: one row per smart album per user
smart_album {
  id          uuid PRIMARY KEY,
  kind        text NOT NULL,            -- 'travel' | 'documents' | ...
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  album_id    uuid NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, kind)
}

-- Asset membership in smart albums (mirrored to the backing album for browsing)
smart_album_asset {
  smart_album_id  uuid NOT NULL REFERENCES smart_album(id) ON DELETE CASCADE,
  asset_id        uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  added_at        timestamptz NOT NULL DEFAULT now(),
  match_reason    text NOT NULL,        -- 'tag' | 'clip' | 'both'
  PRIMARY KEY (smart_album_id, asset_id)
}

-- User overrides: assets explicitly excluded from a smart album
smart_album_exclusion {
  smart_album_id  uuid NOT NULL REFERENCES smart_album(id) ON DELETE CASCADE,
  asset_id        uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  PRIMARY KEY (smart_album_id, asset_id)
}
```

Smart albums back onto regular albums so all existing UI (browsing, sharing, slideshow, download) works for free.

Evaluation flow when a description completes:

1. For each enabled `kind`:
   - If `tagTriggers ∩ asset_tags` non-empty → match with `reason='tag'`.
   - Else compute cosine sim between asset's CLIP embedding and each `clipQueries[i]` embedding; if max ≥ `threshold` → match with `reason='clip'`.
2. Skip if `(smart_album_id, asset_id)` exists in `smart_album_exclusion`.
3. Insert into `smart_album_asset` and mirror into `album_asset`.
4. On re-description, removes from smart albums where match no longer holds.

Triggering:

- **Per-asset evaluation** runs automatically when description completes.
- **Bulk re-evaluation** triggered by changes to `smartAlbums.*` config (separate job — no ML inference needed).
- **Re-description** triggers fresh per-asset evaluation as a side effect.

### 5. ML repository / Python changes

`server/src/repositories/machine-learning.repository.ts:325` `describeImage` gains:
- `prompt: string` parameter (the assembled prompt)
- `vocabulary?: string[]` parameter (for downstream tag normalization)

Python `machine-learning/immich_ml/models/image_description.py`:
- `_make_prompt` accepts an `external_prompt: str | None`. When provided, uses it verbatim; otherwise falls back to the hard-coded `IMAGE_DESCRIPTION_PROMPT` (preserves backward compatibility).
- Florence-2 path keeps its current task-based behavior. When config has `prompt.*` overrides set AND Florence is the active model, server skips prompt assembly and shows a UI notice indicating customization is inactive.

### 6. Admin UI

Tabbed expansion of the existing Machine Learning settings card under Admin → Settings → Machine Learning.

**Tab 1: Model**
- Existing model fields (acceleration, modelName, fallbackModelName, device).
- Inline guidance copy per model option (quality / speed tradeoffs).
- Warning banner when Florence-2 is selected, explaining prompt customization is inactive.

**Tab 2: Prompt & Vocabulary**
- Style radio (terse / balanced / rich) with sample preview.
- Sentence count target input (1–6).
- "Look for" chip input, pre-populated with common categories.
- Custom tag vocabulary chip input.
- Collapsed NSFW / medical / forbidden-inference editors with reset-to-defaults.
- Identity injection: toggle, max-names slider, min-confidence slider.
- Advanced: raw prompt accordion. When expanded, a textarea prefilled with the assembled prompt, placeholder reference panel (`{names}`, `{schema}`, `{vocabulary}`, `{style_hint}`), validation mode toggle, live preview against a sample asset.

**Tab 3: Smart Albums**
- Master enabled toggle.
- One card per built-in kind: enable toggle, album name, tag-triggers chip input, CLIP queries chip input (with "Test query" button showing top-10 matches), threshold slider, reset button.
- "Re-evaluate all assets against current rules" button (matching only, not re-description).

**Tab 4: Status & Regeneration**
- Stats panel (total assets, with descriptions, pending, last config change).
- "Re-queue all descriptions" button → cost-estimate modal.
- Per-album re-evaluation buttons.
- "Re-queue later" banner appears when config has changed since last full re-queue.

Save behavior: on save, server diffs old vs new config. If `prompt.*` or `imageDescription.modelName` changed, the cost-estimate modal is shown *before* committing.

### 7. Cost-estimate modal

Triggered on save when description-affecting config changed. Shows:

- Total assets, assets with descriptions, assets without.
- Active backend and model.
- Estimated time = `pendingCount × rollingAvgSeconds(lastN=1000)` from existing job-stats.
- Model-change banner when relevant (e.g., "Switching to 7B — expect roughly 2× per-asset time").
- Three actions: Re-queue now / Re-queue later / Cancel save.

### 8. Regeneration job pipeline

- Reuses the existing `imageDescription` queue.
- New `RequeueDescriptionsJob` enumerates eligible assets — defined as assets whose `metadata.description.status` is `'success'` or null (i.e., not in an in-flight `processing` state) — and batches them at low priority so newly-uploaded assets aren't starved.
- Each enqueued job carries a `configVersion: number`. In-flight jobs complete with the config they were queued under.
- Asset description metadata gains a `configVersion` field for diagnostics ("generated with config v3").
- Resumability on restart: queue handles persistence; daemon resumes pending jobs.
- Existing per-asset lock at `server/src/services/image-enrichment.service.ts:427` prevents races with manual NSFW review and other per-asset actions.

## Migration plan

1. Kysely migration adds `smart_album`, `smart_album_asset`, `smart_album_exclusion` tables.
2. SystemConfig defaults extended with `imageDescription.prompt.*` and `smartAlbums.*`. Defaults reproduce current behavior verbatim.
3. On startup, for each user without smart albums, create the six built-in album rows (idempotent). Albums start empty; lazy population.
4. No automatic re-description on upgrade. Existing descriptions keep their state. Admin opts in via the Re-queue button.

## Testing strategy

| Layer                              | Coverage                                                                                                                                | Location                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Python ML                          | external prompt parameter accepted; fallback to bundled constant; Florence path ignores prompt gracefully                                | `machine-learning/immich_ml/models/test_image_description.py`                  |
| Prompt assembler                   | all structured-field permutations; advanced-mode `{schema}` validation; identity hint formatting for 0/1/many known persons             | `server/src/services/prompt-assembler.service.spec.ts` (new)                   |
| Identity post-validator            | hallucinated names stripped; unambiguous substitution; multi-person ambiguity flagged; no fabrication                                   | `server/src/services/identity-post-validator.service.spec.ts` (new)            |
| Smart album service                | tag triggers; CLIP threshold; exclusions; removal on re-description; idempotency                                                        | `server/src/services/smart-album.service.spec.ts` (new)                        |
| Image-enrichment integration       | end-to-end: config change → cost estimate → re-queue → ML call with assembled prompt → result validation → tags → smart album updates    | extend `server/src/services/image-enrichment.service.spec.ts`                  |
| Regeneration job                   | resumability across restart; configVersion mid-flight handling; lock contention with manual review                                       | new spec file                                                                  |
| Medium tests                       | real DB, real config, mocked ML. Migrations, smart album population end-to-end, re-evaluation job                                       | `server/test/medium/specs/smart-album.spec.ts` (new)                           |
| Web                                | tabbed UI rendering; structured-field validation; advanced-editor warnings; cost-estimate modal shows on prompt change; smart album test-query | extend existing files under `web/src/lib/components/admin-page/settings/machine-learning/` |

## Rollout phasing

| PR  | Scope                                                                                                          | Risk   |
| --- | -------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Python: external prompt parameter, backward-compatible default                                                 | Low    |
| 2   | Server: prompt assembler service + plumb new param through ML repo. Still uses hard-coded prompt content       | Low    |
| 3   | Config schema additions + structured-field assembly. Defaults reproduce current prompt verbatim                | Low    |
| 4   | Admin UI tabs 1 + 2 (Model + Prompt & Vocabulary). Cost-estimate modal. Re-queue jobs with `configVersion`     | Medium |
| 5   | Identity injection (server-side face lookup + post-validator)                                                  | Medium |
| 6   | Schema migrations + `smart_album` tables + `SmartAlbumService` populating from descriptions. No UI yet         | Medium |
| 7   | Admin UI tab 3 (Smart Albums) + bulk re-evaluation job + frontend smart-album browsing entry points            | Medium |
| 8   | Admin UI tab 4 (Status & Regeneration) + persistent "re-queue later" banner                                    | Low    |

## Open questions

None at design time. Areas to revisit during implementation:

- Whether the 3×3 face-box position bucket is the right granularity for the identity hint (could be 2×2 or named regions like "foreground / background").
- Default CLIP similarity threshold of 0.28 — may need per-album tuning based on real-world signal.
- Whether to expose CLIP query embeddings as a cached field on the config row vs. recomputing on each re-evaluation.

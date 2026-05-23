# Configurable Descriptions, Identity, and Smart Albums

This page documents three connected features that build on top of [Image Enrichment](./image-enrichment.md):

1. **Configurable description prompt** — admin controls for the vocabulary, length, and tone of generated descriptions.
2. **Identity injection** — pulls named faces from facial recognition into the description prompt so descriptions can say _"Conner playing baseball"_ instead of _"a young boy playing baseball"_.
3. **Smart auto-albums** — six built-in albums (Travel, Documents & Receipts, Screenshots, Food, Pets, Nature) that automatically gather assets based on the tags generated for each description.

All three features are admin-only and run locally. They are disabled by default and need explicit enablement.

> [!IMPORTANT]
> Only the **Qwen2.5-VL** and **Phi-3.5-vision / Phi-3-vision** models honor the configurable prompt. Florence-2 is a caption-only fallback that ignores prompt customization, identity injection, and vocabulary controls. The admin UI surfaces a banner when a Florence model is selected.

---

## Prerequisites

Before you start:

- [Image Enrichment](./image-enrichment.md) is enabled and at least the description pipeline is working end-to-end for new uploads.
- Machine-learning hardware is configured — see [ML Hardware Acceleration](./ml-hardware-acceleration.md).
- The selected description model is a Qwen2.5-VL or Phi-3.5-vision build (not Florence).
- For identity injection: [Facial Recognition](./facial-recognition.md) is enabled and you have named at least some recognized faces.

---

## Basic Setup

The defaults are tuned to be useful out of the box. The minimum-clicks path is:

### Step 1 — Confirm the description model

Navigate to **Administration → System Settings → Machine Learning → Image Description**.

- **Enable image description generation** — confirm it is on.
- **Model name** — confirm it is set to `Qwen/Qwen2.5-VL-3B-Instruct` (default) or one of the larger Qwen / Phi-3.5-vision variants. If it is set to `microsoft/Florence-2-base-ft`, change it before continuing — Florence does not support the rest of this feature set.
- **Hardware acceleration** — leave at `AUTO` unless you need to pin a device.

Click **Save**.

### Step 2 — Turn on identity injection (optional)

Still inside Image Description, expand the **Prompt** accordion, then **Identity Injection**.

- **Enable identity injection** — on.
- **Max names** — default 5, fine.
- **Min face confidence** — default 0.7, fine.

Click **Save**. Re-queue any individual asset (from the asset detail panel) or run a full re-queue (Step 4) to apply the new behavior.

### Step 3 — Turn on smart albums

Navigate to **Administration → System Settings → Smart Albums**.

- **Enable smart albums** — on.

Click **Save**.

The six built-in albums (Travel, Documents & Receipts, Screenshots, Food, Pets, Nature) are created automatically for every active user the first time you enable this. They will start populating as new image descriptions complete.

### Step 4 — Backfill the existing library

Inside **Image Description → Status & Re-generation**, you'll see:

- **Total eligible image assets** — every image the description pipeline could process.
- **Already described** — image assets with a stored description.
- **Pending re-description** — assets without one.
- **Estimated re-queue time** — a real wall-clock estimate computed from the most recent 100 completed description jobs.

Click **Re-queue all descriptions** to populate descriptions for the rest of your library. A modal confirms the count and estimated time; click **Re-queue** to start.

Once descriptions populate, the smart-album evaluator runs on each completed description and assigns assets to matching albums.

### Step 5 — Re-evaluate smart albums against the existing library (one-time)

If you enabled smart albums **after** descriptions were already populated, click **Re-evaluate all assets** at the bottom of the Smart Albums settings. This walks every described image and applies the current tag rules.

You can also click **Re-evaluate this album** inside any single kind's accordion to re-run that album only.

---

## Advanced Setup

This section covers per-control tuning, prompt examples for different library types, and the operational details around re-queue and per-kind re-evaluation.

### Description prompt controls

The **Prompt** accordion inside Image Description exposes the following:

| Control                                | What it does                                                                                                                                                                       | Default                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Description style**                  | Length preset. `terse` ≈ one sentence, `balanced` ≈ a short paragraph, `rich` ≈ longer paragraph.                                                                                  | balanced                                                       |
| **Sentence count target**              | Target sentence count (1–6). Soft target, the model occasionally goes over by one.                                                                                                 | 3                                                              |
| **Look for**                           | Additional categories the model should call out when visibly present. Default includes `brands, signage, screens, documents, uniforms, tools, vehicles, animals, food, landmarks`. | 10 items                                                       |
| **Custom vocabulary**                  | Domain words the model should prefer when assigning tags. Empty by default.                                                                                                        | _empty_                                                        |
| **Forbidden inferences**               | Categories the model must NOT infer even when suggestive content is visible (e.g. medical diagnoses).                                                                              | diagnoses, medication names, procedures, pregnancy, disability |
| **NSFW indicators** (sub-accordion)    | Allow-list of explicit terms permitted in NSFW descriptions. Clear and save to restore defaults.                                                                                   | 11 default terms                                               |
| **Medical indicators** (sub-accordion) | Allow-list of medical terms permitted in descriptions.                                                                                                                             | 19 default terms                                               |
| **Identity injection** (sub-accordion) | Toggle, max-names cap, min-confidence threshold.                                                                                                                                   | enabled, 5, 0.7                                                |
| **Advanced** (sub-accordion)           | Raw prompt-template override with strict/warn placeholder validation.                                                                                                              | disabled                                                       |

> [!NOTE]
> List-type fields (Look for, Custom vocabulary, NSFW / Medical indicators, Forbidden inferences) use newline-delimited values. One entry per line.

### Prompt examples by library type

#### Family photographer

Best with **balanced** or **rich** style and identity injection ON.

- **Look for**: add `birthday cake, sparklers, candles, prom, graduation, recital, soccer ball, baseball glove`
- **Custom vocabulary**: add `golden hour, overcast, dappled light, backyard, park, beach`

Expected description shape: _"Conner playing baseball in golden hour at a suburban park. He is wearing a red jersey and is mid-swing at home plate."_

#### Document and receipt management

Best with **terse** style, identity injection OFF, low custom vocabulary.

- **Look for**: add `total amount, store name, line items, payment method, invoice number, due date, dosage, expiry date, account number, signature line`
- **Forbidden inferences**: append `account numbers verbatim, full credit card numbers, social security numbers`

Expected shape: _"Whole Foods grocery receipt totaling $47.83 dated March 15 with 6 line items."_

#### Travel library

Best with **balanced** style, identity injection ON.

- **Look for**: add `mountain range, beach, hotel lobby, train station, food market, street scene, landmark`
- **Custom vocabulary**: add the landmarks and cities you visit often — `Eiffel Tower, Banff, Tokyo Tower, Big Ben, Cinque Terre, Iceland`

Expected shape: _"Sarah standing at the base of the Eiffel Tower at dusk. Tourists are gathered on the lawn."_

#### Pet-heavy library

Best with **terse** or **balanced** style.

- **Look for**: add `breed, leash, food bowl, harness, fetch, asleep, swimming, kennel`
- **Custom vocabulary**: add the breeds you have — `golden retriever, husky, tabby, bengal, ragdoll`

Expected shape: _"A golden retriever asleep on a sunny patch of hardwood floor."_

#### Hobbyist / creative library

Use the **Custom vocabulary** to teach the model your hobby's nouns. Examples:

- **Photography**: `long exposure, golden hour, leading lines, depth of field, bokeh, focal length`
- **Cooking**: `latte art, charcuterie, sourdough, mise en place, plating, garnish`
- **Cycling**: `road bike, gravel, cassette, derailleur, peloton, kit`

### Identity injection — tuning and limits

Identity injection pulls named recognized faces from Immich's facial-recognition pipeline into the description prompt.

- **Min face confidence** (default 0.7) filters out low-confidence face matches before injection. Raise to 0.8 if you see misidentifications leak through; lower to 0.6 if you see correctly-named faces failing to surface.
- **Max names** (default 5) caps how many recognized people are passed in a single prompt. Reduce to 1–2 for crowd photos where you only want the central subjects.
- The post-validator strips proper nouns from the description that don't match any known person on the asset. It substitutes `"Someone"` for hallucinated names. This is automatic and cannot be disabled.
- The validator allow-lists day names (Monday), month names (December), holiday names (Christmas), and well-known geography (America, Paris). If you see legitimate words being stripped, either add them as recognized people, or add them to the raw template's protected list via Advanced.

### Advanced prompt template (raw override)

The Advanced sub-accordion exposes the raw template Immich would otherwise build from the structured controls.

> [!CAUTION]
> Most users should not enable this. The structured controls (style, vocabulary, look-for, indicators) compose into the same template at runtime, with safer defaults. Use raw mode only when you need something the structured controls can't express.

When enabled, four placeholders are supported in the template:

- `{names}` — the list of recognized named people from identity injection. Empty when identity injection is off or no recognized faces are present.
- `{schema}` — the structured JSON schema the model is expected to return.
- `{vocabulary}` — the merged custom-vocabulary + look-for lists.
- `{style_hint}` — the style preset's tone/length cue.

**Placeholder validation**:

- `strict` — save fails if any of the four placeholders is missing from the template.
- `warn` — save succeeds but the admin sees a warning banner.

If you mis-build the template, generated descriptions will be empty or malformed. Switch the toggle off to restore the structured-controls template; your raw template text is preserved for next time.

### Smart-album tag tuning

Each of the six built-in albums has an independent tag-trigger list and a confidence threshold.

| Album                | Default triggers                                                       | Default threshold |
| -------------------- | ---------------------------------------------------------------------- | ----------------- |
| Travel               | airport, beach, mountain, landmark, hotel, passport, suitcase, tourist | 0.28              |
| Documents & Receipts | receipt, document, invoice, paperwork, scan, id-card                   | 0.28              |
| Screenshots          | screenshot, ui, screen-capture, user-interface                         | 0.28              |
| Food                 | food, meal, dish, restaurant, plate, cooking                           | 0.28              |
| Pets                 | pet, dog, cat, puppy, kitten                                           | 0.28              |
| Nature               | nature, forest, mountain, ocean, sunset, wildlife, flower              | 0.28              |

**Recommended additions** for richer libraries (add one per line in the Tag triggers textarea):

- **Travel**: `boarding pass, train station, hostel, market, temple, cathedral` plus specific landmark and city names you photograph often (lowercased).
- **Documents & Receipts**: `prescription, manual, warranty, schedule, ticket-stub, identity-card, license`
- **Screenshots**: `dashboard, browser, app-window, terminal, code`
- **Food**: specific cuisines (`sushi, pizza, taco, ramen`) and dishes you photograph (`latte-art, charcuterie, bbq`)
- **Pets**: breeds you have (`golden-retriever, husky, tabby, bengal`) and other pets (`rabbit, ferret, parakeet, guinea-pig`)
- **Nature**: specific subjects (`waterfall, glacier, wildflower, autumn-foliage, milky-way, aurora`)

**Tag matching is case-insensitive.** Hyphenated forms (`golden-retriever`) and space-separated forms (`golden retriever`) both work — the matcher normalizes on save.

**Threshold tuning**: start at the default `0.28`. Move to `0.25` if albums look sparse, or to `0.32` if they're noisy. Useful range is 0.2–0.4.

### CLIP queries (reserved)

Each smart-album kind also has a **CLIP queries** textarea. The lines you save here are **reserved for a future release** where semantic CLIP similarity will be used in addition to tag triggers. They are not currently applied to album population. Leave the defaults or add candidates for your library — they will activate automatically when the matching infrastructure ships.

### Status & Re-generation panel

Inside Image Description → Status & Re-generation:

- **Last config change** — server-side timestamp updated when any field of the description config changes (excluding the two timestamp fields themselves, so saving with no real change does not advance it).
- **Pending re-queue scheduled** — set when you click "Re-queue later" in the cost modal; cleared automatically when the re-queue job dispatches.
- **Total eligible image assets** — every image the description pipeline can process.
- **Already described** — image assets with a stored description.
- **Pending re-description** — assets without a stored description.
- **Estimated re-queue time** — a real wall-clock estimate computed from the rolling mean of the most recent 100 completed image-description jobs. Falls back to a 1.5 s per asset default until the first jobs complete after a server restart.

### Re-queue: Now vs. Later

The cost modal has three buttons:

- **Cancel** — close, no action.
- **Re-queue later** — set `pendingRequeueAt` on the config. A persistent banner appears at the top of the Image Description settings reminding you to act. Useful when you're making several prompt edits in a single session and want to run the actual re-queue once at the end.
- **Re-queue** — dispatch the re-queue job immediately. Idempotent via BullMQ deduplication — clicking twice while a job is in flight returns _"already in flight"_ instead of duplicating work.

When you click **Re-queue now** from the banner, the modal opens with the latest live counts; on dispatch, `pendingRequeueAt` is cleared automatically.

### Per-kind smart-album re-evaluation

Each kind's accordion in Smart Albums settings has a **Re-evaluate this album** button. It re-runs the matcher for that kind only — assets currently in other kinds are **not** touched. Useful when you've added new tag triggers to one album and want to refresh just that album.

The page-bottom **Re-evaluate all assets** button runs every kind.

Per-kind jobs use their own BullMQ deduplication namespace (`SmartAlbumReevaluateAll:<kind>`), so you can run a per-kind re-evaluate at the same time as another kind's re-evaluate or the all-kinds run without collisions.

### Excluding an asset from a smart album

From the album view, open an asset and choose **Exclude from smart album** in the action menu. The exclusion is permanent until manually reversed and survives every re-evaluation, including forced ones. Use this for assets that match a tag trigger but don't belong (e.g. a photo of a pet at the beach that you only want in Pets, not Travel).

---

## Troubleshooting

### Descriptions are still generic after enabling identity injection

Check, in order:

1. The asset has at least one named recognized face. Open the asset, expand the People list, confirm names are attached.
2. The face's recognition confidence is above your **Min face confidence** threshold (default 0.7).
3. Your model is Qwen or Phi (Florence ignores all prompt customization).
4. Re-queue the asset — either re-run from the asset detail panel (`Rerun image descriptions and tags`) or run a full library re-queue.

### A smart album never populates an asset

Check, in order:

1. **Smart albums** are enabled in System Settings.
2. The specific **kind** is enabled (each accordion has its own toggle).
3. The asset has a completed description (not still pending).
4. The asset's stored tags contain one of the kind's **Tag triggers** (case-insensitive). Open the asset detail panel and look at the tags list.
5. The matching tag's confidence is at or above the kind's **Tag threshold**.
6. The asset is not on the kind's **exclusion list** (Excluded from smart album).

### An album has unwanted assets

- For one-off removal, use **Exclude from smart album** from the asset action menu.
- For systematic noise, tighten the kind's **Tag triggers** list to remove the offending tag, then click **Re-evaluate this album**.

### The persistent banner won't go away

The banner is gated on `pendingRequeueAt`. It clears when the re-queue job dispatches. If the job fails silently (check `Administration → Jobs`), the timestamp may still be set. Clicking **Re-queue now** from the banner will re-dispatch and clear the timestamp on success.

### "Estimated re-queue time" is wildly off

After a restart, the rolling average is empty until 100 description jobs complete. The 1.5 s default is conservative for OpenVINO Qwen2.5-VL on a typical Intel iGPU. Once the rolling average kicks in, the estimate converges within roughly the next 100 jobs.

### The post-validator stripped a legitimate name

The validator's allow-list covers day, month, holiday, and well-known geography names. If your description mentions a friend who isn't in your face library, the validator will replace the name with `"Someone"`. Either:

- Add the person as a named face on the asset (and re-queue), or
- Edit the description manually after generation.

The validator does not currently support a free-form personal allow-list. This is tracked as a future enhancement.

---

## Model selection guidance

| Hardware              | Recommended model                      | Notes                                                                                           |
| --------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 16 GB+ VRAM NVIDIA    | `Qwen/Qwen2.5-VL-7B-Instruct`          | Best quality                                                                                    |
| 6–12 GB NVIDIA        | `Qwen/Qwen2.5-VL-3B-Instruct`          | Default; good balance                                                                           |
| Intel iGPU (OpenVINO) | `Qwen/Qwen2.5-VL-3B-Instruct`          | Resolves internally to `llmware/qwen2.5-vl-3b-ov`                                               |
| CPU or small iGPU     | `microsoft/Phi-3.5-vision-instruct`    | Lighter, still honors the prompt                                                                |
| Older Phi build       | `microsoft/Phi-3-vision-128k-instruct` | Smaller, slightly lower quality                                                                 |
| Last-resort fallback  | `microsoft/Florence-2-base-ft`         | **Caption only** — ignores prompt customization, identity injection, vocabulary, and indicators |

Florence-2 still produces a usable caption, so you can use it as a CPU-friendly fallback when no other hardware is available — just understand the configurable parts of this page have no effect under Florence.

---

## Related reading

- [Image Enrichment](./image-enrichment.md) — the underlying description and NSFW pipeline.
- [Facial Recognition](./facial-recognition.md) — required for identity injection.
- [ML Hardware Acceleration](./ml-hardware-acceleration.md) — picking the right hardware profile.
- [Tags](./tags.md) — how the generated tags interact with the rest of Immich.

# Configurable Descriptions, Identity, Videos, and Smart Albums

This page documents the connected features that build on top of [Image Enrichment](./image-enrichment.md):

1. **Configurable description prompt** — admin controls for the vocabulary, length, tone, and free-form guidance of generated descriptions.
2. **Identity injection** — pulls named faces from facial recognition into the description prompt so descriptions say _"Kelly and Connor playing baseball"_ instead of _"a family playing baseball"_.
3. **Custom instructions** — a free-form text field for natural-language guidance like _"if you see a car, identify the make and model"_ — without rewriting the whole prompt.
4. **Video descriptions** — generate descriptions and tags for videos by stitching multiple sampled frames into a composite grid the vision-language model can see all at once.
5. **Smart auto-albums** — six built-in albums (Travel, Documents & Receipts, Screenshots, Food, Pets, Nature) that automatically gather assets based on the tags generated for each description.

All features are admin-only and run locally. They are disabled by default and need explicit enablement.

> [!IMPORTANT]
> Only the **Qwen2.5-VL** and **Phi-3.5-vision / Phi-3-vision** models honor the configurable prompt. Florence-2 is a caption-only fallback that ignores prompt customization, identity injection, and vocabulary controls. The admin UI surfaces a banner when a Florence model is selected.

---

## Prerequisites

Before you start:

- [Image Enrichment](./image-enrichment.md) is enabled and at least the description pipeline is working end-to-end for new uploads.
- Machine-learning hardware is configured — see [ML Hardware Acceleration](./ml-hardware-acceleration.md).
- The selected description model is a Qwen2.5-VL or Phi-3.5-vision build (not Florence).
- For identity injection: [Facial Recognition](./facial-recognition.md) is enabled and you have named at least some recognized faces.
- For video descriptions: **Enhanced video duplicate detection** is enabled and has already run on your videos (see [Recommended setup order](#recommended-setup-order) — videos without frames are skipped).

---

## Recommended setup order

The features interact. Doing them in the order below gets the best output the first time and avoids re-queueing the library multiple times.

| #   | Step                                                                                          | Why this order                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Pick the right model** (Qwen2.5-VL or Phi-3.5-vision).                                      | Florence-2 ignores _every other_ control on this page. Get the model right before you tune anything.                                                                                        |
| 2   | **Run [Facial Recognition](./facial-recognition.md) and name your most-photographed people.** | Identity injection only mentions names you've curated. Doing this first means your very first description run already says "Kelly" instead of "Someone".                                    |
| 3   | **Enable Enhanced Video Duplicate Detection** and let it process your videos.                 | Video descriptions reuse the frames it extracts — there's no point asking for video descriptions before frames exist. Frame extraction can take hours on large libraries; start it earlier. |
| 4   | **Tune the description prompt** (style, look-for, custom vocabulary, custom instructions).    | Tuning before the first big re-queue means you don't pay to re-describe everything twice.                                                                                                   |
| 5   | **Enable identity injection.**                                                                | Cheap to toggle and tune; combine with the prompt tuning in step 4 before the big run.                                                                                                      |
| 6   | **Re-queue all descriptions.**                                                                | One library-wide pass with everything configured the way you want it.                                                                                                                       |
| 7   | **Enable smart albums** and let the evaluator run as descriptions complete.                   | Albums are populated from description tags; they're useless without descriptions first.                                                                                                     |
| 8   | **Re-evaluate smart albums** once descriptions are done.                                      | One-time backfill so older assets get pulled into the new albums.                                                                                                                           |

If you've already deployed without following this order, that's fine — you can run [Step 6: Backfill the existing library](#step-6--backfill-the-existing-library) again at any time, and there's a per-album re-evaluate for smart albums.

---

## Basic Setup

The defaults are tuned to be useful out of the box. The minimum-clicks path is:

### Step 1 — Confirm the description model

Navigate to **Administration → System Settings → Machine Learning → Image Description**.

- **Enable image description generation** — confirm it is on.
- **Model name** — pick from the curated dropdown. Defaults to `Qwen/Qwen2.5-VL-3B-Instruct`, with Qwen 7B and Phi-3.5-vision available for stronger hardware. If you see Florence-2 listed as the fallback model that's fine — just don't pick it as the primary unless you accept the trade-offs described in [Model selection guidance](#model-selection-guidance).
- **Hardware acceleration** — leave at `AUTO` unless you need to pin a device.

Click **Save**.

### Step 2 — Turn on identity injection (optional but strongly recommended)

Still inside Image Description, expand the **Prompt** accordion, then **Identity Injection**.

- **Enable identity injection** — on.
- **Max names** — default 5, fine for family photos. Raise to 10–15 if you photograph large groups (sports teams, weddings) and want everyone named.
- **Min face confidence** — default 0.7, fine.

Click **Save**. Re-queue any individual asset (from the asset detail panel) or run a full re-queue (Step 6) to apply the new behavior.

> [!NOTE]
> The prompt explicitly requires the model to name every recognized person and forbids generic group nouns like _"a family"_, _"a group"_, or _"everyone"_ when names are known. If you've previously seen multi-person photos drop names, re-queue them — newer descriptions enforce naming.

### Step 3 — Enable video descriptions (optional)

Video descriptions reuse the frames already extracted for enhanced video duplicate detection. **This step requires that feature to be enabled and to have run on your videos.** See [Video descriptions — full setup](#video-descriptions--full-setup) for the dependency chain.

The short version:

1. Navigate to **Administration → System Settings → Machine Learning → Duplicate Detection → Enhanced Video Detection**.
2. Enable it. Set **Frame count** to `4` (default) or higher — more frames yield richer video descriptions but increase processing time per video.
3. Save. Frames will be extracted by the `videoDuplicateDetection` job. **Wait for it to finish** before continuing (check **Administration → Jobs**) — videos without persisted frames are skipped by the description pipeline.

Once frames exist, the Image Description pipeline will automatically process those videos when you re-queue or as new videos are uploaded.

### Step 4 — Add custom instructions for your library (optional)

Inside Image Description → **Prompt** accordion, find the **Custom instructions** textarea. This is free-form natural-language guidance — write it like you're briefing a careful assistant.

Skip if you want defaults. See [Custom instructions — examples](#custom-instructions--examples) for proven prompts.

### Step 5 — Turn on smart albums

Navigate to **Administration → System Settings → Smart Albums**.

- **Enable smart albums** — on.

Click **Save**.

The six built-in albums (Travel, Documents & Receipts, Screenshots, Food, Pets, Nature) are created automatically for every active user the first time you enable this. They will start populating as new image descriptions complete.

### Step 6 — Backfill the existing library

Inside **Image Description → Status & Re-generation**, you'll see:

- **Total eligible assets** — every image and (now) video the description pipeline can process. Videos only count when they have persisted duplicate-detection frames.
- **Already described** — assets with a stored description.
- **Pending re-description** — assets without one.
- **Estimated re-queue time** — a real wall-clock estimate computed from the most recent 100 completed description jobs.

Click **Re-queue all descriptions** to populate descriptions for the rest of your library. A modal confirms the count and estimated time; click **Re-queue** to start.

Once descriptions populate, the smart-album evaluator runs on each completed description and assigns assets to matching albums.

### Step 7 — Re-evaluate smart albums against the existing library (one-time)

If you enabled smart albums **after** descriptions were already populated, click **Re-evaluate all assets** at the bottom of the Smart Albums settings. This walks every described image and applies the current tag rules.

You can also click **Re-evaluate this album** inside any single kind's accordion to re-run that album only.

---

## Advanced Setup

This section covers per-control tuning, prompt examples for different library types, and the operational details around re-queue and per-kind re-evaluation.

### Description prompt controls

The **Prompt** accordion inside Image Description exposes the following:

| Control                                | What it does                                                                                                                                                                                                                               | Default                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| **Description style**                  | Length preset. `terse` ≈ one sentence, `balanced` ≈ a short paragraph, `rich` ≈ longer paragraph.                                                                                                                                          | balanced                                                       |
| **Sentence count target**              | Target sentence count (1–6). Soft target, the model occasionally goes over by one.                                                                                                                                                         | 3                                                              |
| **Look for**                           | Additional **category labels** the model should call out when visibly present. Tag-style. Default includes `brands, signage, screens, documents, uniforms, tools, vehicles, animals, food, landmarks`.                                     | 10 items                                                       |
| **Custom vocabulary**                  | Preferred **tag values** the model should reuse when assigning tags. One per line.                                                                                                                                                         | _empty_                                                        |
| **Custom instructions**                | Free-form **natural-language** guidance appended to the prompt. Use full sentences — e.g. _"If you see a vehicle, identify the make and model. If people are playing a sport, name the sport."_ Up to 2000 characters. See examples below. | _empty_                                                        |
| **Forbidden inferences**               | Categories the model must NOT infer even when suggestive content is visible (e.g. medical diagnoses).                                                                                                                                      | diagnoses, medication names, procedures, pregnancy, disability |
| **NSFW indicators** (sub-accordion)    | Allow-list of explicit terms permitted in NSFW descriptions. Clear and save to restore defaults.                                                                                                                                           | 11 default terms                                               |
| **Medical indicators** (sub-accordion) | Allow-list of medical terms permitted in descriptions.                                                                                                                                                                                     | 19 default terms                                               |
| **Identity injection** (sub-accordion) | Toggle, max-names cap, min-confidence threshold. When on, the prompt also _requires_ the model to name each listed person and forbids generic group nouns.                                                                                 | enabled, 5, 0.7                                                |
| **Advanced** (sub-accordion)           | Raw prompt-template override. Pre-fills with the current default template on enable. Includes a **Reset to default** button. Strict/warn placeholder validation.                                                                           | disabled                                                       |

> [!TIP]
> **Look for vs. Custom vocabulary vs. Custom instructions** — these three sound similar but do different jobs:
>
> - **Look for**: _"pay attention to these visible categories"_ (the model decides how to describe them). Tag-style entries.
> - **Custom vocabulary**: _"when you produce a tag for one of these, use exactly this spelling"_. Tag-style entries.
> - **Custom instructions**: _"follow these rules when writing the description"_. Full natural-language sentences.

> [!NOTE]
> List-type fields (Look for, Custom vocabulary, NSFW / Medical indicators, Forbidden inferences) use newline-delimited values. One entry per line.

### Custom instructions — examples

The **Custom instructions** field is the simplest way to teach the model new behavior without touching the raw template. Treat it like a short briefing memo. Write full sentences, be specific about what to do _and_ when not to, and keep it under a couple of paragraphs (hard cap: 2000 characters).

The instructions are appended to the prompt _before_ the JSON schema and rules, so the model has seen them by the time it produces output.

> [!IMPORTANT]
> Custom instructions are **ignored** when the **Advanced → Use raw prompt template** toggle is on. Advanced users own the entire prompt; they should weave instructions into the template directly. Toggle Advanced off (or pre-fill the template and paste your instructions in there) to use this field.

#### Example 1 — Identify vehicles by make and model

```
If you can clearly see a car, truck, or motorcycle, identify the make and model in
the description (e.g. "a red Tesla Model 3", not "a red car"). If you are uncertain
about either the make or the model, just say "a red car" rather than guessing.
```

**Expected effect:** descriptions of car photos become _"A red Tesla Model 3 parked in a driveway at dusk"_ instead of _"A red car parked in a driveway at dusk"_.

#### Example 2 — Name the sport being played

```
When people are clearly playing a sport, name the sport in the description (soccer,
baseball, basketball, tennis, etc.) and mention the visible equipment they're using.
Do not guess the sport from clothing alone — only from visible play, equipment, or
field markings.
```

**Expected effect:** _"Connor pitching in a baseball game, wearing a red jersey, with a baseball glove on his left hand and a baseball mid-air"_.

#### Example 3 — Always note the apparent location type for travel photos

```
When the photo is clearly outdoors and looks like travel, identify the location type:
beach, mountain, forest, city street, market, train station, airport, museum, cathedral,
temple, ruins, hotel lobby. If a recognizable landmark is visible, name it (e.g.
"Eiffel Tower", "Brooklyn Bridge"). Do not invent landmarks if you are not sure.
```

**Expected effect:** _"Sarah standing in front of the Eiffel Tower at dusk; the lawn is crowded with tourists."_

#### Example 4 — Document handling

```
When the photo is a document, receipt, or screenshot of text, transcribe the most
important visible identifiers in the description: store name, total amount, date,
invoice number, and document type. Do not transcribe full account numbers, full
credit card numbers, social security numbers, or any other sensitive personal data
even if visible — refer to them generically (e.g. "account number redacted").
```

**Expected effect:** _"Whole Foods grocery receipt dated March 15, totaling $47.83; payment method is credit card (number redacted)."_

#### Example 5 — Cooking / food blog

```
For food photos: identify the dish by name if recognizable (carbonara, ramen, pad
thai, etc.), name the cuisine if you can tell (Italian, Japanese, Thai, Mexican,
Korean), and note the plating style (rustic, fine-dining, casual, street-food). Do
not name a dish you are not confident about — say "pasta dish" rather than guessing.
```

#### Example 6 — Pet identification

```
For pets: identify the breed when you can recognize it (golden retriever, husky,
tabby, bengal, ragdoll). For dogs in particular, note the activity (sleeping,
playing fetch, swimming, on a leash, in a car). Do not guess a breed from coat
color alone.
```

#### Example 7 — Multi-rule combined

You can stack multiple rules:

```
If you see a vehicle, name the make and model when recognizable.
If people are playing a sport, name the sport and visible equipment.
For food, name the dish and the cuisine when recognizable.
Never guess — if you are not confident, use a generic description instead.
```

#### Example 8 — "Tone" guidance

```
Keep descriptions plain and factual. Do not use poetic language ("a tapestry of
colors", "bathed in golden light"). Do not editorialize about the people or events
("a joyful family", "an intimate moment"). Stick to what is visible.
```

This is especially useful when you find descriptions drifting into flowery prose.

#### Example 9 — Family library combined

A common all-in-one for a personal/family photo library:

```
Always name every recognized person and avoid generic group terms like "the family"
or "everyone".

If you see a car, name the make and model when recognizable.
If people are playing a sport, name the sport and any visible equipment.
For pets, identify the breed when recognizable.
For travel scenes, name the landmark if you are certain.

Keep descriptions factual and short. Do not use poetic language.
```

#### What custom instructions can NOT do

- **They cannot override safety rules.** The base prompt's NSFW/medical handling and the post-validator still apply.
- **They cannot override identity injection's no-hallucinate rule.** Names that aren't in the recognized-faces list for the asset are still stripped by the post-validator.
- **They cannot change the output schema.** Use Advanced mode if you need a different JSON shape.
- **They cannot make the model "remember" between assets.** Each asset is described independently.

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

**How it works under the hood:**

1. For each asset being described, Immich queries the visible named faces on that asset.
2. Faces above **Min face confidence** are taken (currently always passes — see note below), up to **Max names**.
3. Each name and its position in the frame are added to the prompt as a list:

   ```
   Identity (REQUIRED — failure to follow this is a top error):
   Known people detected in this image. You MUST refer to each of these people by
   name at least once in the description. Do NOT replace them with generic group
   nouns such as "a family", "a group", "people", "everyone", or "the kids" — use
   the listed names instead. Do not invent names not in this list.
   - Kelly (center)
   - Connor (top-left)
   - Alexa (top-right)
   - Jeremy (bottom-right)
   ```

4. The model produces a description that names each person at least once.
5. A post-validator strips any proper noun in the description that isn't in this list, replacing it with `"Someone"`.

**Why the prompt is so emphatic:** earlier versions used softer language ("use these names when describing them") and the model often collapsed multi-person photos into _"A family at the beach"_ or _"A group of children playing"_. The strengthened wording explicitly forbids those collective nouns when names are known. If you've previously seen multi-person photos drop names, re-queue them — newer descriptions will name everyone.

**Controls:**

- **Min face confidence** (default 0.7) filters out low-confidence face matches before injection. Raise to 0.8 if you see misidentifications leak through; lower to 0.6 if you see correctly-named faces failing to surface.
  - _Note: Immich's current schema doesn't store a per-face recognition score — named faces are treated as user-curated ground truth (confidence = 1.0). This control is therefore an on/off knob: setting it above 1.0 suppresses all identity hints without disabling injection. The threshold will become meaningful once per-face scores are stored._
- **Max names** (default 5) caps how many recognized people are passed in a single prompt. Reduce to 1–2 for crowd photos where you only want the central subjects. Raise to 10–15 for sports teams, weddings, and other large-group photos where you want everyone named.

**Post-validator behavior:**

- Strips proper nouns from the description that don't match any known person on the asset. Substitutes `"Someone"` for hallucinated names. Automatic and cannot be disabled.
- Allow-lists day names (Monday), month names (December), holiday names (Christmas), and well-known geography (America, Paris) so those aren't mistaken for hallucinated person names.
- **When exactly one known person is detected** and the model produces a generic reference ("the woman", "the boy") without using the name, the validator substitutes the known name automatically.
- **When multiple known persons are detected** and the model uses a generic reference, the validator flags the ambiguity in metadata but leaves the description alone — it can't know which person was meant. The strengthened prompt wording is the primary defense for this case.

**Troubleshooting:** if you see legitimate names being stripped, either add them as recognized people on the asset (and re-queue), or edit the description manually after generation. The validator doesn't currently support a free-form personal allow-list.

### Advanced prompt template (raw override)

The Advanced sub-accordion exposes the raw template Immich would otherwise build from the structured controls.

> [!CAUTION]
> Most users should not enable this. The structured controls (style, vocabulary, look-for, custom instructions, indicators) compose into the same template at runtime, with safer defaults. Use raw mode only when you need something the structured controls can't express — for example, changing the order of sections, removing rules entirely, or asking for a different JSON shape.

**Pre-fill on enable:** when you flip Advanced on for the first time, the textarea is pre-populated with the **current default template** so you have a working starting point instead of an empty box. You can edit any line, delete sections, or reorder. The pre-fill only happens when the textarea is empty — it never clobbers your existing edits.

**Reset to default:** a button below the textarea restores the canonical default template, discarding your edits. The button respects the same disabled state as the textarea.

**Supported placeholders** in the template:

- `{names}` — the list of recognized named people from identity injection (with the strengthened naming-required wording). Empty when identity injection is off or no recognized faces are present.
- `{schema}` — the structured JSON schema the model is expected to return. This placeholder is **required** under strict validation.
- `{vocabulary}` — the merged custom-vocabulary list.
- `{style_hint}` — the style preset's tone/length cue.

> [!NOTE]
> The **Custom instructions** field from the structured controls is NOT injected into raw templates. If you want that text in a raw template, paste it directly where you want it to appear. Likewise, dynamic per-asset behavior such as the **video-context prefix** (added for videos) and the **NSFW reinforcement** (added when the NSFW classifier flags an asset) are still added automatically around your template — you don't need to handle them.

**Placeholder validation:**

- `strict` — save fails if `{schema}` is missing from the template.
- `warn` — save succeeds but the admin sees a warning banner.

If you mis-build the template, generated descriptions will be empty or malformed. Switch the toggle off to restore the structured-controls template; your raw template text is preserved for next time.

**Tip:** if you only want to make small tweaks to the default, leave Advanced off and use the structured controls — they're easier to maintain. Advanced mode shines when you need _structural_ changes like a custom output schema or removing the safety/medical rules entirely (not recommended for most libraries).

---

## Video descriptions — full setup

Image descriptions and tags for **videos** work by sampling several frames from each video, compositing them into a single grid image, and feeding that grid to the same vision-language model used for images. The model sees the whole video timeline in one image and produces a single description that reflects the action across frames.

### How it works

1. **Frame extraction** (already a feature): when Enhanced Video Duplicate Detection runs, it samples N evenly-spaced frames per video and writes them to disk along with their timestamps. These frames are stored per-asset and are reused for any future processing.
2. **Grid composition** (description time): the description pipeline picks 2–9 of those frames, letterboxes each to a fixed cell size, and composites them into a single JPEG arranged left-to-right, top-to-bottom. Grid layout is automatic:

   | Frame count | Grid layout |
   | ----------- | ----------- |
   | 2           | 1×2         |
   | 3–4         | 2×2         |
   | 5–6         | 2×3         |
   | 7+          | 3×3         |

   When more than 9 frames exist, the grid evenly subsamples them.

3. **Time-aware prompt** is prepended to the description prompt:

   ```
   This image is a composite 2x2 grid of 4 frames sampled from a video of length 00:15.0.
   The grid is read left-to-right, top-to-bottom; cell timestamps in order are:
   00:01.0, 00:05.0, 00:09.0, 00:13.0.
   Treat each cell as a frame from the same video, not as separate scenes. Describe the
   overall video — its subject, activity over time, and continuity between frames — not
   each frame in isolation. When motion or change is visible across cells, mention it.
   ```

4. **Result** is stored as a normal description on the asset, with the same shape as any image description (tags, environment, etc.).
5. **Grid cleanup**: the composite JPEG is deleted after every run. The persisted duplicate-detection frames are untouched.

### Step-by-step: enable video descriptions on an existing library

1. **Confirm Enhanced Video Duplicate Detection is enabled.** Navigate to **Administration → System Settings → Machine Learning → Duplicate Detection → Enhanced Video Detection**. Toggle on if needed.
2. **Set Frame count.** Default is 4. For richer descriptions, raise to 6 or 9. Higher values mean more disk usage and slower frame extraction per video but better description quality. The grid layout adapts automatically.
3. **Save.** New video uploads will start getting frames extracted automatically.
4. **Backfill existing videos.** Navigate to **Administration → Jobs**, find the **Video Duplicate Detection** job, and click **All** to run extraction across the whole library. This can take hours on large libraries — the job streams videos and processes them in batches. Monitor progress from the Jobs page.
5. **Wait for frame extraction to complete.** You can check via SQL or via the Jobs queue depth. Videos without persisted frames are skipped by the description pipeline (see [Skipped status](#skipped-status-video-frames-unavailable)).
6. **Re-queue descriptions.** Navigate to **Administration → System Settings → Machine Learning → Image Description → Status & Re-generation**. The eligible-asset count now includes videos that have persisted frames. Click **Re-queue all descriptions**.
7. **Verify.** Open a video in the asset viewer and check the Description panel. The description should reference the video as a whole, not a single moment — e.g. _"A short clip of Connor swinging a bat in a backyard; he begins facing the camera, swings the bat to his right, and walks off-frame at the end."_

### Faces on videos

Faces detected on a video's preview thumbnail are used for identity injection on the video's description, exactly like images. The face positions describe the preview thumbnail, not the grid — but the model only needs the names list, so this works well in practice.

### Skipped status: `video-frames-unavailable`

When a video is sent through the description pipeline but has no persisted frames, the pipeline does **not** fall back to the single preview thumbnail. (Single video previews are often a black, title, or generic frame that produces worse descriptions than no description at all.) Instead, the description status is set to `skipped` with reason `video-frames-unavailable`, surfaced in the asset's description panel.

To fix:

1. Make sure Enhanced Video Duplicate Detection is enabled.
2. Run the **Video Duplicate Detection** job for that asset (or for the whole library).
3. Re-queue the description — either from the asset detail panel or via the bulk re-queue.

### Tuning frame count for description quality

The default of **4** frames is a good balance for short clips (under ~30 seconds). For different content:

| Video type                         | Suggested frame count | Why                                                                         |
| ---------------------------------- | --------------------- | --------------------------------------------------------------------------- |
| Short clips, single subject        | 4                     | Default; 2×2 grid gives the model start/middle/end without overwhelming it. |
| Medium videos with multiple scenes | 6                     | 2×3 grid captures more scene changes.                                       |
| Long videos, lots of motion        | 9                     | 3×3 grid; finer-grained timeline.                                           |
| Mostly-static videos               | 2                     | 1×2 is enough; saves disk and processing time.                              |

You change this in **Duplicate Detection → Enhanced Video Detection → Frame count**. Changing the frame count does **not** retroactively re-extract frames; existing videos keep their old frame counts until you re-run the Video Duplicate Detection job.

### Performance notes

- The composite grid is **512×512 per cell** (so a 2×2 is 1024×1024, a 3×3 is 1536×1536). This is a deliberate trade-off — larger cells preserve detail at the cost of model context length.
- The grid is **JPEG quality 85** with 4:2:0 chroma subsampling. Big enough to retain faces and identifying details, small enough to fit comfortably in VLM context.
- Description time for video assets is roughly the same as for a high-resolution image. The frame extraction (Step 4 above) is the slow part and only runs once per video.

### Why not just send N separate images?

Modern vision-language models can technically take multiple images in a single inference call, but support varies by model and runtime. Compositing into one grid:

- works with the existing single-image description endpoint without changes,
- guarantees one inference call per video (no N× cost multiplier),
- works with every model in the curated dropdown (Qwen, Phi, even Florence in fallback),
- preserves cross-frame context (the model literally sees the timeline in one view).

The trade-off is per-cell resolution. For typical Immich use, that's an acceptable cost.

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

### Multi-person descriptions still say "a family" or "a group"

If a description for an asset with 2+ named people doesn't use any of the names:

1. **Re-queue the asset.** The strengthened identity-hint wording (which explicitly forbids collective nouns) only applies to descriptions generated _after_ that change shipped. Older descriptions retain the wording from when they were generated.
2. Check that **Max names** is high enough — at least the number of recognized people on the asset. Default is 5; if you have 6 family members in the photo and Max names is 5, one will be omitted.
3. Confirm the model is Qwen or Phi. Florence ignores the prompt entirely.
4. Open the asset and check the People list — only **named** faces (with a non-empty name and not hidden) are injected. Faces detected but not named are skipped.

### Custom instructions aren't taking effect

Check, in order:

1. **Advanced (raw prompt template) is OFF.** Custom instructions are not injected in advanced mode — they're a feature of the structured prompt path. Toggle Advanced off, or paste your instructions into the raw template manually.
2. **You saved the settings.** The textarea writes to staged config; `Save` commits.
3. **You re-queued.** Existing descriptions don't change retroactively — re-run the asset (or do a full re-queue) for the new instructions to apply.
4. **The model is following the instructions.** Try simpler, more directive language. "If you see a car, identify the make and model" works better than "try to be more specific about vehicles."
5. **You haven't hit the 2000-character cap.** Save will reject longer payloads. Trim or split into two saves.

### A video has no description and shows "video-frames-unavailable"

This means the video doesn't have persisted duplicate-detection frames yet. To fix:

1. Confirm **Enhanced Video Duplicate Detection** is enabled.
2. Navigate to **Administration → Jobs** and run the **Video Duplicate Detection** job (or just the single asset's video-duplicate-frame job if you only want one fixed). Wait for it to finish.
3. Re-queue the description for the asset — either from the asset detail panel or as part of a bulk re-queue.

If frame extraction fails consistently, check that ffmpeg is working (other transcoding jobs should also be failing) and that the asset isn't corrupted.

### Video descriptions are too generic or miss key moments

Increase **Frame count** in Enhanced Video Duplicate Detection (try 6 or 9). Then re-run the Video Duplicate Detection job to re-extract frames at the new count, and re-queue the descriptions. More frames = the model sees more of the timeline.

If the description still misses what matters, consider whether the action you care about happens between the sampled timestamps. Frames are sampled evenly across the video duration; a 30-second video with frame count 4 samples at roughly 0%, 25%, 50%, 75% of the way through (with small offsets to avoid the very first and last frame).

### Advanced template box was empty / I want my default back

If you previously enabled Advanced mode before pre-fill shipped, your textarea may be blank. Either:

1. **Toggle Advanced off, then on again.** The pre-fill only triggers when the textarea is empty, so this will populate it. If your textarea already has text you want to keep, clear it first, then toggle.
2. **Click "Reset to default"** below the textarea. This explicitly overwrites the textarea with the current default template, discarding any edits.

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

## Worked example: a family photo + video library

Suppose you have ~80,000 photos and ~3,000 videos accumulated over a decade, on a single-NVIDIA-GPU server with 8 GB of VRAM. You want descriptions that name your family members, identify cars and sports, and feed smart albums for travel, food, and pets. Here's the order to set this up:

### Day 1 — Identities and frame extraction (overnight)

1. **Facial Recognition.** Enable. Run the bulk face-detection job. Wait for it to finish (typically a few hours on this library size).
2. **Name your top ~20 most-photographed people.** Don't try to name everyone — diminishing returns. The People page surfaces the most-photographed clusters first.
3. **Enhanced Video Duplicate Detection.** Enable. Frame count 6 (your videos are mostly under a minute and you want a 2×3 grid for good detail).
4. **Run the Video Duplicate Detection job** from Administration → Jobs. Leave it running overnight.

### Day 2 — Description prompt tuning

The frame extraction should be done. Verify by spot-checking a few videos in the asset viewer for a "frame thumbnail" indicator, or by checking the Jobs page is idle.

Now tune the description prompt:

1. **Administration → Machine Learning → Image Description.**
2. **Model name:** `Qwen/Qwen2.5-VL-3B-Instruct` (the 3B fits comfortably in 8 GB).
3. **Prompt → Style:** `balanced`, sentence count `3`.
4. **Prompt → Look for:** keep the defaults plus add `birthday cake, sparklers, candles, soccer ball, baseball glove, basketball hoop, hiking trail, ski lift`.
5. **Prompt → Custom vocabulary:** `golden hour, overcast, backyard, park, beach, ski resort, kitchen` plus your top 5 vacation destinations as lowercase phrases.
6. **Prompt → Custom instructions** — paste this:

   ```
   Always name every recognized person and avoid generic group terms like "the family"
   or "everyone".

   If you see a car, truck, or motorcycle, name the make and model when recognizable.
   If people are playing a sport, name the sport and any visible equipment.
   For pets, identify the breed when recognizable.
   For travel scenes, name the landmark if you are certain — do not guess.

   Keep descriptions factual. Do not use poetic language or editorialize about emotions.
   ```

7. **Prompt → Identity Injection:** enabled. Max names `8` (you have larger family group photos). Min face confidence default.
8. **Save.**

### Day 3 — Backfill

1. **Image Description → Status & Re-generation → Re-queue all descriptions.** The estimate is built from the rolling average of recent jobs. On a 3B Qwen with an NVIDIA GPU, expect ~0.5–1 s per asset, so ~12–24 hours total for an 80k+3k library.
2. Let it run.
3. **Smart Albums.** Enable. Add the suggested extra tag triggers for the kinds you care about (see [Smart-album tag tuning](#smart-album-tag-tuning)).
4. **Smart Albums → Re-evaluate all assets.** Quick — only walks descriptions, not images. Runs in minutes.

### Day 4 — Spot-check and iterate

Open 10 random assets across photos and videos. Look for:

- **Family member names are used.** If not, check the People list on the asset, then re-queue.
- **The prompt instructions are reflected.** Is the make/model called out? Is the sport named?
- **Smart album membership makes sense.** If Travel is sparse, add city/landmark names to its triggers and re-evaluate _that one album_.
- **Video descriptions reflect the timeline.** Look for words like "begins", "then", "throughout" — signs the model treated the grid as a sequence.

Iterate the custom instructions in 30-minute cycles: edit, save, re-queue a handful of assets you care about (using the per-asset Rerun action), check, repeat. Once happy, do another full re-queue if needed.

### Day 5+ — Maintenance

- **New uploads** automatically get described with your current config.
- **New videos** automatically get frames extracted, then descriptions, with no manual intervention.
- **New named faces** start appearing in identity injection on _new_ descriptions immediately. To apply to older descriptions of that person, re-queue the affected assets.
- **Tuning prompt** later? Each save updates the config hash. The status panel will show the count of assets with the new vs. old config so you know how much would be re-queued.

---

## Related reading

- [Image Enrichment](./image-enrichment.md) — the underlying description and NSFW pipeline.
- [Facial Recognition](./facial-recognition.md) — required for identity injection.
- [ML Hardware Acceleration](./ml-hardware-acceleration.md) — picking the right hardware profile.
- [Tags](./tags.md) — how the generated tags interact with the rest of Immich.

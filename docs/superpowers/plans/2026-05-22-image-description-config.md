# Configurable Image Description, Identity-Aware Captions, and Smart Auto-Albums Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the VLM prompt, vocabulary, and identity injection admin-configurable, and ship six built-in smart auto-albums backed by tags + CLIP signal.

**Architecture:** Server-driven, stateless ML. The server's `PromptAssembler` builds the prompt from `SystemConfig` and per-asset known-person data, sends `{image, prompt, vocabulary}` to the Python ML service per request, validates the JSON response, applies tag/identity post-processing, and updates smart-album membership.

**Tech Stack:** Python (FastAPI, transformers, openvino-genai, pytest), TypeScript (NestJS, Kysely, Zod, Vitest), Svelte 5

**Rollout note:** This plan covers all 8 PRs from the spec. PRs 1–4 are anchored against the current codebase. PRs 5–8 touch UI/services whose shape will shift slightly as earlier PRs land — re-validate against the codebase at the start of each of those PRs before executing. Land each PR before starting the next; later PRs depend on earlier types/services.

**Spec:** `docs/superpowers/specs/2026-05-22-image-description-config-design.md`

---

## File Structure

**Python ML (PR 1):**

- Modify: `machine-learning/immich_ml/models/image_description.py` — `_predict`, `_make_prompt`, `_make_openvino_prompt` accept external prompt.
- Modify: `machine-learning/test_main.py` — extend `TestImageDescriptionModel` with external-prompt tests.

**Server core (PRs 2, 3, 5, 6):**

- Create: `server/src/services/prompt-assembler.service.ts` — assembles prompt from config + known persons.
- Create: `server/src/services/prompt-assembler.service.spec.ts`
- Create: `server/src/services/identity-post-validator.service.ts` — strips hallucinated names, substitutes when unambiguous.
- Create: `server/src/services/identity-post-validator.service.spec.ts`
- Create: `server/src/services/smart-album.service.ts` — evaluates assets against smart-album rules.
- Create: `server/src/services/smart-album.service.spec.ts`
- Create: `server/src/repositories/smart-album.repository.ts`
- Modify: `server/src/repositories/machine-learning.repository.ts` — `describeImage` gains `prompt`, `vocabulary` params.
- Modify: `server/src/services/image-enrichment.service.ts` — calls assembler, validator, smart-album service.
- Modify: `server/src/dtos/model-config.dto.ts` — extend `ImageDescriptionConfigSchema` with `prompt` block.
- Modify: `server/src/dtos/system-config.dto.ts` — add `smartAlbums` block.
- Modify: `server/src/config.ts` — extend `SystemConfig` type + defaults.

**Schema (PR 6):**

- Create: `server/src/schema/migrations/<timestamp>-CreateSmartAlbumTables.ts`
- Create: `server/src/schema/tables/smart-album.table.ts`
- Create: `server/src/schema/tables/smart-album-asset.table.ts`
- Create: `server/src/schema/tables/smart-album-exclusion.table.ts`

**Jobs (PRs 4, 7):**

- Create: `server/src/jobs/requeue-descriptions.job.ts`
- Create: `server/src/jobs/reevaluate-smart-albums.job.ts`

**Web admin (PRs 4, 7, 8):**

- Modify: `web/src/routes/admin/system-settings/MachineLearningSettings.svelte` — restructure into tabs.
- Create: `web/src/lib/components/admin-settings/PromptVocabularyTab.svelte`
- Create: `web/src/lib/components/admin-settings/SmartAlbumsTab.svelte`
- Create: `web/src/lib/components/admin-settings/StatusRegenerationTab.svelte`
- Create: `web/src/lib/components/admin-settings/CostEstimateModal.svelte`

---

## PR 1 — Python: external prompt parameter

**Goal:** Accept an optional `external_prompt` model option in the Python ML service, use it when provided, fall back to the bundled `IMAGE_DESCRIPTION_PROMPT` constant when not. No behavior change for callers that don't send the new option.

### Task 1.1: Add failing tests for external-prompt acceptance

**Files:**

- Test: `machine-learning/test_main.py` (extend `TestImageDescriptionModel` class around line 180)

- [ ] **Step 1: Read existing TestImageDescriptionModel to understand the testing pattern**

Run: `grep -n "def test_" machine-learning/test_main.py | head -30`
Expected: a list of `test_*` methods in `TestImageDescriptionModel`.

- [ ] **Step 2: Add failing test — external prompt is used when provided**

Edit `machine-learning/test_main.py`, append inside `TestImageDescriptionModel`:

```python
def test_make_prompt_uses_external_when_provided(self) -> None:
    from immich_ml.models.image_description import ImageDescriptionModel
    model = ImageDescriptionModel("Qwen/Qwen2.5-VL-3B-Instruct", acceleration="cuda")
    prompt = model._make_prompt(nsfw=None, external_prompt="CUSTOM PROMPT FROM SERVER")
    assert prompt == "CUSTOM PROMPT FROM SERVER"

def test_make_prompt_falls_back_to_constant_when_external_missing(self) -> None:
    from immich_ml.models.image_description import ImageDescriptionModel, IMAGE_DESCRIPTION_PROMPT
    model = ImageDescriptionModel("Qwen/Qwen2.5-VL-3B-Instruct", acceleration="cuda")
    prompt = model._make_prompt(nsfw=None, external_prompt=None)
    assert prompt == IMAGE_DESCRIPTION_PROMPT

def test_make_prompt_external_ignores_nsfw_suffix(self) -> None:
    # When the server supplies an external prompt, the server is responsible for
    # including any NSFW conditional content. The Python side does not append
    # NSFW_PROMPT_SUFFIX on top of an external prompt.
    from immich_ml.models.image_description import ImageDescriptionModel
    model = ImageDescriptionModel("Qwen/Qwen2.5-VL-3B-Instruct", acceleration="cuda")
    prompt = model._make_prompt(nsfw={"isNsfw": True}, external_prompt="CUSTOM")
    assert prompt == "CUSTOM"
```

- [ ] **Step 3: Run tests to confirm they fail**

Run: `cd machine-learning && uv run pytest test_main.py::TestImageDescriptionModel::test_make_prompt_uses_external_when_provided test_main.py::TestImageDescriptionModel::test_make_prompt_falls_back_to_constant_when_external_missing test_main.py::TestImageDescriptionModel::test_make_prompt_external_ignores_nsfw_suffix -v`
Expected: 3 FAILED with `TypeError: _make_prompt() got an unexpected keyword argument 'external_prompt'`.

### Task 1.2: Implement external_prompt parameter

**Files:**

- Modify: `machine-learning/immich_ml/models/image_description.py:383-395`

- [ ] **Step 1: Update `_make_prompt`**

Replace the existing `_make_prompt` method at `machine-learning/immich_ml/models/image_description.py:383`:

```python
def _make_prompt(self, nsfw: Any = None, external_prompt: str | None = None) -> str:
    if external_prompt is not None:
        # Server-assembled prompt; server is responsible for including any
        # NSFW conditional content and structured fields.
        # Empty string is a valid caller-provided prompt; only None falls back.
        return external_prompt
    prompt = IMAGE_DESCRIPTION_PROMPT
    if isinstance(nsfw, dict) and nsfw.get("isNsfw"):
        prompt += NSFW_PROMPT_SUFFIX
    return prompt
```

- [ ] **Step 2: Update `_make_openvino_prompt`**

Replace `_make_openvino_prompt` at `machine-learning/immich_ml/models/image_description.py:389`:

```python
def _make_openvino_prompt(self, nsfw: Any = None, external_prompt: str | None = None) -> str:
    prompt = self._make_prompt(nsfw, external_prompt)
    if self._uses_phi_openvino_model():
        return f"{PHI_OPENVINO_IMAGE_TAG}\n{prompt}"
    if self._uses_qwen_openvino_model():
        return f"{QWEN_OPENVINO_IMAGE_TAG}\n{prompt}"
    return prompt
```

- [ ] **Step 3: Plumb `external_prompt` through `_predict` and `_predict_qwen`**

In `machine-learning/immich_ml/models/image_description.py`, update `predict`, `_predict`, `_predict_qwen` to thread through the option:

```python
def predict(self, *inputs: Any, **model_kwargs: Any) -> Any:
    self.load()
    if model_kwargs:
        self.configure(**model_kwargs)
    return self._predict(
        *inputs,
        nsfw=model_kwargs.get("nsfw"),
        external_prompt=model_kwargs.get("external_prompt"),
    )

def _predict(self, image: Image.Image, **model_kwargs: Any) -> dict[str, Any]:
    nsfw = model_kwargs.get("nsfw")
    external_prompt = model_kwargs.get("external_prompt")
    if self.acceleration == ImageDescriptionAcceleration.CUDA:
        return self._predict_cuda(image, nsfw, external_prompt)

    prompt = self._make_openvino_prompt(nsfw, external_prompt)
    images = [self._to_openvino_tensor(image)]
    try:
        result = self._generate_openvino(prompt, images)
    except RuntimeError as error:
        if not self._should_retry_openvino_on_cpu(error):
            raise
        log.warning(
            "OpenVINO image description failed on device "
            f"'{self.device}' with '{error}'. Retrying image description on CPU."
        )
        self.session = self._load_openvino("CPU")
        self.device = "CPU"
        result = self._generate_openvino(prompt, images)

    text = self._result_text(result)
    return self._normalize_response(text)

def _predict_cuda(self, image: Image.Image, nsfw: Any = None, external_prompt: str | None = None) -> dict[str, Any]:
    if self.hf_model_name in FLORENCE_MODEL_NAMES:
        # Florence path does not use prompts. external_prompt is ignored intentionally.
        return self._predict_florence(image)
    return self._predict_qwen(image, nsfw, external_prompt)

def _predict_qwen(self, image: Image.Image, nsfw: Any = None, external_prompt: str | None = None) -> dict[str, Any]:
    prompt = self._make_prompt(nsfw, external_prompt)
    # ... rest of _predict_qwen unchanged
```

- [ ] **Step 4: Run the unit tests added in Task 1.1**

Run: `cd machine-learning && uv run pytest test_main.py::TestImageDescriptionModel::test_make_prompt_uses_external_when_provided test_main.py::TestImageDescriptionModel::test_make_prompt_falls_back_to_constant_when_external_missing test_main.py::TestImageDescriptionModel::test_make_prompt_external_ignores_nsfw_suffix -v`
Expected: 3 PASSED.

- [ ] **Step 5: Run the full ImageDescriptionModel test class to confirm no regressions**

Run: `cd machine-learning && uv run pytest test_main.py::TestImageDescriptionModel -v`
Expected: all tests PASS (the existing ~20 tests + the 3 new ones).

### Task 1.3: Add Florence-path test to confirm `external_prompt` is ignored gracefully

**Files:**

- Test: `machine-learning/test_main.py`

- [ ] **Step 1: Add test**

```python
def test_florence_ignores_external_prompt(self, monkeypatch: pytest.MonkeyPatch) -> None:
    from immich_ml.models.image_description import ImageDescriptionModel
    model = ImageDescriptionModel("microsoft/Florence-2-base", acceleration="cuda")
    # Stub _predict_florence so we don't need to load a real model
    monkeypatch.setattr(
        ImageDescriptionModel,
        "_predict_florence",
        lambda self, image: {"description": "florence output", "tags": []},
    )
    result = model._predict_cuda(image=None, nsfw=None, external_prompt="THIS SHOULD BE IGNORED")
    assert result["description"] == "florence output"
```

- [ ] **Step 2: Run the test**

Run: `cd machine-learning && uv run pytest test_main.py::TestImageDescriptionModel::test_florence_ignores_external_prompt -v`
Expected: PASS.

### Task 1.4: Commit PR 1

- [ ] **Step 1: Stage and commit**

```bash
git add machine-learning/immich_ml/models/image_description.py machine-learning/test_main.py
git commit -m "$(cat <<'EOF'
feat(ml): accept external_prompt option in image description models

Adds an optional external_prompt option to the image description model's
predict() interface. When provided, replaces the bundled prompt verbatim;
when absent, falls back to the existing IMAGE_DESCRIPTION_PROMPT constant
so existing behavior is unchanged.

Florence-2 path ignores external_prompt gracefully — Florence uses task
tokens, not prompts.

Foundation for server-driven prompt customization (spec PR 1/8).
EOF
)"
```

---

## PR 2 — Server: prompt assembler + ML plumbing

**Goal:** Server-side service that assembles a prompt from `SystemConfig` (structured fields path only — identity injection lands in PR 5, smart albums in PR 6) and threads it through `describeImage` to the Python service. Defaults reproduce today's prompt verbatim.

### Task 2.1: Add failing tests for `PromptAssembler.build`

**Files:**

- Test: `server/src/services/prompt-assembler.service.spec.ts` (create)

- [ ] **Step 1: Write the test file**

Create `server/src/services/prompt-assembler.service.spec.ts`:

```typescript
import { ImageDescriptionPromptAssembler } from 'src/services/prompt-assembler.service';
import type { ImageDescriptionPromptConfig } from 'src/services/prompt-assembler.service';
import { describe, expect, it } from 'vitest';

const baseConfig = (overrides: Partial<ImageDescriptionPromptConfig> = {}): ImageDescriptionPromptConfig => ({
  style: 'balanced',
  sentenceCountTarget: 3,
  lookFor: [],
  customVocabulary: [],
  nsfwIndicators: ['naked', 'nudity', 'exposed-genitals'],
  medicalIndicators: ['hospital', 'bandage', 'iv-line'],
  forbiddenInferences: ['diagnoses', 'medication names'],
  identityInjection: { enabled: true, maxNames: 5, minFaceConfidence: 0.7 },
  advanced: { enabled: false, rawPromptTemplate: '', placeholderValidation: 'strict' },
  ...overrides,
});

describe('ImageDescriptionPromptAssembler', () => {
  const assembler = new ImageDescriptionPromptAssembler();

  it('produces a prompt with the standard role line and JSON schema', () => {
    const { prompt } = assembler.build({ config: baseConfig(), knownPersons: [] });
    expect(prompt).toContain('searchable image record');
    expect(prompt).toContain('"description"');
    expect(prompt).toContain('"tags"');
    expect(prompt).toContain('"safety"');
    expect(prompt).toContain('"medical"');
  });

  it('omits identity hint section when no known persons supplied', () => {
    const { prompt } = assembler.build({ config: baseConfig(), knownPersons: [] });
    expect(prompt).not.toContain('Known people detected');
  });

  it('omits look-for section when lookFor is empty', () => {
    const { prompt } = assembler.build({ config: baseConfig({ lookFor: [] }), knownPersons: [] });
    expect(prompt).not.toContain('When relevant and visibly supported');
  });

  it('includes look-for section when lookFor is non-empty', () => {
    const { prompt } = assembler.build({
      config: baseConfig({ lookFor: ['brands', 'sports equipment'] }),
      knownPersons: [],
    });
    expect(prompt).toContain('brands');
    expect(prompt).toContain('sports equipment');
  });

  it('includes vocabulary section when customVocabulary is non-empty', () => {
    const { prompt } = assembler.build({
      config: baseConfig({ customVocabulary: ['prescription-bottle', 'surfboard'] }),
      knownPersons: [],
    });
    expect(prompt).toContain('Prefer these tag values');
    expect(prompt).toContain('prescription-bottle');
  });

  it('terse style produces one-sentence instruction', () => {
    const { prompt } = assembler.build({
      config: baseConfig({ style: 'terse', sentenceCountTarget: 1 }),
      knownPersons: [],
    });
    expect(prompt).toMatch(/one factual sentence/i);
  });

  it('rich style produces multi-sentence instruction including mood/season', () => {
    const { prompt } = assembler.build({
      config: baseConfig({ style: 'rich', sentenceCountTarget: 5 }),
      knownPersons: [],
    });
    expect(prompt).toMatch(/mood/i);
    expect(prompt).toMatch(/season/i);
  });

  it('builds forbidden-inferences section from config list', () => {
    const { prompt } = assembler.build({
      config: baseConfig({ forbiddenInferences: ['diagnoses', 'pregnancy'] }),
      knownPersons: [],
    });
    expect(prompt).toContain('diagnoses');
    expect(prompt).toContain('pregnancy');
  });

  describe('advanced mode', () => {
    it('uses raw prompt template verbatim with placeholders substituted', () => {
      const { prompt } = assembler.build({
        config: baseConfig({
          advanced: {
            enabled: true,
            rawPromptTemplate: 'CUSTOM TEMPLATE\n{schema}\n{style_hint}',
            placeholderValidation: 'strict',
          },
        }),
        knownPersons: [],
      });
      expect(prompt).toMatch(/^CUSTOM TEMPLATE/);
      expect(prompt).toContain('"description"');
    });

    it('strict validation: throws when {schema} placeholder is missing', () => {
      expect(() =>
        assembler.build({
          config: baseConfig({
            advanced: {
              enabled: true,
              rawPromptTemplate: 'NO SCHEMA HERE {names}',
              placeholderValidation: 'strict',
            },
          }),
          knownPersons: [],
        }),
      ).toThrow(/schema/);
    });

    it('warn validation: builds and returns warning flag instead of throwing', () => {
      const { prompt, warnings } = assembler.build({
        config: baseConfig({
          advanced: {
            enabled: true,
            rawPromptTemplate: 'NO SCHEMA HERE {names}',
            placeholderValidation: 'warn',
          },
        }),
        knownPersons: [],
      });
      expect(prompt).toContain('NO SCHEMA HERE');
      expect(warnings).toContain('missing-schema-placeholder');
    });
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd server && npx vitest run src/services/prompt-assembler.service.spec.ts`
Expected: all FAIL with `Cannot find module 'src/services/prompt-assembler.service'`.

### Task 2.2: Implement `ImageDescriptionPromptAssembler`

**Files:**

- Create: `server/src/services/prompt-assembler.service.ts`

- [ ] **Step 1: Write the service**

Create `server/src/services/prompt-assembler.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';

export interface ImageDescriptionPromptConfig {
  style: 'terse' | 'balanced' | 'rich';
  sentenceCountTarget: number;
  lookFor: string[];
  customVocabulary: string[];
  nsfwIndicators: string[];
  medicalIndicators: string[];
  forbiddenInferences: string[];
  identityInjection: { enabled: boolean; maxNames: number; minFaceConfidence: number };
  advanced: {
    enabled: boolean;
    rawPromptTemplate: string;
    placeholderValidation: 'strict' | 'warn';
  };
}

export interface KnownPerson {
  name: string;
  faceConfidence: number;
  boxCenter: [number, number]; // normalized [0,1] x/y
}

export interface AssembledPrompt {
  prompt: string;
  expectedSchemaVersion: string;
  warnings: string[];
}

const SCHEMA_VERSION = '2026-05-22';

const JSON_SCHEMA_BLOCK = `Return valid JSON with this schema:

{
  "description": "Two or three factual sentences about the main subject, activity, environment, and visible objects.",
  "people": [
    {
      "count": 1,
      "apparent_age_group": "adult | young adult | teenager | child | older adult | unknown",
      "activity": "visible activity",
      "confidence": "low | medium | high"
    }
  ],
  "environment": "indoor office, outdoor street, kitchen, store, vehicle interior, etc.",
  "objects": ["object1", "object2", "object3"],
  "visible_text": ["text visible in image, if any"],
  "context": "brief inferred context, only if visually supported",
  "tags": ["tag1", "tag2", "tag3"],
  "safety": {
    "is_nsfw_likely": false,
    "confidence": "low | medium | high",
    "indicators": ["visible adult nudity, sexual activity, restraint, etc."],
    "reason": "brief visual evidence for the NSFW assessment"
  },
  "medical": {
    "is_medical_likely": false,
    "confidence": "low | medium | high",
    "indicators": ["visible medical setting, device, object, or body state"],
    "reason": "brief visual evidence for the medical assessment"
  }
}`;

@Injectable()
export class ImageDescriptionPromptAssembler {
  build(input: { config: ImageDescriptionPromptConfig; knownPersons: KnownPerson[] }): AssembledPrompt {
    const { config, knownPersons } = input;

    if (config.advanced.enabled) {
      return this.buildFromTemplate(config, knownPersons);
    }

    const sections: string[] = [];
    sections.push(this.roleLine());

    const identityHint = this.identityHint(config, knownPersons);
    if (identityHint) sections.push(identityHint);

    sections.push(this.styleHint(config));

    if (config.lookFor.length > 0) sections.push(this.lookForHint(config.lookFor));
    if (config.customVocabulary.length > 0) sections.push(this.vocabularyHint(config.customVocabulary));

    sections.push(JSON_SCHEMA_BLOCK);
    sections.push(this.safetyRules(config.nsfwIndicators));
    sections.push(this.medicalRules(config.medicalIndicators, config.forbiddenInferences));
    sections.push(this.standardRules());

    return { prompt: sections.join('\n\n'), expectedSchemaVersion: SCHEMA_VERSION, warnings: [] };
  }

  private buildFromTemplate(config: ImageDescriptionPromptConfig, knownPersons: KnownPerson[]): AssembledPrompt {
    const template = config.advanced.rawPromptTemplate;
    const warnings: string[] = [];

    if (!template.includes('{schema}')) {
      if (config.advanced.placeholderValidation === 'strict') {
        throw new Error('Raw prompt template is missing required {schema} placeholder.');
      }
      warnings.push('missing-schema-placeholder');
    }

    const names = this.identityHint(config, knownPersons) ?? '';
    const styleHint = this.styleHint(config);
    const vocabulary = config.customVocabulary.length > 0 ? this.vocabularyHint(config.customVocabulary) : '';

    const prompt = template
      .replaceAll('{names}', names)
      .replaceAll('{schema}', JSON_SCHEMA_BLOCK)
      .replaceAll('{style_hint}', styleHint)
      .replaceAll('{vocabulary}', vocabulary);

    return { prompt, expectedSchemaVersion: SCHEMA_VERSION, warnings };
  }

  private roleLine(): string {
    return 'You are generating a concise searchable image record from computer vision outputs.\n\nUse only visible evidence from the image. If estimating age, use broad apparent age groups only, such as baby, child, teenager, young adult, adult, older adult, or unknown.';
  }

  private identityHint(config: ImageDescriptionPromptConfig, persons: KnownPerson[]): string | null {
    if (!config.identityInjection.enabled) return null;
    const eligible = persons
      .filter((p) => p.faceConfidence >= config.identityInjection.minFaceConfidence)
      .slice(0, config.identityInjection.maxNames);
    if (eligible.length === 0) return null;
    const lines = eligible.map((p) => `- ${p.name} (${this.positionLabel(p.boxCenter)})`);
    return `Known people detected in this image (use these names when describing them; do not invent names):\n${lines.join('\n')}`;
  }

  private positionLabel(box: [number, number]): string {
    const [x, y] = box;
    const col = x < 1 / 3 ? 'left' : x < 2 / 3 ? 'center' : 'right';
    const row = y < 1 / 3 ? 'top' : y < 2 / 3 ? 'middle' : 'bottom';
    if (row === 'middle' && col === 'center') return 'center';
    return `${row}-${col}`;
  }

  private styleHint(config: ImageDescriptionPromptConfig): string {
    switch (config.style) {
      case 'terse':
        return 'Write one factual sentence capturing the main subject and activity.';
      case 'rich':
        return `Write ${config.sentenceCountTarget} factual sentences. Capture mood, season or time-of-day when visibly supported, subject, activity, environment, notable objects, and relationships between people.`;
      case 'balanced':
      default:
        return `Write ${config.sentenceCountTarget} factual sentences capturing subject, activity, environment, and notable objects.`;
    }
  }

  private lookForHint(items: string[]): string {
    return `When relevant and visibly supported, note: ${items.join(', ')}.`;
  }

  private vocabularyHint(items: string[]): string {
    return `Prefer these tag values when applicable: ${items.join(', ')}.`;
  }

  private safetyRules(indicators: string[]): string {
    return `If visible evidence supports adult nudity or sexual content, say so factually with terms like ${indicators.join(', ')}. Do not treat bare chest, bed, swimwear, underwear, or ambiguous partial clothing as explicit by itself.`;
  }

  private medicalRules(indicators: string[], forbidden: string[]): string {
    return `If visible evidence supports a medical context, describe visible items such as ${indicators.join(', ')}. Do not infer ${forbidden.join(', ')} unless plainly visible as generic text or objects.`;
  }

  private standardRules(): string {
    return [
      'Rules:',
      '- Return only JSON. Do not wrap the response in markdown or explanatory text.',
      '- Keep the description factual, searchable, and user-friendly. Never put raw JSON or schema text in the description.',
      '- Prefer concrete nouns over vague adjectives.',
      '- Use 8 to 20 tags.',
      '- Tags should be lowercase, short, and useful for search.',
      '- Preserve uncertainty in people fields when needed.',
      '- Avoid moralizing language.',
    ].join('\n');
  }
}
```

- [ ] **Step 2: Register the service in the providers module**

Find Immich's service registration — typically `server/src/services/index.ts` or a module file. Run:

`grep -rn "OcrService\|ImageEnrichmentService" server/src/services/index.ts 2>/dev/null | head`

Add `ImageDescriptionPromptAssembler` to the same providers list following the existing pattern.

- [ ] **Step 3: Run the spec**

Run: `cd server && npx vitest run src/services/prompt-assembler.service.spec.ts`
Expected: all PASS.

- [ ] **Step 4: Commit assembler service**

```bash
git add server/src/services/prompt-assembler.service.ts server/src/services/prompt-assembler.service.spec.ts server/src/services/index.ts
git commit -m "feat(server): add ImageDescriptionPromptAssembler service"
```

### Task 2.3: Plumb `prompt` through `describeImage`

**Files:**

- Modify: `server/src/repositories/machine-learning.repository.ts:325-365`

- [ ] **Step 1: Update the request payload type**

Find the request type for image description (likely in the same file or a shared types file). Run:

`grep -n "ImageDescriptionRequest\|VisualResponse" server/src/repositories/machine-learning.repository.ts | head`

Update the request shape to include `prompt` under `options`:

```typescript
async describeImage(
  imagePath: string,
  { modelName, acceleration, fallbackModelName, device }: ImageDescriptionOptions,
  nsfw?: NsfwDetectionResult,
  prompt?: string,
) {
  const buildRequest = (effectiveModelName: string) => ({
    [ModelTask.IMAGE_DESCRIPTION]: {
      [ModelType.VISUAL]: {
        modelName: effectiveModelName,
        options: { acceleration, device, nsfw, external_prompt: prompt },
      },
    },
  });

  const request = buildRequest(modelName);

  try {
    const response = await this.predict<ImageDescriptionResponse>({ imagePath }, request);
    return response[ModelTask.IMAGE_DESCRIPTION];
  } catch (error) {
    if (!fallbackModelName || fallbackModelName === modelName) throw error;

    if (
      acceleration !== MachineLearningHardwareAcceleration.Cuda &&
      isFlorenceImageDescriptionModel(fallbackModelName)
    ) {
      this.logger.warn(
        `Image description model '${modelName}' failed; not retrying with fallback model '${fallbackModelName}' because Florence models require CUDA acceleration.`,
      );
      throw error;
    }

    this.logger.warn(
      `Image description model '${modelName}' failed; retrying with fallback model '${fallbackModelName}'`,
    );
    const fallbackResponse = await this.predict<ImageDescriptionResponse>(
      { imagePath },
      buildRequest(fallbackModelName),
    );
    return fallbackResponse[ModelTask.IMAGE_DESCRIPTION];
  }
}
```

- [ ] **Step 2: Update the call site in `image-enrichment.service.ts:406`**

Inject `ImageDescriptionPromptAssembler` into the constructor. At the call site (search for `describeImage` in `server/src/services/image-enrichment.service.ts`), assemble the prompt before calling:

```typescript
const { prompt } = this.promptAssembler.build({
  config: machineLearning.imageDescription.prompt,
  knownPersons: [], // PR 5 will populate this from face data
});

result = await this.machineLearningRepository.describeImage(imagePath, machineLearning.imageDescription, nsfw, prompt);
```

- [ ] **Step 3: Update existing image-enrichment spec to cover the new arg**

Find `server/src/services/image-enrichment.service.spec.ts` and add an assertion on the `describeImage` mock that confirms `prompt` is passed:

```typescript
expect(mocks.machineLearning.describeImage).toHaveBeenCalledWith(
  expect.any(String),
  expect.any(Object),
  expect.anything(),
  expect.stringContaining('searchable image record'),
);
```

- [ ] **Step 4: Run server tests**

Run: `cd server && npx vitest run src/services/image-enrichment.service.spec.ts src/services/prompt-assembler.service.spec.ts src/repositories/machine-learning.repository.spec.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/repositories/machine-learning.repository.ts server/src/services/image-enrichment.service.ts server/src/services/image-enrichment.service.spec.ts
git commit -m "feat(server): plumb assembled prompt through describeImage"
```

### Task 2.4: PR 2 final sanity

- [ ] **Step 1: Run the full server test suite**

Run: `cd server && npm test`
Expected: all PASS.

- [ ] **Step 2: Type-check**

Run: `cd server && npx tsc --noEmit`
Expected: zero errors.

---

## PR 3 — Config schema: prompt + smartAlbums

**Goal:** Extend `SystemConfig` and the Zod DTO to include the new `prompt` block on `imageDescription` and the new `smartAlbums` block. Defaults reproduce today's behavior verbatim, so a fresh install with no admin changes acts identically to today.

### Task 3.1: Failing test for default config shape

**Files:**

- Test: `server/src/dtos/model-config.dto.spec.ts` (create or extend if exists)

- [ ] **Step 1: Check if a spec file exists**

Run: `ls server/src/dtos/model-config.dto.spec.ts 2>/dev/null || echo "no spec yet"`

- [ ] **Step 2: Add or create a test**

Add this test in the spec:

```typescript
import { ImageDescriptionConfigSchema } from 'src/dtos/model-config.dto';
import { describe, expect, it } from 'vitest';

describe('ImageDescriptionConfigSchema', () => {
  it('parses default config with prompt block', () => {
    const parsed = ImageDescriptionConfigSchema.parse({
      enabled: true,
      modelName: 'Qwen/Qwen2.5-VL-3B-Instruct',
      fallbackModelName: 'microsoft/Florence-2-base-ft',
      acceleration: 'auto',
      device: 'AUTO',
      prompt: {
        style: 'balanced',
        sentenceCountTarget: 3,
        lookFor: [],
        customVocabulary: [],
        nsfwIndicators: ['naked', 'nudity'],
        medicalIndicators: ['hospital'],
        forbiddenInferences: ['diagnoses'],
        identityInjection: { enabled: true, maxNames: 5, minFaceConfidence: 0.7 },
        advanced: { enabled: false, rawPromptTemplate: '', placeholderValidation: 'strict' },
      },
    });
    expect(parsed.prompt.style).toBe('balanced');
    expect(parsed.prompt.identityInjection.enabled).toBe(true);
  });

  it('rejects invalid style enum', () => {
    expect(() =>
      ImageDescriptionConfigSchema.parse({
        enabled: true,
        modelName: 'x',
        fallbackModelName: 'y',
        acceleration: 'auto',
        device: 'AUTO',
        prompt: {
          style: 'florid',
          sentenceCountTarget: 3,
          lookFor: [],
          customVocabulary: [],
          nsfwIndicators: [],
          medicalIndicators: [],
          forbiddenInferences: [],
          identityInjection: { enabled: false, maxNames: 5, minFaceConfidence: 0.7 },
          advanced: { enabled: false, rawPromptTemplate: '', placeholderValidation: 'strict' },
        },
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 3: Run and verify fail**

Run: `cd server && npx vitest run src/dtos/model-config.dto.spec.ts`
Expected: FAIL — `prompt` field unknown.

### Task 3.2: Extend `ImageDescriptionConfigSchema`

**Files:**

- Modify: `server/src/dtos/model-config.dto.ts:93-99`

- [ ] **Step 1: Add the prompt sub-schemas above `ImageDescriptionConfigSchema`**

```typescript
const IdentityInjectionSchema = z
  .object({
    enabled: z.boolean().default(true),
    maxNames: z.int().min(1).max(20).default(5),
    minFaceConfidence: z.number().meta({ format: 'double' }).min(0).max(1).default(0.7),
  })
  .meta({ id: 'IdentityInjectionConfig' });

const AdvancedPromptSchema = z
  .object({
    enabled: z.boolean().default(false),
    rawPromptTemplate: z.string().default(''),
    placeholderValidation: z.enum(['strict', 'warn']).default('strict'),
  })
  .meta({ id: 'AdvancedPromptConfig' });

export const ImageDescriptionPromptSchema = z
  .object({
    style: z.enum(['terse', 'balanced', 'rich']).default('balanced'),
    sentenceCountTarget: z.int().min(1).max(6).default(3),
    lookFor: z.array(z.string()).default([]),
    customVocabulary: z.array(z.string()).default([]),
    nsfwIndicators: z
      .array(z.string())
      .default([
        'adult-nudity',
        'bare-buttocks',
        'bondage',
        'explicit',
        'exposed-genitals',
        'naked',
        'nsfw',
        'nudity',
        'restraint',
        'sex-toy',
        'sexual-activity',
      ]),
    medicalIndicators: z
      .array(z.string())
      .default([
        'bandage',
        'cast',
        'crutches',
        'exam-table',
        'hospital',
        'iv-line',
        'lab-result',
        'medical',
        'medical-monitor',
        'medical-paperwork',
        'mobility-aid',
        'pill-organizer',
        'prescription',
        'syringe',
        'ultrasound',
        'wheelchair',
        'wound',
        'x-ray',
      ]),
    forbiddenInferences: z
      .array(z.string())
      .default(['diagnoses', 'medication names', 'procedures', 'pregnancy', 'disability']),
    identityInjection: IdentityInjectionSchema.default({ enabled: true, maxNames: 5, minFaceConfidence: 0.7 }),
    advanced: AdvancedPromptSchema.default({ enabled: false, rawPromptTemplate: '', placeholderValidation: 'strict' }),
  })
  .meta({ id: 'ImageDescriptionPromptConfig' });

export const ImageDescriptionConfigSchema = ModelConfigSchema.extend({
  acceleration: MachineLearningHardwareAccelerationSchema.default(MachineLearningHardwareAcceleration.Auto).describe(
    'Hardware acceleration backend to use',
  ),
  fallbackModelName: z.string().describe('Name of the fallback model to use'),
  device: z.string().describe('Hardware device to use'),
  prompt: ImageDescriptionPromptSchema.default({}),
}).meta({ id: 'ImageDescriptionConfig' });
```

- [ ] **Step 2: Run the spec tests**

Run: `cd server && npx vitest run src/dtos/model-config.dto.spec.ts`
Expected: PASS.

### Task 3.3: Add `smartAlbums` block to system config

**Files:**

- Modify: `server/src/dtos/system-config.dto.ts`
- Modify: `server/src/config.ts:96` (extend the `SystemConfig` type and defaults)

- [ ] **Step 1: Add the schema**

In `server/src/dtos/system-config.dto.ts`, add above the `SystemConfigMachineLearningSchema` block:

```typescript
const SmartAlbumKindSchema = z.object({
  enabled: configBool.describe('Whether this smart album is active'),
  name: z.string().describe('User-visible album name'),
  tagTriggers: z.array(z.string()).describe('Tags that mark an asset as belonging to this album'),
  clipQueries: z.array(z.string()).describe('CLIP query phrases used when no tag trigger matches'),
  threshold: z.number().meta({ format: 'double' }).min(0).max(1).describe('CLIP similarity threshold'),
});

const SystemConfigSmartAlbumsSchema = z
  .object({
    enabled: configBool.describe('Master smart-album enabled toggle'),
    builtIn: z.object({
      travel: SmartAlbumKindSchema,
      documents: SmartAlbumKindSchema,
      screenshots: SmartAlbumKindSchema,
      food: SmartAlbumKindSchema,
      pets: SmartAlbumKindSchema,
      nature: SmartAlbumKindSchema,
    }),
  })
  .meta({ id: 'SystemConfigSmartAlbumsDto' });
```

Then add `smartAlbums: SystemConfigSmartAlbumsSchema.default(defaults.smartAlbums)` to the main `SystemConfigDto` object.

- [ ] **Step 2: Extend SystemConfig type and defaults in `server/src/config.ts`**

Add at the bottom of the `SystemConfig` interface (before the closing brace):

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
  };
```

Add defaults under `defaults` in the same file:

```typescript
smartAlbums: {
  enabled: false, // off by default; admin opts in
  builtIn: {
    travel: {
      enabled: true,
      name: 'Travel',
      tagTriggers: ['airport','beach','mountain','landmark','hotel','passport','suitcase','tourist'],
      clipQueries: ['vacation travel landscape', 'tourist destination'],
      threshold: 0.28,
    },
    documents: {
      enabled: true,
      name: 'Documents & Receipts',
      tagTriggers: ['receipt','document','invoice','paperwork','scan','id-card'],
      clipQueries: ['paper document', 'receipt or invoice'],
      threshold: 0.28,
    },
    screenshots: {
      enabled: true,
      name: 'Screenshots',
      tagTriggers: ['screenshot','ui','screen-capture','user-interface'],
      clipQueries: ['phone or computer screenshot'],
      threshold: 0.28,
    },
    food: {
      enabled: true,
      name: 'Food',
      tagTriggers: ['food','meal','dish','restaurant','plate','cooking'],
      clipQueries: ['plated food meal', 'restaurant dish'],
      threshold: 0.28,
    },
    pets: {
      enabled: true,
      name: 'Pets',
      tagTriggers: ['pet','dog','cat','puppy','kitten'],
      clipQueries: ['domestic pet animal'],
      threshold: 0.28,
    },
    nature: {
      enabled: true,
      name: 'Nature',
      tagTriggers: ['nature','forest','mountain','ocean','sunset','wildlife','flower'],
      clipQueries: ['natural landscape', 'wildlife'],
      threshold: 0.28,
    },
  },
},
```

- [ ] **Step 3: Add a default for the new `prompt` field in `imageDescription` defaults**

In `server/src/config.ts` defaults block, where `imageDescription` is currently defined (around line 333), extend to include `prompt`:

```typescript
imageDescription: {
  enabled: false,
  acceleration: MachineLearningHardwareAcceleration.Auto,
  modelName: 'Qwen/Qwen2.5-VL-3B-Instruct',
  fallbackModelName: 'microsoft/Florence-2-base-ft',
  device: 'AUTO',
  prompt: {
    style: 'balanced',
    sentenceCountTarget: 3,
    lookFor: [],
    customVocabulary: [],
    nsfwIndicators: ['adult-nudity','bare-buttocks','bondage','explicit','exposed-genitals','naked','nsfw','nudity','restraint','sex-toy','sexual-activity'],
    medicalIndicators: ['bandage','cast','crutches','exam-table','hospital','iv-line','lab-result','medical','medical-monitor','medical-paperwork','mobility-aid','pill-organizer','prescription','syringe','ultrasound','wheelchair','wound','x-ray'],
    forbiddenInferences: ['diagnoses','medication names','procedures','pregnancy','disability'],
    identityInjection: { enabled: true, maxNames: 5, minFaceConfidence: 0.7 },
    advanced: { enabled: false, rawPromptTemplate: '', placeholderValidation: 'strict' },
  },
},
```

- [ ] **Step 4: Run server test suite**

Run: `cd server && npm test`
Expected: all PASS, including config-load tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/dtos/model-config.dto.ts server/src/dtos/system-config.dto.ts server/src/config.ts server/src/dtos/model-config.dto.spec.ts
git commit -m "feat(server): add prompt + smartAlbums config schemas"
```

---

## PR 4 — Admin UI: Model + Prompt tabs, cost modal, re-queue job

**Goal:** Surface the prompt config in the admin UI as a tabbed restructure of `MachineLearningSettings.svelte`. Cost-estimate modal on save when description-affecting config changed. Background job to re-queue descriptions on demand.

**Re-validation note:** `MachineLearningSettings.svelte` is 614 lines today. The tabs restructure breaks it apart. Re-read the current file before starting because line numbers below may have shifted as Immich evolves.

### Task 4.1: Add `configVersion` to per-asset description metadata

**Files:**

- Modify: `server/src/services/image-enrichment.service.ts` — where description result is persisted to metadata.

- [ ] **Step 1: Grep for the persistence call**

Run: `grep -n "description.result\|metadata.description" server/src/services/image-enrichment.service.ts | head -20`

- [ ] **Step 2: Add `configVersion: number` to the persisted shape**

Locate the description-result write (around line 499 per the spec). When writing `metadata.description.result`, also write `metadata.description.configVersion = systemConfig.versionCounter` (read from config — defined next step).

- [ ] **Step 3: Add `versionCounter` to config**

In `server/src/dtos/system-config.dto.ts`, add a top-level `versionCounter: z.int().default(0)` field. Bump it server-side any time the prompt or smartAlbums block changes. Implement that bump in the system-config update handler — find with: `grep -rn "updateSystemConfig\|setSystemConfig" server/src/services/ | head`.

- [ ] **Step 4: Run server tests**

Run: `cd server && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/image-enrichment.service.ts server/src/dtos/system-config.dto.ts
git commit -m "feat(server): record configVersion on description metadata"
```

### Task 4.2: `RequeueDescriptionsJob`

**Files:**

- Create: `server/src/jobs/requeue-descriptions.job.ts`
- Test: `server/src/jobs/requeue-descriptions.job.spec.ts`

- [ ] **Step 1: Read an existing job for the project's job-framework conventions**

Run: `ls server/src/jobs 2>/dev/null && head -80 server/src/jobs/$(ls server/src/jobs 2>/dev/null | head -1)`

If no `jobs/` directory exists, jobs live in services. Adapt the file path accordingly. The remainder of this task assumes a `JobRepository.queue` API; if Immich uses BullMQ or a different abstraction, mirror its pattern.

- [ ] **Step 2: Write the spec**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RequeueDescriptionsJob } from 'src/jobs/requeue-descriptions.job';

describe('RequeueDescriptionsJob', () => {
  let assetRepo: any;
  let jobRepo: any;
  let job: RequeueDescriptionsJob;

  beforeEach(() => {
    assetRepo = {
      streamAssetIdsForDescriptionRequeue: vi.fn().mockImplementation(async function* () {
        yield 'a1';
        yield 'a2';
        yield 'a3';
      }),
    };
    jobRepo = { queueImageDescription: vi.fn().mockResolvedValue(undefined) };
    job = new RequeueDescriptionsJob(assetRepo, jobRepo);
  });

  it('enqueues each eligible asset with the current configVersion', async () => {
    await job.run({ configVersion: 7 });
    expect(jobRepo.queueImageDescription).toHaveBeenCalledTimes(3);
    expect(jobRepo.queueImageDescription).toHaveBeenCalledWith({ assetId: 'a1', configVersion: 7, priority: 'low' });
  });

  it('is idempotent on repeated runs for the same configVersion', async () => {
    await job.run({ configVersion: 7 });
    await job.run({ configVersion: 7 });
    // Should not double-enqueue assets that already have a pending job at this version.
    expect(jobRepo.queueImageDescription).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 3: Implement**

```typescript
import { Injectable } from '@nestjs/common';

interface AssetRepoLike {
  streamAssetIdsForDescriptionRequeue(): AsyncIterable<string>;
}
interface JobRepoLike {
  queueImageDescription(args: { assetId: string; configVersion: number; priority: 'low' | 'normal' }): Promise<void>;
}

@Injectable()
export class RequeueDescriptionsJob {
  private inFlightConfigVersions = new Set<number>();

  constructor(
    private assetRepo: AssetRepoLike,
    private jobRepo: JobRepoLike,
  ) {}

  async run({ configVersion }: { configVersion: number }): Promise<void> {
    if (this.inFlightConfigVersions.has(configVersion)) return;
    this.inFlightConfigVersions.add(configVersion);
    try {
      for await (const assetId of this.assetRepo.streamAssetIdsForDescriptionRequeue()) {
        await this.jobRepo.queueImageDescription({ assetId, configVersion, priority: 'low' });
      }
    } finally {
      this.inFlightConfigVersions.delete(configVersion);
    }
  }
}
```

- [ ] **Step 4: Add `streamAssetIdsForDescriptionRequeue` to the asset repo**

In Immich's asset repository, add a method that streams asset IDs where `metadata.description.status` is `'success'` or null AND not in an in-flight `processing` state. Reference SQL:

```sql
SELECT id FROM assets
WHERE (metadata->'description'->>'status' = 'success'
    OR metadata->'description' IS NULL)
  AND (metadata->'description'->>'status') IS DISTINCT FROM 'processing'
ORDER BY created_at DESC;
```

Stream via Kysely's `.stream()` for memory bounds.

- [ ] **Step 5: Run job tests**

Run: `cd server && npx vitest run src/jobs/requeue-descriptions.job.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/jobs/requeue-descriptions.job.ts server/src/jobs/requeue-descriptions.job.spec.ts server/src/repositories/asset.repository.ts
git commit -m "feat(server): add RequeueDescriptionsJob for batch re-description"
```

### Task 4.3: Cost-estimate endpoint

**Files:**

- Modify: `server/src/services/system-config.service.ts` (or wherever admin endpoints live) — add `estimateRequeueCost`.
- Modify: `server/src/controllers/system-config.controller.ts` — expose endpoint.

- [ ] **Step 1: Grep for the existing admin config controller**

Run: `grep -rn "@Controller.*system-config\|getSystemConfig" server/src/controllers/ | head`

- [ ] **Step 2: Add endpoint**

```typescript
@Get('estimate-description-requeue')
@RequiresAdmin()
async estimateDescriptionRequeue() {
  return this.systemConfigService.estimateRequeueCost();
}
```

- [ ] **Step 3: Implement**

```typescript
async estimateRequeueCost(): Promise<{
  totalAssets: number;
  withDescription: number;
  withoutDescription: number;
  rollingAvgSeconds: number;
  estimatedTotalSeconds: number;
  activeBackend: string;
  activeModel: string;
}> {
  const stats = await this.assetRepo.getDescriptionStats();
  const rolling = await this.jobRepo.getRollingAvgSeconds('imageDescription', 1000);
  const config = await this.getSystemConfig();
  return {
    totalAssets: stats.total,
    withDescription: stats.withDescription,
    withoutDescription: stats.withoutDescription,
    rollingAvgSeconds: rolling,
    estimatedTotalSeconds: stats.total * rolling,
    activeBackend: config.machineLearning.imageDescription.acceleration,
    activeModel: config.machineLearning.imageDescription.modelName,
  };
}
```

- [ ] **Step 4: Spec the endpoint**

Add to `server/src/services/system-config.service.spec.ts`:

```typescript
it('estimates re-queue cost', async () => {
  mocks.assetRepo.getDescriptionStats.mockResolvedValue({ total: 100, withDescription: 60, withoutDescription: 40 });
  mocks.jobRepo.getRollingAvgSeconds.mockResolvedValue(1.2);
  const result = await sut.estimateRequeueCost();
  expect(result.estimatedTotalSeconds).toBeCloseTo(120);
});
```

- [ ] **Step 5: Run and commit**

```bash
cd server && npm test
git add server/src/services/system-config.service.ts server/src/controllers/system-config.controller.ts server/src/repositories/asset.repository.ts server/src/services/system-config.service.spec.ts
git commit -m "feat(server): add description re-queue cost estimate endpoint"
```

### Task 4.4: Restructure `MachineLearningSettings.svelte` into tabs

**Files:**

- Modify: `web/src/routes/admin/system-settings/MachineLearningSettings.svelte`
- Create: `web/src/lib/components/admin-settings/PromptVocabularyTab.svelte`

**Note:** Read the current `MachineLearningSettings.svelte` carefully (614 lines) — it has multiple sections beyond image description (CLIP, facial recognition, OCR, NSFW). Image description is one of several. The tab structure proposed here is _only_ for the image-description card and its new sub-settings. Other settings remain as-is.

- [ ] **Step 1: Identify the image-description section in the current file**

Run: `grep -n "imageDescription\|Image description" web/src/routes/admin/system-settings/MachineLearningSettings.svelte`

- [ ] **Step 2: Wrap that section in a `<Tabs>` component**

Use Immich's existing tab component (find with `grep -rn "import.*Tabs" web/src/lib/components | head`). Approximate structure:

```svelte
<Tabs initial="model">
  <Tab id="model" label="Model">
    <!-- existing imageDescription model fields -->
  </Tab>
  <Tab id="prompt" label="Prompt & Vocabulary">
    <PromptVocabularyTab bind:prompt={imageDescription.prompt} {disabled} {savedPrompt} />
  </Tab>
</Tabs>
```

- [ ] **Step 3: Implement `PromptVocabularyTab.svelte`**

```svelte
<script lang="ts">
  import SettingDropdown from '$lib/components/shared-components/settings/SettingDropdown.svelte';
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import SettingAccordion from '$lib/components/shared-components/settings/SettingAccordion.svelte';
  import ChipInput from '$lib/components/shared-components/ChipInput.svelte';
  import type { ImageDescriptionPromptConfigDto } from '@immich/sdk';

  interface Props {
    prompt: ImageDescriptionPromptConfigDto;
    savedPrompt: ImageDescriptionPromptConfigDto;
    disabled: boolean;
  }

  let { prompt = $bindable(), savedPrompt, disabled }: Props = $props();
</script>

<SettingDropdown
  label="Style"
  bind:value={prompt.style}
  options={[
    { value: 'terse', text: 'Terse — single sentence' },
    { value: 'balanced', text: 'Balanced — 2–3 sentences' },
    { value: 'rich', text: 'Rich — 3–5 sentences with mood, season, context' },
  ]}
  {disabled}
  isEdited={prompt.style !== savedPrompt.style}
/>

<SettingInputField
  label="Sentence count target"
  bind:value={prompt.sentenceCountTarget}
  type="number"
  min={1}
  max={6}
  {disabled}
  isEdited={prompt.sentenceCountTarget !== savedPrompt.sentenceCountTarget}
/>

<ChipInput label="Look for" bind:values={prompt.lookFor} {disabled} placeholder="brands, sports equipment, landmarks…" />

<ChipInput label="Custom tag vocabulary" bind:values={prompt.customVocabulary} {disabled} placeholder="prescription-bottle, surfboard…" />

<SettingAccordion title="NSFW indicators" collapsedDefault>
  <ChipInput bind:values={prompt.nsfwIndicators} {disabled} />
</SettingAccordion>

<SettingAccordion title="Medical indicators" collapsedDefault>
  <ChipInput bind:values={prompt.medicalIndicators} {disabled} />
</SettingAccordion>

<ChipInput label="Forbidden inferences" bind:values={prompt.forbiddenInferences} {disabled} />

<SettingSwitch label="Inject names from face recognition" bind:checked={prompt.identityInjection.enabled} {disabled} />
<SettingInputField
  label="Max names per image"
  bind:value={prompt.identityInjection.maxNames}
  type="number"
  min={1}
  max={20}
  disabled={disabled || !prompt.identityInjection.enabled}
/>
<SettingInputField
  label="Minimum face-match confidence"
  bind:value={prompt.identityInjection.minFaceConfidence}
  type="number"
  step={0.05}
  min={0.5}
  max={1.0}
  disabled={disabled || !prompt.identityInjection.enabled}
/>

<SettingAccordion title="Advanced: raw prompt editor" collapsedDefault>
  <SettingSwitch label="Use raw prompt instead of structured fields" bind:checked={prompt.advanced.enabled} {disabled} />
  {#if prompt.advanced.enabled}
    <textarea
      class="font-mono w-full h-72 p-2 border"
      bind:value={prompt.advanced.rawPromptTemplate}
      disabled={disabled}
      placeholder="Use {names}, {schema}, {vocabulary}, {style_hint} placeholders"
    ></textarea>
    <SettingDropdown
      label="Placeholder validation"
      bind:value={prompt.advanced.placeholderValidation}
      options={[
        { value: 'strict', text: 'Strict — reject save if {schema} missing' },
        { value: 'warn', text: 'Warn — allow save with warning' },
      ]}
      {disabled}
    />
  {/if}
</SettingAccordion>
```

- [ ] **Step 4: Add cost-estimate modal**

Create `web/src/lib/components/admin-settings/CostEstimateModal.svelte`:

```svelte
<script lang="ts">
  import { getDescriptionRequeueEstimate, requeueAllDescriptions } from '@immich/sdk';

  interface Props {
    open: boolean;
    onClose: () => void;
    onConfirm: (action: 'now' | 'later' | 'never') => void;
  }
  let { open = $bindable(), onClose, onConfirm }: Props = $props();
  let estimate = $state<Awaited<ReturnType<typeof getDescriptionRequeueEstimate>> | null>(null);

  $effect(() => {
    if (open && !estimate) {
      getDescriptionRequeueEstimate().then((e) => (estimate = e));
    }
  });

  const hours = $derived(estimate ? Math.floor(estimate.estimatedTotalSeconds / 3600) : 0);
  const minutes = $derived(estimate ? Math.floor((estimate.estimatedTotalSeconds % 3600) / 60) : 0);
</script>

{#if open}
  <div role="dialog" aria-modal="true" class="modal">
    {#if !estimate}
      <p>Calculating…</p>
    {:else}
      <h2>Config change detected</h2>
      <dl>
        <dt>Assets in library</dt><dd>{estimate.totalAssets.toLocaleString()}</dd>
        <dt>With descriptions</dt><dd>{estimate.withDescription.toLocaleString()} (will be regenerated)</dd>
        <dt>Without descriptions</dt><dd>{estimate.withoutDescription.toLocaleString()} (will be queued)</dd>
        <dt>Active backend</dt><dd>{estimate.activeBackend} / {estimate.activeModel}</dd>
        <dt>Estimated time</dt><dd>~{hours}h {minutes}min</dd>
      </dl>
      <div class="actions">
        <button onclick={() => onConfirm('now')}>Re-queue now</button>
        <button onclick={() => onConfirm('later')}>Re-queue later</button>
        <button onclick={() => onConfirm('never')}>Save without re-queue</button>
        <button onclick={onClose}>Cancel save</button>
      </div>
    {/if}
  </div>
{/if}
```

- [ ] **Step 5: Wire the modal into the settings save flow**

In `MachineLearningSettings.svelte`, intercept the save handler: diff old vs new prompt/model config; if changed, open the modal and call `requeueAllDescriptions` based on the user's choice.

- [ ] **Step 6: Regenerate SDK types**

Run: `cd open-api && npm run generate` (or whatever the SDK regen command is — `grep -rn "generate" open-api/package.json | head`).

- [ ] **Step 7: Run web type-check and tests**

Run: `cd web && npm run check && npm test`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add web/ open-api/
git commit -m "feat(web): admin UI tabs for image description prompt + cost-estimate modal"
```

---

## PR 5 — Identity injection

**Goal:** Look up named faces for each asset before describing it, pass them into prompt assembly, and post-validate the description.

**Re-validation note:** Before starting, grep the codebase for face/person repositories — `grep -rn "PersonRepository\|FaceRepository" server/src/repositories/ | head`. The exact join from `asset → faces → named-person` may differ from what's sketched below.

### Task 5.1: Failing tests for `IdentityPostValidator`

**Files:**

- Test: `server/src/services/identity-post-validator.service.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
import { IdentityPostValidator } from 'src/services/identity-post-validator.service';
import { describe, it, expect } from 'vitest';

describe('IdentityPostValidator', () => {
  const v = new IdentityPostValidator();
  const conner = { name: 'Conner', faceConfidence: 0.95, boxCenter: [0.3, 0.5] as [number, number] };
  const sarah = { name: 'Sarah', faceConfidence: 0.92, boxCenter: [0.7, 0.5] as [number, number] };

  it('strips hallucinated names not in knownPersons', () => {
    const result = v.validate('Madison is playing baseball.', [conner]);
    expect(result.description).toBe('Someone is playing baseball.');
    expect(result.flags.hallucinatedNames).toContain('Madison');
  });

  it('passes through descriptions that already contain a known name', () => {
    const result = v.validate('Conner is playing baseball.', [conner]);
    expect(result.description).toBe('Conner is playing baseball.');
    expect(result.flags.hallucinatedNames).toBeUndefined();
  });

  it('substitutes single known person for unambiguous generic reference', () => {
    const result = v.validate('A young boy is playing baseball.', [conner]);
    expect(result.description).toMatch(/Conner/);
  });

  it('does not substitute when multiple known persons could match', () => {
    const result = v.validate('A child is playing baseball.', [conner, sarah]);
    expect(result.description).toMatch(/A child/);
    expect(result.flags.ambiguousReferences).toBeDefined();
  });

  it('never fabricates names beyond knownPersons list', () => {
    const result = v.validate('A young boy is playing baseball.', []);
    expect(result.description).toBe('A young boy is playing baseball.');
  });
});
```

- [ ] **Step 2: Run failing**

Run: `cd server && npx vitest run src/services/identity-post-validator.service.spec.ts`
Expected: FAIL — module not found.

### Task 5.2: Implement `IdentityPostValidator`

**Files:**

- Create: `server/src/services/identity-post-validator.service.ts`

- [ ] **Step 1: Implement**

```typescript
import { Injectable } from '@nestjs/common';
import type { KnownPerson } from 'src/services/prompt-assembler.service';

const GENERIC_PERSON_PATTERNS = [/\ba (young |older )?(boy|girl|man|woman|child|teenager|baby)\b/gi];

@Injectable()
export class IdentityPostValidator {
  validate(
    description: string,
    knownPersons: KnownPerson[],
  ): {
    description: string;
    flags: { hallucinatedNames?: string[]; ambiguousReferences?: string[] };
  } {
    const knownNames = new Set(knownPersons.map((p) => p.name));
    const flags: { hallucinatedNames?: string[]; ambiguousReferences?: string[] } = {};

    // Strip names that look like names but aren't in knownPersons.
    const namePattern = /\b[A-Z][a-z]+\b/g;
    const hallucinated: string[] = [];
    let result = description.replaceAll(namePattern, (match) => {
      if (knownNames.has(match)) return match;
      // Heuristic: only consider it a "name" if it's a capitalized non-sentence-start word.
      // Simple version: skip the first word of a sentence.
      const idx = description.indexOf(match);
      if (idx === 0 || ['.', '!', '?'].includes(description[idx - 2] ?? '')) return match;
      hallucinated.push(match);
      return 'Someone';
    });
    if (hallucinated.length > 0) flags.hallucinatedNames = hallucinated;

    // If description has no known names but has a generic person reference and exactly one
    // known person exists, substitute. (More robust position-matching is a future refinement.)
    const containsKnownName = [...knownNames].some((n) => result.includes(n));
    if (!containsKnownName) {
      const genericMatches = GENERIC_PERSON_PATTERNS.some((p) => p.test(result));
      if (genericMatches) {
        if (knownPersons.length === 1) {
          result = result.replaceAll(GENERIC_PERSON_PATTERNS[0], knownPersons[0].name);
        } else if (knownPersons.length > 1) {
          flags.ambiguousReferences = ['generic-person-with-multiple-known-faces'];
        }
      }
    }

    return { description: result, flags };
  }
}
```

- [ ] **Step 2: Run**

Run: `cd server && npx vitest run src/services/identity-post-validator.service.spec.ts`
Expected: PASS.

### Task 5.3: Wire face lookup into `image-enrichment.service.ts`

**Files:**

- Modify: `server/src/services/image-enrichment.service.ts:400-420` area (where `describeImage` is called)

- [ ] **Step 1: Find the face/person repo**

Run: `grep -rn "PersonRepository\|getFacesByAsset" server/src/repositories/ | head -10`

- [ ] **Step 2: Inject the repo into `ImageEnrichmentService`**

Add the dependency in the constructor.

- [ ] **Step 3: Look up named faces before `describeImage`**

```typescript
const faces = await this.personRepository.getNamedFacesForAsset(asset.id);
const knownPersons = faces.map((f) => ({
  name: f.personName,
  faceConfidence: f.confidence ?? 1.0,
  boxCenter: [(f.boxX1 + f.boxX2) / 2 / asset.exifInfo.width, (f.boxY1 + f.boxY2) / 2 / asset.exifInfo.height] as [
    number,
    number,
  ],
}));

const { prompt } = this.promptAssembler.build({
  config: machineLearning.imageDescription.prompt,
  knownPersons,
});

result = await this.machineLearningRepository.describeImage(imagePath, machineLearning.imageDescription, nsfw, prompt);

const validated = this.identityPostValidator.validate(result.description, knownPersons);
result = { ...result, description: validated.description };
if (validated.flags.hallucinatedNames || validated.flags.ambiguousReferences) {
  // attach to metadata for diagnostics
  metadata.description.identityFlags = validated.flags;
}
```

- [ ] **Step 4: Add `getNamedFacesForAsset` to the person repo**

Approximate SQL:

```sql
SELECT p.name AS person_name, f.confidence, f.box_x1, f.box_y1, f.box_x2, f.box_y2
FROM asset_faces f
JOIN people p ON p.id = f.person_id
WHERE f.asset_id = $1 AND p.name IS NOT NULL AND p.name <> '';
```

- [ ] **Step 5: Extend the image-enrichment spec to verify identity injection**

Add an integration-style test that mocks 1, 2, and 0 known persons and verifies the prompt was assembled with them and the description was validated.

- [ ] **Step 6: Run server tests**

Run: `cd server && npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/identity-post-validator.service.ts server/src/services/identity-post-validator.service.spec.ts server/src/services/image-enrichment.service.ts server/src/repositories/person.repository.ts
git commit -m "feat(server): inject named faces into description prompt and post-validate"
```

---

## PR 6 — Smart album tables + service

**Goal:** Database tables for smart albums, repository, and service that evaluates assets after each successful description.

### Task 6.1: Kysely migration

**Files:**

- Create: `server/src/schema/migrations/<timestamp>-CreateSmartAlbumTables.ts`
- Create: `server/src/schema/tables/smart-album.table.ts`
- Create: `server/src/schema/tables/smart-album-asset.table.ts`
- Create: `server/src/schema/tables/smart-album-exclusion.table.ts`

- [ ] **Step 1: Read an existing migration for the conventions**

Run: `cat server/src/schema/migrations/1778900000000-CreateAssetHealthTables.ts`

- [ ] **Step 2: Generate a timestamp prefix and create migration**

```bash
ts=$(date +%s%3N)
touch server/src/schema/migrations/${ts}-CreateSmartAlbumTables.ts
```

Contents:

```typescript
import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('smart_album')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(db.fn('gen_random_uuid')))
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('owner_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('album_id', 'uuid', (col) => col.notNull().references('albums.id').onDelete('cascade'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn('now')))
    .addUniqueConstraint('smart_album_owner_kind_unique', ['owner_id', 'kind'])
    .execute();

  await db.schema
    .createTable('smart_album_asset')
    .addColumn('smart_album_id', 'uuid', (col) => col.notNull().references('smart_album.id').onDelete('cascade'))
    .addColumn('asset_id', 'uuid', (col) => col.notNull().references('assets.id').onDelete('cascade'))
    .addColumn('added_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn('now')))
    .addColumn('match_reason', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('smart_album_asset_pk', ['smart_album_id', 'asset_id'])
    .execute();

  await db.schema
    .createTable('smart_album_exclusion')
    .addColumn('smart_album_id', 'uuid', (col) => col.notNull().references('smart_album.id').onDelete('cascade'))
    .addColumn('asset_id', 'uuid', (col) => col.notNull().references('assets.id').onDelete('cascade'))
    .addPrimaryKeyConstraint('smart_album_exclusion_pk', ['smart_album_id', 'asset_id'])
    .execute();

  await db.schema.createIndex('smart_album_owner_idx').on('smart_album').column('owner_id').execute();
  await db.schema.createIndex('smart_album_asset_asset_idx').on('smart_album_asset').column('asset_id').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('smart_album_exclusion').execute();
  await db.schema.dropTable('smart_album_asset').execute();
  await db.schema.dropTable('smart_album').execute();
}
```

- [ ] **Step 3: Add table type files** mirroring existing patterns in `server/src/schema/tables/`.

- [ ] **Step 4: Run the migration locally**

Run: `cd server && npm run typeorm migration:run` (or whatever Immich uses — check `package.json`).
Expected: migration applies cleanly.

- [ ] **Step 5: Commit**

```bash
git add server/src/schema/migrations server/src/schema/tables server/src/schema/index.ts
git commit -m "feat(server): migrations + tables for smart albums"
```

### Task 6.2: `SmartAlbumService`

**Files:**

- Create: `server/src/services/smart-album.service.ts`
- Create: `server/src/services/smart-album.service.spec.ts`
- Create: `server/src/repositories/smart-album.repository.ts`

- [ ] **Step 1: Write the spec**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SmartAlbumService } from 'src/services/smart-album.service';

const config = {
  enabled: true,
  builtIn: {
    travel: { enabled: true, name: 'Travel', tagTriggers: ['beach'], clipQueries: ['vacation'], threshold: 0.3 },
    documents: {
      enabled: true,
      name: 'Docs',
      tagTriggers: ['receipt'],
      clipQueries: ['paper document'],
      threshold: 0.3,
    },
    screenshots: { enabled: false, name: 'Screenshots', tagTriggers: [], clipQueries: [], threshold: 0.3 },
    food: { enabled: false, name: 'Food', tagTriggers: [], clipQueries: [], threshold: 0.3 },
    pets: { enabled: false, name: 'Pets', tagTriggers: [], clipQueries: [], threshold: 0.3 },
    nature: { enabled: false, name: 'Nature', tagTriggers: [], clipQueries: [], threshold: 0.3 },
  },
};

describe('SmartAlbumService', () => {
  let repo: any;
  let clipRepo: any;
  let configService: any;
  let service: SmartAlbumService;

  beforeEach(() => {
    repo = {
      getSmartAlbumIdForOwnerAndKind: vi.fn().mockResolvedValue('sa1'),
      addAssetToSmartAlbum: vi.fn().mockResolvedValue(undefined),
      removeAssetFromSmartAlbum: vi.fn().mockResolvedValue(undefined),
      isExcluded: vi.fn().mockResolvedValue(false),
      getMatchingKinds: vi.fn().mockResolvedValue([]),
    };
    clipRepo = { cosineSimilarity: vi.fn().mockResolvedValue(0.1) };
    configService = { getConfig: vi.fn().mockResolvedValue({ smartAlbums: config }) };
    service = new SmartAlbumService(repo, clipRepo, configService);
  });

  it('adds asset to travel when tag matches', async () => {
    await service.evaluate({ assetId: 'a1', ownerId: 'u1', tags: ['beach', 'sunset'] });
    expect(repo.addAssetToSmartAlbum).toHaveBeenCalledWith('sa1', 'a1', 'tag');
  });

  it('skips when asset is excluded', async () => {
    repo.isExcluded.mockResolvedValue(true);
    await service.evaluate({ assetId: 'a1', ownerId: 'u1', tags: ['beach'] });
    expect(repo.addAssetToSmartAlbum).not.toHaveBeenCalled();
  });

  it('uses CLIP similarity when no tag matches', async () => {
    clipRepo.cosineSimilarity.mockResolvedValue(0.4);
    await service.evaluate({ assetId: 'a1', ownerId: 'u1', tags: [] });
    expect(repo.addAssetToSmartAlbum).toHaveBeenCalledWith('sa1', 'a1', 'clip');
  });

  it('removes asset from album when match no longer holds', async () => {
    repo.getMatchingKinds.mockResolvedValue(['travel']); // currently in travel
    await service.evaluate({ assetId: 'a1', ownerId: 'u1', tags: [] }); // no tag, low CLIP
    expect(repo.removeAssetFromSmartAlbum).toHaveBeenCalledWith('sa1', 'a1');
  });

  it('is idempotent on repeated evaluation', async () => {
    await service.evaluate({ assetId: 'a1', ownerId: 'u1', tags: ['beach'] });
    await service.evaluate({ assetId: 'a1', ownerId: 'u1', tags: ['beach'] });
    expect(repo.addAssetToSmartAlbum).toHaveBeenCalledTimes(2);
    // The repo's addAssetToSmartAlbum is responsible for ON CONFLICT DO NOTHING semantics.
  });

  it('skips evaluation entirely when master smart-albums toggle is off', async () => {
    configService.getConfig.mockResolvedValue({ smartAlbums: { ...config, enabled: false } });
    await service.evaluate({ assetId: 'a1', ownerId: 'u1', tags: ['beach'] });
    expect(repo.addAssetToSmartAlbum).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import { Injectable } from '@nestjs/common';

interface EvaluateInput {
  assetId: string;
  ownerId: string;
  tags: string[];
}
type Kind = 'travel' | 'documents' | 'screenshots' | 'food' | 'pets' | 'nature';

@Injectable()
export class SmartAlbumService {
  constructor(
    private repo: any,
    private clipRepo: any,
    private configService: any,
  ) {}

  async evaluate(input: EvaluateInput): Promise<void> {
    const { smartAlbums } = await this.configService.getConfig();
    if (!smartAlbums.enabled) return;

    const currentKinds = new Set<Kind>(await this.repo.getMatchingKinds(input.assetId, input.ownerId));
    const matchedKinds = new Set<Kind>();

    for (const kind of Object.keys(smartAlbums.builtIn) as Kind[]) {
      const ruleset = smartAlbums.builtIn[kind];
      if (!ruleset.enabled) continue;

      const albumId = await this.repo.getSmartAlbumIdForOwnerAndKind(input.ownerId, kind);
      if (!albumId) continue;
      if (await this.repo.isExcluded(albumId, input.assetId)) continue;

      const tagHit = ruleset.tagTriggers.some((t: string) => input.tags.includes(t));
      let clipHit = false;
      if (!tagHit && ruleset.clipQueries.length > 0) {
        const max = await Promise.all(
          ruleset.clipQueries.map((q: string) => this.clipRepo.cosineSimilarity(input.assetId, q)),
        ).then((vals) => Math.max(...vals));
        clipHit = max >= ruleset.threshold;
      }

      if (tagHit || clipHit) {
        await this.repo.addAssetToSmartAlbum(
          albumId,
          input.assetId,
          tagHit && clipHit ? 'both' : tagHit ? 'tag' : 'clip',
        );
        matchedKinds.add(kind);
      }
    }

    // Removal: anything currently in but not matched anymore
    for (const kind of currentKinds) {
      if (!matchedKinds.has(kind)) {
        const albumId = await this.repo.getSmartAlbumIdForOwnerAndKind(input.ownerId, kind);
        if (albumId) await this.repo.removeAssetFromSmartAlbum(albumId, input.assetId);
      }
    }
  }
}
```

- [ ] **Step 3: Implement repo**

`server/src/repositories/smart-album.repository.ts` — straightforward Kysely queries. Use `ON CONFLICT DO NOTHING` for `addAssetToSmartAlbum`.

- [ ] **Step 4: First-run smart-album creation**

In the startup service (find with `grep -rn "OnApplicationBootstrap\|onModuleInit" server/src/services/ | head`), add logic: for each user, if no `smart_album` row exists for any kind, create the six albums (one per kind) backed by a regular album row named per `config.smartAlbums.builtIn[kind].name`.

- [ ] **Step 5: Hook into `image-enrichment.service.ts`**

After tag application succeeds, call `SmartAlbumService.evaluate({ assetId, ownerId, tags })`.

- [ ] **Step 6: Run tests**

Run: `cd server && npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/smart-album.service.ts server/src/services/smart-album.service.spec.ts server/src/repositories/smart-album.repository.ts server/src/services/image-enrichment.service.ts
git commit -m "feat(server): smart-album evaluation triggered by description completion"
```

### Task 6.3: Medium-test smart album end-to-end

**Files:**

- Create: `server/test/medium/specs/smart-album.spec.ts`

- [ ] **Step 1: Write end-to-end test**

Following existing medium-test patterns in `server/test/medium/specs/`, create a test that:

1. Inserts a user, an asset with tags `['beach','sunset']`, and a config with smart-albums enabled.
2. Calls `SmartAlbumService.evaluate`.
3. Asserts a `smart_album_asset` row exists for the travel album.
4. Mutates the asset to have tags `['indoor']` and re-evaluates.
5. Asserts the row is removed.

- [ ] **Step 2: Run**

Run: `cd server && npm run test:medium`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/test/medium/specs/smart-album.spec.ts
git commit -m "test(server): medium-test for smart-album end-to-end"
```

---

## PR 7 — Admin UI: Smart Albums tab + re-evaluation job

**Goal:** Tab 3 of the ML settings — admin UI for editing smart-album rules. Bulk re-evaluation job that re-applies new rules to all assets without re-describing.

### Task 7.1: `ReevaluateSmartAlbumsJob`

**Files:**

- Create: `server/src/jobs/reevaluate-smart-albums.job.ts`
- Create: `server/src/jobs/reevaluate-smart-albums.job.spec.ts`

- [ ] **Step 1: Implement**

Mirror the structure of `RequeueDescriptionsJob` but call `SmartAlbumService.evaluate` per asset instead of queueing a description job. Uses pre-computed tag and CLIP embedding data already in the asset record — no ML inference required.

```typescript
@Injectable()
export class ReevaluateSmartAlbumsJob {
  constructor(
    private assetRepo: any,
    private smartAlbumService: SmartAlbumService,
  ) {}

  async run(): Promise<void> {
    for await (const { assetId, ownerId, tags } of this.assetRepo.streamAssetsForSmartAlbumReevaluation()) {
      await this.smartAlbumService.evaluate({ assetId, ownerId, tags });
    }
  }
}
```

- [ ] **Step 2: Wire to a controller endpoint**

`POST /admin/system-config/reevaluate-smart-albums` triggers the job.

- [ ] **Step 3: Test + commit**

```bash
cd server && npx vitest run src/jobs/reevaluate-smart-albums.job.spec.ts
git add server/src/jobs/reevaluate-smart-albums.job.ts server/src/jobs/reevaluate-smart-albums.job.spec.ts server/src/controllers/system-config.controller.ts
git commit -m "feat(server): reevaluate smart albums job and endpoint"
```

### Task 7.2: `SmartAlbumsTab.svelte`

**Files:**

- Create: `web/src/lib/components/admin-settings/SmartAlbumsTab.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import ChipInput from '$lib/components/shared-components/ChipInput.svelte';
  import type { SystemConfigSmartAlbumsDto } from '@immich/sdk';
  import { reevaluateSmartAlbums, testCLIPQuery } from '@immich/sdk';

  interface Props {
    smartAlbums: SystemConfigSmartAlbumsDto;
    disabled: boolean;
  }
  let { smartAlbums = $bindable(), disabled }: Props = $props();

  const KINDS = ['travel','documents','screenshots','food','pets','nature'] as const;
</script>

<SettingSwitch label="Enable smart auto-albums" bind:checked={smartAlbums.enabled} {disabled} />

{#each KINDS as kind}
  {@const album = smartAlbums.builtIn[kind]}
  <div class="album-card">
    <SettingSwitch label="Enabled" bind:checked={album.enabled} disabled={disabled || !smartAlbums.enabled} />
    <SettingInputField label="Album name" bind:value={album.name} disabled={disabled || !album.enabled} />
    <ChipInput label="Tag triggers" bind:values={album.tagTriggers} disabled={disabled || !album.enabled} />
    <ChipInput label="CLIP queries" bind:values={album.clipQueries} disabled={disabled || !album.enabled} />
    <SettingInputField
      label="CLIP similarity threshold"
      bind:value={album.threshold}
      type="number"
      step={0.01}
      min={0.20}
      max={0.40}
      disabled={disabled || !album.enabled}
    />
    <button onclick={() => testCLIPQuery({ queries: album.clipQueries, threshold: album.threshold })}>
      Test query (show top 10 matches)
    </button>
  </div>
{/each}

<button onclick={() => reevaluateSmartAlbums()}>Re-evaluate all assets against current rules</button>
```

- [ ] **Step 2: Add the `testCLIPQuery` endpoint server-side**

`POST /admin/system-config/test-clip-query` — returns top 10 assets by similarity to provided phrases.

- [ ] **Step 3: Wire tab into `MachineLearningSettings.svelte`**

- [ ] **Step 4: Regen SDK + run web tests + commit**

```bash
cd open-api && npm run generate
cd web && npm run check && npm test
git add web/ open-api/
git commit -m "feat(web): smart albums admin tab + test-CLIP-query endpoint"
```

### Task 7.3: User-facing "exclude from smart album" action

**Files:**

- Modify: an asset-detail or album-asset Svelte component where right-click / overflow menu actions live.
- Modify: `server/src/controllers/album.controller.ts` (or smart-album controller) — add endpoint.
- Modify: `server/src/repositories/smart-album.repository.ts` — add `excludeAsset`.

The exclusion table (`smart_album_exclusion`) was created in PR 6. This task wires the UI.

- [ ] **Step 1: Server endpoint**

`POST /smart-albums/:smartAlbumId/exclusions` with body `{ assetId }`. Inserts into `smart_album_exclusion`, removes from `smart_album_asset` if present.

- [ ] **Step 2: Repository method**

```typescript
async excludeAsset(smartAlbumId: string, assetId: string): Promise<void> {
  await this.db.transaction().execute(async (tx) => {
    await tx.insertInto('smart_album_exclusion')
      .values({ smart_album_id: smartAlbumId, asset_id: assetId })
      .onConflict((oc) => oc.doNothing())
      .execute();
    await tx.deleteFrom('smart_album_asset')
      .where('smart_album_id', '=', smartAlbumId)
      .where('asset_id', '=', assetId)
      .execute();
  });
}
```

- [ ] **Step 3: UI menu item**

In the asset overflow menu component, when the current view is a smart album, add a "Remove from this album (permanent)" action that calls the endpoint.

- [ ] **Step 4: Test + commit**

```bash
cd server && npm test
cd web && npm run check && npm test
git add server/ web/ open-api/
git commit -m "feat: user can exclude asset from smart album"
```

---

## PR 8 — Admin UI: Status & Regeneration tab + persistent banner

**Goal:** Tab 4 surfacing description-pipeline stats, per-kind re-evaluation buttons, and the "re-queue later" banner that persists until acted on.

### Task 8.1: `StatusRegenerationTab.svelte`

**Files:**

- Create: `web/src/lib/components/admin-settings/StatusRegenerationTab.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import { getDescriptionStats, requeueAllDescriptions } from '@immich/sdk';
  import { onMount } from 'svelte';

  let stats = $state<Awaited<ReturnType<typeof getDescriptionStats>> | null>(null);
  onMount(async () => { stats = await getDescriptionStats(); });
</script>

{#if stats}
  <dl>
    <dt>Total assets</dt><dd>{stats.totalAssets}</dd>
    <dt>With descriptions</dt><dd>{stats.withDescription}</dd>
    <dt>Pending</dt><dd>{stats.pending}</dd>
    <dt>Last config change</dt><dd>{stats.lastConfigChangeAt ?? '—'}</dd>
  </dl>
  <button onclick={() => requeueAllDescriptions()}>Re-queue all descriptions</button>
{/if}
```

- [ ] **Step 2: Add `getDescriptionStats` server endpoint** with the obvious SQL counts.

### Task 8.2: Pending re-queue banner

**Files:**

- Modify: `web/src/routes/admin/system-settings/MachineLearningSettings.svelte`

- [ ] **Step 1: Read `pendingRequeueAt` from config**

If `config.machineLearning.imageDescription.pendingRequeueAt` is set and not yet acted on, render a banner at the top of the page: _"Config changed at {timestamp}. {N} assets queued for re-description. [Re-queue now]"_.

- [ ] **Step 2: Add `pendingRequeueAt` to config**

Modify `model-config.dto.ts` to add `pendingRequeueAt: z.string().nullable().default(null)` on `ImageDescriptionConfigSchema`. Set it when admin picks "Re-queue later" in the cost modal; clear it when the job actually runs.

- [ ] **Step 3: Run tests + commit**

```bash
cd open-api && npm run generate
cd web && npm run check && npm test
cd server && npm test
git add server/ web/ open-api/
git commit -m "feat: status + regeneration admin tab with persistent banner"
```

---

## Final integration sanity

After PR 8 is merged:

- [ ] **Step 1: Run full server suite**

Run: `cd server && npm test`
Expected: all PASS.

- [ ] **Step 2: Run full ML suite**

Run: `cd machine-learning && uv run pytest`
Expected: all PASS.

- [ ] **Step 3: Run full web suite**

Run: `cd web && npm run check && npm test`
Expected: all PASS.

- [ ] **Step 4: Spin up the stack and smoke-test in the browser**

Run: `make dev` (or whatever the dev command is — check `Makefile`).
Manually verify:

- Admin → ML settings shows four tabs.
- Editing the prompt style triggers the cost-estimate modal on save.
- A re-queued asset gets a fresh description with the new prompt.
- A photo of a named person produces a description containing that name.
- Travel/Documents/Screenshots/Food/Pets/Nature albums populate as descriptions complete.
- Excluding an asset from a smart album persists across re-evaluation.

---

## Self-review notes

This is a large plan covering an 8-PR feature. Quirks worth flagging for the executor:

- **PR-4 onwards depends on Immich's job framework**, which the plan stubs as `JobRepoLike`. Adapt to the actual BullMQ/Bull/custom-queue API in the codebase before implementing.
- **PR-5's face lookup** assumes column names (`box_x1`/`box_y1`/`asset_id`) typical of face-detection schemas; verify against `server/src/schema/tables/` before writing the SQL.
- **PR-6 ON CONFLICT DO NOTHING** is the key idempotency mechanism — make sure the repo uses it on `smart_album_asset` insert.
- **PR-7's `testCLIPQuery` endpoint** can lean on Immich's existing smart-search infrastructure (which already does CLIP cosine-similarity queries). Don't reinvent.
- **The cost-estimate modal in PR-4** depends on `rollingAvgSeconds` job stats. If that telemetry doesn't yet exist in Immich, fall back to a static estimate constant for v1 and add a TODO to measure.
- **Florence-2 detection** in the admin UI: when admin selects a Florence model, the Prompt & Vocabulary tab should show a banner: _"Florence-2 models don't support prompt customization. Switch to a Qwen or Phi model to use these options."_ Add this in PR 4.

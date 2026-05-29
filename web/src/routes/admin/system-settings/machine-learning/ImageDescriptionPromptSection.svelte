<script lang="ts">
  import SettingAccordion from '$lib/components/shared-components/settings/SettingAccordion.svelte';
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import { SettingInputFieldType } from '$lib/constants';
  import { serverConfigManager } from '$lib/managers/server-config-manager.svelte';
  import { PlaceholderValidation, Style, type ImageDescriptionConfig } from '@immich/sdk';
  import { Button } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import SettingSelect from '../SettingSelect.svelte';
  import SettingTextarea from '../SettingTextarea.svelte';
  import { parseLines } from './machine-learning-helpers';

  interface Props {
    imageDescription: ImageDescriptionConfig;
    savedImageDescription: ImageDescriptionConfig;
    workingMlEnabled: boolean;
    disabled: boolean;
  }

  let { imageDescription, savedImageDescription, workingMlEnabled, disabled }: Props = $props();

  // List-type prompt fields are displayed as newline-joined text and parsed back on input.
  // Using $derived ensures the textareas always reflect the live config — including
  // after a Reset (which replaces configToEdit wholesale via SystemConfigButtonRow).
  const lookForText = $derived((imageDescription.prompt?.lookFor ?? []).join('\n'));
  const customVocabularyText = $derived((imageDescription.prompt?.customVocabulary ?? []).join('\n'));
  const nsfwIndicatorsText = $derived((imageDescription.prompt?.nsfwIndicators ?? []).join('\n'));
  const medicalIndicatorsText = $derived((imageDescription.prompt?.medicalIndicators ?? []).join('\n'));
  const forbiddenInferencesText = $derived((imageDescription.prompt?.forbiddenInferences ?? []).join('\n'));
  const rawPromptTemplateText = $derived(imageDescription.prompt?.advanced?.rawPromptTemplate ?? '');
</script>

<SettingAccordion
  key="image-description-prompt"
  title={$t('admin.machine_learning_image_description_prompt')}
  subtitle={$t('admin.machine_learning_image_description_prompt_description')}
>
  <div class="ms-4 mt-4 flex flex-col gap-4">
    <SettingSelect
      label={$t('admin.machine_learning_image_description_style')}
      desc={$t('admin.machine_learning_image_description_style_description')}
      name="image-description-style"
      bind:value={imageDescription.prompt!.style}
      options={[
        { value: Style.Terse, text: $t('admin.machine_learning_image_description_style_terse') },
        { value: Style.Balanced, text: $t('admin.machine_learning_image_description_style_balanced') },
        { value: Style.Rich, text: $t('admin.machine_learning_image_description_style_rich') },
      ]}
      disabled={disabled || !workingMlEnabled || !imageDescription.enabled}
      isEdited={imageDescription.prompt?.style !== savedImageDescription.prompt?.style}
    />

    <SettingInputField
      inputType={SettingInputFieldType.NUMBER}
      label={$t('admin.machine_learning_image_description_sentence_count')}
      description={$t('admin.machine_learning_image_description_sentence_count_description')}
      bind:value={imageDescription.prompt!.sentenceCountTarget}
      step="1"
      min={1}
      max={6}
      disabled={disabled || !workingMlEnabled || !imageDescription.enabled}
      isEdited={imageDescription.prompt?.sentenceCountTarget !== savedImageDescription.prompt?.sentenceCountTarget}
    />

    <SettingTextarea
      label={$t('admin.machine_learning_image_description_look_for')}
      description={$t('admin.machine_learning_image_description_look_for_description')}
      value={lookForText}
      onChange={(text) => (imageDescription.prompt!.lookFor = parseLines(text))}
      disabled={disabled || !workingMlEnabled || !imageDescription.enabled}
      isEdited={JSON.stringify(imageDescription.prompt?.lookFor) !==
        JSON.stringify(savedImageDescription.prompt?.lookFor)}
    />

    <SettingTextarea
      label={$t('admin.machine_learning_image_description_custom_vocabulary')}
      description={$t('admin.machine_learning_image_description_custom_vocabulary_description')}
      value={customVocabularyText}
      onChange={(text) => (imageDescription.prompt!.customVocabulary = parseLines(text))}
      disabled={disabled || !workingMlEnabled || !imageDescription.enabled}
      isEdited={JSON.stringify(imageDescription.prompt?.customVocabulary) !==
        JSON.stringify(savedImageDescription.prompt?.customVocabulary)}
    />

    <SettingTextarea
      label={$t('admin.machine_learning_image_description_custom_instructions')}
      description={$t('admin.machine_learning_image_description_custom_instructions_description')}
      value={imageDescription.prompt?.customInstructions ?? ''}
      onChange={(text) => (imageDescription.prompt!.customInstructions = text)}
      disabled={disabled || !workingMlEnabled || !imageDescription.enabled}
      isEdited={(imageDescription.prompt?.customInstructions ?? '') !==
        (savedImageDescription.prompt?.customInstructions ?? '')}
    />

    <SettingTextarea
      label={$t('admin.machine_learning_image_description_forbidden_inferences')}
      description={$t('admin.machine_learning_image_description_forbidden_inferences_description')}
      value={forbiddenInferencesText}
      onChange={(text) => (imageDescription.prompt!.forbiddenInferences = parseLines(text))}
      disabled={disabled || !workingMlEnabled || !imageDescription.enabled}
      isEdited={JSON.stringify(imageDescription.prompt?.forbiddenInferences) !==
        JSON.stringify(savedImageDescription.prompt?.forbiddenInferences)}
    />

    <SettingAccordion
      key="image-description-nsfw-indicators"
      title={$t('admin.machine_learning_image_description_nsfw_indicators')}
      subtitle={$t('admin.machine_learning_image_description_nsfw_indicators_description')}
    >
      <div class="ms-4 mt-4">
        <SettingTextarea
          label={$t('admin.machine_learning_image_description_nsfw_indicators')}
          value={nsfwIndicatorsText}
          onChange={(text) => (imageDescription.prompt!.nsfwIndicators = parseLines(text))}
          disabled={disabled || !workingMlEnabled || !imageDescription.enabled}
          isEdited={JSON.stringify(imageDescription.prompt?.nsfwIndicators) !==
            JSON.stringify(savedImageDescription.prompt?.nsfwIndicators)}
        />
      </div>
    </SettingAccordion>

    <SettingAccordion
      key="image-description-medical-indicators"
      title={$t('admin.machine_learning_image_description_medical_indicators')}
      subtitle={$t('admin.machine_learning_image_description_medical_indicators_description')}
    >
      <div class="ms-4 mt-4">
        <SettingTextarea
          label={$t('admin.machine_learning_image_description_medical_indicators')}
          value={medicalIndicatorsText}
          onChange={(text) => (imageDescription.prompt!.medicalIndicators = parseLines(text))}
          disabled={disabled || !workingMlEnabled || !imageDescription.enabled}
          isEdited={JSON.stringify(imageDescription.prompt?.medicalIndicators) !==
            JSON.stringify(savedImageDescription.prompt?.medicalIndicators)}
        />
      </div>
    </SettingAccordion>

    <SettingAccordion
      key="image-description-identity-injection"
      title={$t('admin.machine_learning_image_description_identity_injection')}
      subtitle={$t('admin.machine_learning_image_description_identity_injection_description')}
    >
      <div class="ms-4 mt-4 flex flex-col gap-4">
        <SettingSwitch
          title={$t('admin.machine_learning_image_description_identity_injection_enabled')}
          bind:checked={imageDescription.prompt!.identityInjection!.enabled}
          disabled={disabled || !workingMlEnabled || !imageDescription.enabled}
          isEdited={imageDescription.prompt?.identityInjection?.enabled !==
            savedImageDescription.prompt?.identityInjection?.enabled}
        />

        <SettingInputField
          inputType={SettingInputFieldType.NUMBER}
          label={$t('admin.machine_learning_image_description_identity_injection_max_names')}
          description={$t('admin.machine_learning_image_description_identity_injection_max_names_description')}
          bind:value={imageDescription.prompt!.identityInjection!.maxNames}
          step="1"
          min={1}
          max={20}
          disabled={disabled ||
            !workingMlEnabled ||
            !imageDescription.enabled ||
            !imageDescription.prompt?.identityInjection?.enabled}
          isEdited={imageDescription.prompt?.identityInjection?.maxNames !==
            savedImageDescription.prompt?.identityInjection?.maxNames}
        />

        <SettingInputField
          inputType={SettingInputFieldType.NUMBER}
          label={$t('admin.machine_learning_image_description_identity_injection_min_confidence')}
          description={$t('admin.machine_learning_image_description_identity_injection_min_confidence_description')}
          bind:value={imageDescription.prompt!.identityInjection!.minFaceConfidence}
          step="0.05"
          min={0}
          max={1}
          disabled={disabled ||
            !workingMlEnabled ||
            !imageDescription.enabled ||
            !imageDescription.prompt?.identityInjection?.enabled}
          isEdited={imageDescription.prompt?.identityInjection?.minFaceConfidence !==
            savedImageDescription.prompt?.identityInjection?.minFaceConfidence}
        />
      </div>
    </SettingAccordion>

    <SettingAccordion
      key="image-description-advanced"
      title={$t('admin.machine_learning_image_description_advanced')}
      subtitle={$t('admin.machine_learning_image_description_advanced_description')}
    >
      <div class="ms-4 mt-4 flex flex-col gap-4">
        <SettingSwitch
          title={$t('admin.machine_learning_image_description_advanced_enabled')}
          checked={imageDescription.prompt?.advanced?.enabled ?? false}
          onToggle={(next) => {
            imageDescription.prompt!.advanced!.enabled = next;
            // Pre-fill from the server-provided default template the
            // first time advanced mode is enabled, so admins have a
            // working starting point instead of an empty box. Only
            // fires when the textarea is empty — never clobbers
            // existing edits.
            if (next && !imageDescription.prompt!.advanced!.rawPromptTemplate) {
              imageDescription.prompt!.advanced!.rawPromptTemplate =
                serverConfigManager.value.defaultImageDescriptionRawPromptTemplate;
            }
          }}
          disabled={disabled || !workingMlEnabled || !imageDescription.enabled}
          isEdited={imageDescription.prompt?.advanced?.enabled !== savedImageDescription.prompt?.advanced?.enabled}
        />

        {#if imageDescription.prompt?.advanced?.enabled}
          <SettingTextarea
            label={$t('admin.machine_learning_image_description_advanced_raw_prompt')}
            description={$t('admin.machine_learning_image_description_advanced_raw_prompt_description')}
            value={rawPromptTemplateText}
            onChange={(text) => (imageDescription.prompt!.advanced!.rawPromptTemplate = text)}
            disabled={disabled || !workingMlEnabled || !imageDescription.enabled}
            isEdited={imageDescription.prompt?.advanced?.rawPromptTemplate !==
              savedImageDescription.prompt?.advanced?.rawPromptTemplate}
          />

          <Button
            size="small"
            color="secondary"
            disabled={disabled || !workingMlEnabled || !imageDescription.enabled}
            onclick={() =>
              (imageDescription.prompt!.advanced!.rawPromptTemplate =
                serverConfigManager.value.defaultImageDescriptionRawPromptTemplate)}
          >
            {$t('admin.machine_learning_image_description_advanced_reset_to_default')}
          </Button>

          <SettingSelect
            label={$t('admin.machine_learning_image_description_advanced_placeholder_validation')}
            name="image-description-placeholder-validation"
            bind:value={imageDescription.prompt!.advanced!.placeholderValidation}
            options={[
              {
                value: PlaceholderValidation.Strict,
                text: $t('admin.machine_learning_image_description_advanced_placeholder_validation_strict'),
              },
              {
                value: PlaceholderValidation.Warn,
                text: $t('admin.machine_learning_image_description_advanced_placeholder_validation_warn'),
              },
            ]}
            disabled={disabled || !workingMlEnabled || !imageDescription.enabled}
            isEdited={imageDescription.prompt?.advanced?.placeholderValidation !==
              savedImageDescription.prompt?.advanced?.placeholderValidation}
          />
        {/if}
      </div>
    </SettingAccordion>
  </div>
</SettingAccordion>

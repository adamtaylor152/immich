from __future__ import annotations

import os
import re
import threading
from pathlib import Path
from typing import Any, cast

import numpy as np
import orjson
from huggingface_hub import snapshot_download
from PIL import Image

from immich_ml.config import log
from immich_ml.models.base import InferenceModel
from immich_ml.schemas import ImageDescriptionAcceleration, ModelTask, ModelType

# KEEP IN SYNC WITH: server/src/services/prompt-assembler.service.ts (JSON_SCHEMA_BLOCK)
IMAGE_DESCRIPTION_PROMPT = """You are generating a concise searchable image record from computer vision outputs.

Use only visible evidence from the image. If estimating age, use broad apparent age groups only,
such as baby, child, teenager, young adult, adult, older adult, or unknown.

Return valid JSON with this schema:

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
}

Rules:
- Return only JSON. Do not wrap the response in markdown or explanatory text.
- Keep the description factual, searchable, and user-friendly. Never put raw JSON or schema text in the description.
- Prefer concrete nouns over vague adjectives.
- Include brands, signage, screens, documents, uniforms, tools, vehicles, animals, food, and landmarks only when
  visible.
- Use 8 to 20 tags.
- Tags should be lowercase, short, and useful for search.
- Preserve uncertainty in people fields when needed, including values like "young adult | adult".
- If visible evidence supports adult nudity or sexual content, say so factually with terms like naked, nudity,
  exposed genitals, bare buttocks, sexual activity, restraint, bondage, or sex toy. Do not treat bare chest, bed,
  swimwear, underwear, or ambiguous partial clothing as explicit by itself.
- If visible evidence supports a medical context, describe visible items such as hospital room, exam table, IV line,
  bandage, cast, wound, prescription bottle, pill organizer, syringe, medical monitor, wheelchair, crutches, x-ray,
  ultrasound, lab result, or medical paperwork. Do not infer diagnoses, procedures, pregnancy, disability,
  medication names, or medical conditions unless plainly visible as generic text or objects.
- Avoid moralizing language.
"""

NSFW_PROMPT_SUFFIX = """
The dedicated NSFW classifier flagged this image. Re-check the image visually. If visible evidence supports it,
include specific factual NSFW reasons in the description, tags, and safety.indicators, such as nudity, naked,
exposed genitals, bare buttocks, sexual activity, sex toy, restraint, bondage, explicit, or nsfw. If apparent age is
uncertain around NSFW content, use conservative tags such as nsfw_review rather than explicit age claims.
"""

# Curated VLM presets for `imageDescription.modelName`.
# - The first column is the model name an admin sets in config; on OpenVINO it
#   transparently resolves to the pre-quantized int4/int8 build below.
# - CUDA installs use the HF model name directly (left column).
#
# Supported families (loader compatibility): Qwen2.5-VL, Phi-3-vision,
# Phi-3.5-vision, Florence-2. Models outside these families will not load.
OPENVINO_MODEL_ALIASES = {
    # Phi family
    "microsoft/Phi-3-vision-128k-instruct": "OpenVINO/Phi-3-vision-128k-instruct-int4-ov",
    "microsoft/Phi-3.5-vision-instruct": "OpenVINO/Phi-3.5-vision-instruct-int4-ov",
    # Qwen2.5-VL family (size scales quality and VRAM)
    "Qwen/Qwen2.5-VL-3B-Instruct": "llmware/qwen2.5-vl-3b-ov",
    "Qwen/Qwen2.5-VL-7B-Instruct": "llmware/qwen2.5-vl-7b-ov",
}
DEFAULT_OPENVINO_MAX_IMAGE_EDGE = 512
PHI_OPENVINO_IMAGE_TAG = "<|image_1|>"
QWEN_OPENVINO_IMAGE_TAG = "<|vision_start|><|image_pad|><|vision_end|>"

NSFW_TAGS = {
    "adult-nudity",
    "bare-buttocks",
    "bondage",
    "explicit",
    "exposed-genitals",
    "naked",
    "nsfw",
    "nudity",
    "restraint",
    "sex-toy",
    "sexual-activity",
}
MEDICAL_TAGS = {
    "bandage",
    "cast",
    "crutches",
    "exam-table",
    "hospital",
    "iv-line",
    "lab-result",
    "medical",
    "medical-monitor",
    "medical-paperwork",
    "mobility-aid",
    "pill-organizer",
    "prescription",
    "syringe",
    "ultrasound",
    "wheelchair",
    "wound",
    "x-ray",
}

FLORENCE_MODEL_NAMES = {
    "microsoft/Florence-2-base",
    "microsoft/Florence-2-base-ft",
    "microsoft/Florence-2-large",
    "microsoft/Florence-2-large-ft",
}


class ImageDescriptionModel(InferenceModel):
    depends = []
    identity = (ModelType.VISUAL, ModelTask.IMAGE_DESCRIPTION)

    def __init__(self, model_name: str, **model_kwargs: Any) -> None:
        self.requested_acceleration = self._acceleration(model_kwargs.get("acceleration"))
        self.acceleration = self._resolve_acceleration(self.requested_acceleration)
        self.hf_model_name = self._model_name_for_acceleration(model_name, self.acceleration)
        self.device = str(model_kwargs.get("device", "AUTO") or "AUTO")
        self._openvino_lock = threading.Lock()
        super().__init__(model_name, **model_kwargs)

    def predict(self, *inputs: Any, **model_kwargs: Any) -> Any:
        self.load()
        if model_kwargs:
            self.configure(**model_kwargs)
        return self._predict(
            *inputs,
            nsfw=model_kwargs.get("nsfw"),
            external_prompt=model_kwargs.get("external_prompt"),
        )

    def configure(self, **kwargs: Any) -> None:
        if "acceleration" in kwargs:
            acceleration = self._resolve_acceleration(self._acceleration(kwargs["acceleration"]))
            if acceleration != self.acceleration:
                log.warning("Ignoring image description acceleration change until the model is reloaded.")
        if "device" in kwargs:
            device = str(kwargs["device"] or "AUTO")
            if device != self.device:
                log.warning("Ignoring image description device change until the model is reloaded.")

    def _download(self) -> None:
        snapshot_download(self.hf_model_name, cache_dir=self.cache_dir, local_dir=self.cache_dir)

    def _load(self) -> Any:
        if self.acceleration == ImageDescriptionAcceleration.CUDA:
            return self._load_cuda()

        return self._load_openvino(self.device)

    def _load_openvino(self, device: str) -> Any:
        try:
            import openvino_genai
        except ImportError as error:
            raise ImportError("openvino-genai is required for image description models") from error

        return openvino_genai.VLMPipeline(str(self.cache_dir), device)

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
            if not self._is_openvino_dimension_error(error):
                raise
            with self._openvino_lock:
                if self.device.upper() != "CPU":
                    log.warning(
                        "OpenVINO image description failed on device "
                        f"'{self.device}' with '{error}'. Retrying image description on CPU."
                    )
                    self.session = self._load_openvino("CPU")
                    self.device = "CPU"
            result = self._generate_openvino(prompt, images)

        text = self._result_text(result)
        return self._normalize_response(text)

    def _generate_openvino(self, prompt: str, images: list[Any]) -> Any:
        with self._openvino_lock:
            session = cast(Any, self.session)
            return session.generate(
                prompt,
                images=images,
                generation_config=self._generation_config(),
            )

    def _is_openvino_dimension_error(self, error: RuntimeError) -> bool:
        return "accessing out-of-range dimension" in str(error).lower()

    def _load_cuda(self) -> dict[str, Any]:
        try:
            import torch
            from transformers import AutoModelForCausalLM, AutoModelForImageTextToText, AutoProcessor
        except ImportError as error:
            raise ImportError(
                "torch and transformers are required for CUDA image description models. "
                "Use the CUDA machine-learning image/extra."
            ) from error

        device = self._torch_device(torch)
        torch_dtype = torch.float16 if str(device).startswith("cuda") else torch.float32
        trust_remote_code = self.hf_model_name in FLORENCE_MODEL_NAMES
        processor = AutoProcessor.from_pretrained(str(self.cache_dir), trust_remote_code=trust_remote_code)

        if self.hf_model_name in FLORENCE_MODEL_NAMES:
            model = AutoModelForCausalLM.from_pretrained(
                str(self.cache_dir),
                torch_dtype=torch_dtype,
                trust_remote_code=trust_remote_code,
            ).to(device)
        else:
            # AutoModelForImageTextToText dispatches to the right vision-LM class
            # via the model's config.json. Works for the full Qwen2.5-VL family
            # (3B/7B/32B/72B) and Qwen3-VL (e.g. 30B-A3B MoE) without hard-coding
            # a single Conditional Generation class. Replaces AutoModelForVision2Seq
            # which was removed in transformers 5.x.
            model = AutoModelForImageTextToText.from_pretrained(
                str(self.cache_dir),
                torch_dtype="auto",
            ).to(device)

        model.eval()
        return {"model": model, "processor": processor, "device": device, "torch": torch, "torch_dtype": torch_dtype}

    def _predict_cuda(self, image: Image.Image, nsfw: Any = None, external_prompt: str | None = None) -> dict[str, Any]:
        if self.hf_model_name in FLORENCE_MODEL_NAMES:
            # Florence uses task tokens, not prompts. external_prompt is ignored intentionally.
            return self._predict_florence(image)
        return self._predict_qwen(image, nsfw, external_prompt)

    def _predict_qwen(self, image: Image.Image, nsfw: Any = None, external_prompt: str | None = None) -> dict[str, Any]:
        prompt = self._make_prompt(nsfw, external_prompt)
        session = cast(dict[str, Any], self.session)
        model = session["model"]
        processor = session["processor"]
        device = session["device"]
        torch = session["torch"]
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image},
                    {"type": "text", "text": prompt},
                ],
            }
        ]
        text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)

        try:
            from qwen_vl_utils import process_vision_info

            image_inputs, video_inputs = process_vision_info(messages)
            inputs = processor(
                text=[text],
                images=image_inputs,
                videos=video_inputs,
                padding=True,
                return_tensors="pt",
            )
        except ImportError:
            inputs = processor(text=[text], images=[image], padding=True, return_tensors="pt")

        inputs = inputs.to(device)
        with torch.inference_mode():
            generated_ids = model.generate(**inputs, max_new_tokens=768, do_sample=False)
        generated_ids = [output_ids[len(input_ids) :] for input_ids, output_ids in zip(inputs.input_ids, generated_ids)]
        text = processor.batch_decode(
            generated_ids,
            skip_special_tokens=True,
            clean_up_tokenization_spaces=False,
        )[0]
        return self._normalize_response(text)

    def _predict_florence(self, image: Image.Image) -> dict[str, Any]:
        caption = self._run_florence_task("<MORE_DETAILED_CAPTION>", image)
        ocr = self._run_florence_task("<OCR>", image)
        detection = self._run_florence_task("<OD>", image)

        description = str(caption.get("<MORE_DETAILED_CAPTION>") or caption.get("<DETAILED_CAPTION>") or "").strip()
        visible_text = self._list_of_strings([ocr.get("<OCR>")])
        labels = detection.get("<OD>", {}).get("labels") if isinstance(detection.get("<OD>"), dict) else []
        objects = self._list_of_strings(labels)

        return {
            "description": description,
            "people": [],
            "environment": "",
            "objects": objects,
            "visible_text": visible_text,
            "context": "",
            "tags": self._tags_from_text(" ".join([description, *objects, *visible_text])),
        }

    def _run_florence_task(self, task_prompt: str, image: Image.Image) -> dict[str, Any]:
        session = cast(dict[str, Any], self.session)
        model = session["model"]
        processor = session["processor"]
        device = session["device"]
        torch = session["torch"]
        torch_dtype = session["torch_dtype"]
        inputs = processor(text=task_prompt, images=image.convert("RGB"), return_tensors="pt")
        inputs = {key: value.to(device) for key, value in inputs.items()}
        if "pixel_values" in inputs:
            inputs["pixel_values"] = inputs["pixel_values"].to(dtype=torch_dtype)

        with torch.inference_mode():
            generated_ids = model.generate(
                input_ids=inputs["input_ids"],
                pixel_values=inputs["pixel_values"],
                max_new_tokens=1024,
                num_beams=3,
                do_sample=False,
            )

        generated_text = processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
        parsed = processor.post_process_generation(generated_text, task=task_prompt, image_size=image.size)
        return parsed if isinstance(parsed, dict) else {}

    def _acceleration(self, value: Any) -> ImageDescriptionAcceleration:
        acceleration = str(value or ImageDescriptionAcceleration.AUTO).lower()
        match acceleration:
            case ImageDescriptionAcceleration.CUDA:
                return ImageDescriptionAcceleration.CUDA
            case ImageDescriptionAcceleration.OPENVINO:
                return ImageDescriptionAcceleration.OPENVINO
            case _:
                return ImageDescriptionAcceleration.AUTO

    def _resolve_acceleration(self, acceleration: ImageDescriptionAcceleration) -> ImageDescriptionAcceleration:
        if acceleration != ImageDescriptionAcceleration.AUTO:
            return acceleration
        return ImageDescriptionAcceleration.CUDA if self._cuda_available() else ImageDescriptionAcceleration.OPENVINO

    def _model_name_for_acceleration(self, model_name: str, acceleration: ImageDescriptionAcceleration) -> str:
        if acceleration == ImageDescriptionAcceleration.OPENVINO:
            return OPENVINO_MODEL_ALIASES.get(model_name, model_name)
        return model_name

    def _cuda_available(self) -> bool:
        try:
            import torch
            import transformers
        except ImportError:
            return False
        _ = torch, transformers
        return bool(torch.cuda.is_available())

    def _torch_device(self, torch: Any) -> str:
        requested = self.device.strip()
        if requested.upper() in {"", "AUTO", "GPU"}:
            if not torch.cuda.is_available():
                log.warning("CUDA image description was requested, but CUDA is unavailable. Falling back to CPU.")
                return "cpu"
            return "cuda:0"

        if requested.isdigit():
            return f"cuda:{requested}"
        if requested.lower().startswith("cuda") or requested.lower() == "cpu":
            return requested.lower()
        return requested

    def _make_prompt(self, nsfw: Any = None, external_prompt: str | None = None) -> str:
        if external_prompt is not None:
            # Server-assembled prompt; server is responsible for including any
            # NSFW conditional content and structured fields. Any string
            # (including "") is treated as caller-provided; only None falls
            # back to the bundled default.
            return external_prompt
        prompt = IMAGE_DESCRIPTION_PROMPT
        if isinstance(nsfw, dict) and nsfw.get("isNsfw"):
            prompt += NSFW_PROMPT_SUFFIX
        return prompt

    def _make_openvino_prompt(self, nsfw: Any = None, external_prompt: str | None = None) -> str:
        prompt = self._make_prompt(nsfw, external_prompt)
        if self._uses_phi_openvino_model():
            return f"{PHI_OPENVINO_IMAGE_TAG}\n{prompt}"
        if self._uses_qwen_openvino_model():
            return f"{QWEN_OPENVINO_IMAGE_TAG}\n{prompt}"
        return prompt

    def _generation_config(self) -> Any:
        import openvino_genai

        config = openvino_genai.GenerationConfig()
        config.max_new_tokens = 768
        config.temperature = 0.0
        if self._uses_phi_openvino_model():
            self._set_openvino_eos_token_id(config)
        return config

    def _set_openvino_eos_token_id(self, config: Any) -> None:
        get_tokenizer = getattr(cast(Any, self.session), "get_tokenizer", None)
        set_eos_token_id = getattr(config, "set_eos_token_id", None)
        if not callable(get_tokenizer) or not callable(set_eos_token_id):
            return

        tokenizer = get_tokenizer()
        get_eos_token_id = getattr(tokenizer, "get_eos_token_id", None)
        if callable(get_eos_token_id):
            set_eos_token_id(get_eos_token_id())

    def _uses_phi_openvino_model(self) -> bool:
        return "phi-3.5-vision" in self.hf_model_name.lower()

    def _uses_qwen_openvino_model(self) -> bool:
        return "qwen2.5-vl" in self.hf_model_name.lower()

    def _to_openvino_tensor(self, image: Image.Image) -> Any:
        from openvino import Tensor

        rgb = image.convert("RGB")
        original_size = rgb.size
        max_image_edge = self._openvino_max_image_edge()
        if max(rgb.size) > max_image_edge:
            rgb.thumbnail((max_image_edge, max_image_edge), Image.Resampling.LANCZOS)
            log.info(f"Resized OpenVINO image description input from {original_size} to {rgb.size}.")
        image_data = np.asarray(rgb, dtype=np.uint8)[None]
        return Tensor(image_data)

    def _openvino_max_image_edge(self) -> int:
        value = os.getenv("MACHINE_LEARNING_IMAGE_DESCRIPTION__OPENVINO_MAX_IMAGE_EDGE")
        if value is None:
            return DEFAULT_OPENVINO_MAX_IMAGE_EDGE

        try:
            return max(1, int(value))
        except ValueError:
            log.warning(
                "Invalid MACHINE_LEARNING_IMAGE_DESCRIPTION__OPENVINO_MAX_IMAGE_EDGE "
                f"value '{value}'. Using {DEFAULT_OPENVINO_MAX_IMAGE_EDGE}."
            )
            return DEFAULT_OPENVINO_MAX_IMAGE_EDGE

    def _result_text(self, result: Any) -> str:
        texts = getattr(result, "texts", None)
        if isinstance(texts, list) and texts:
            return str(texts[0])
        return str(result)

    def _normalize_response(self, text: str) -> dict[str, Any]:
        data = self._parse_json(text)
        description = self._clean_description(data.get("description"))
        people = self._list_of_records(data.get("people"))
        environment = str(data.get("environment") or "").strip()
        objects = self._list_of_strings(data.get("objects"))
        visible_text = self._list_of_strings(data.get("visible_text"))
        context = str(data.get("context") or "").strip()
        safety = self._normalize_signal(data.get("safety"), "is_nsfw_likely")
        medical = self._normalize_signal(data.get("medical"), "is_medical_likely")
        tags = self._list_of_strings(data.get("tags"))
        if not tags:
            tags = self._tags_from_text(
                " ".join(
                    [
                        description,
                        environment,
                        context,
                        *objects,
                        *visible_text,
                        *self._signal_indicators(safety),
                        *self._signal_indicators(medical),
                    ]
                )
            )
        tags = self._augment_tags(tags, safety, medical)

        return {
            "description": description,
            "people": people,
            "environment": environment,
            "objects": objects,
            "visible_text": visible_text,
            "context": context,
            "tags": tags[:20],
            "safety": safety,
            "medical": medical,
        }

    def _parse_json(self, text: str) -> dict[str, Any]:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            text = text[start : end + 1]

        try:
            parsed = orjson.loads(text)
            return parsed if isinstance(parsed, dict) else {}
        except orjson.JSONDecodeError:
            log.warning("Image description model returned invalid JSON; salvaging visible fields.")
            description = self._extract_string_field(text, "description")
            return {
                "description": description if description else self._plain_text_fallback(text),
                "tags": self._extract_string_array_field(text, "tags"),
                "objects": self._extract_string_array_field(text, "objects"),
                "visible_text": self._extract_string_array_field(text, "visible_text"),
                "safety": self._extract_signal_field(text, "safety", "is_nsfw_likely"),
                "medical": self._extract_signal_field(text, "medical", "is_medical_likely"),
            }

    def _plain_text_fallback(self, text: str) -> str:
        stripped = text.strip()
        return "" if stripped.startswith("{") else stripped

    def _clean_description(self, value: Any) -> str:
        description = str(value or "").strip()
        if description.startswith("{"):
            return self._extract_string_field(description, "description")
        return re.sub(r"^AI description:\s*", "", description, flags=re.IGNORECASE).strip()

    def _extract_string_field(self, text: str, field: str) -> str:
        match = re.search(rf'"{re.escape(field)}"\s*:\s*"((?:\\.|[^"\\])*)"', text, re.DOTALL)
        if not match:
            return ""
        return self._decode_json_string(match.group(1))

    def _extract_string_array_field(self, text: str, field: str) -> list[str]:
        match = re.search(rf'"{re.escape(field)}"\s*:\s*\[([^\]]*)', text, re.DOTALL)
        if not match:
            return []
        return [self._decode_json_string(item) for item in re.findall(r'"((?:\\.|[^"\\])*)"', match.group(1))]

    def _extract_signal_field(self, text: str, field: str, boolean_key: str) -> dict[str, Any]:
        match = re.search(rf'"{re.escape(field)}"\s*:\s*\{{(.*?)\}}', text, re.DOTALL)
        if not match:
            return {}

        body = match.group(1)
        boolean_match = re.search(rf'"{re.escape(boolean_key)}"\s*:\s*(true|false|"[^"]+")', body, re.IGNORECASE)
        boolean_value: Any = False
        if boolean_match:
            boolean_value = boolean_match.group(1).strip('"')

        return {
            boolean_key: boolean_value,
            "confidence": self._extract_string_field(body, "confidence"),
            "indicators": self._extract_string_array_field(body, "indicators"),
            "reason": self._extract_string_field(body, "reason"),
        }

    def _decode_json_string(self, value: str) -> str:
        try:
            decoded = orjson.loads(f'"{value}"')
            return str(decoded).strip()
        except orjson.JSONDecodeError:
            return value.strip()

    def _normalize_signal(self, value: Any, boolean_key: str) -> dict[str, Any]:
        if not isinstance(value, dict):
            return {
                boolean_key: False,
                "confidence": "low",
                "indicators": [],
                "reason": "",
            }
        return {
            boolean_key: self._bool_value(value.get(boolean_key)),
            "confidence": str(value.get("confidence") or "low").strip().lower(),
            "indicators": self._list_of_strings(value.get("indicators")),
            "reason": str(value.get("reason") or "").strip(),
        }

    def _bool_value(self, value: Any) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in {"true", "yes", "1", "high"}
        return bool(value)

    def _signal_indicators(self, signal: dict[str, Any]) -> list[str]:
        indicators = signal.get("indicators")
        return indicators if isinstance(indicators, list) else []

    def _augment_tags(
        self,
        tags: list[str],
        safety: dict[str, Any],
        medical: dict[str, Any],
    ) -> list[str]:
        normalized = [self._normalize_tag(tag) for tag in tags]
        tag_set = {tag for tag in normalized if tag}

        has_strong_nsfw_tag = False
        if safety.get("is_nsfw_likely") and safety.get("confidence") == "high":
            for indicator in self._signal_indicators(safety):
                tag = self._normalize_tag(indicator)
                if tag in NSFW_TAGS:
                    tag_set.add(tag)
                    has_strong_nsfw_tag = True
        if has_strong_nsfw_tag:
            tag_set.add("nsfw")

        if medical.get("is_medical_likely"):
            tag_set.add("medical")
            for indicator in self._signal_indicators(medical):
                tag = self._normalize_tag(indicator)
                if tag in MEDICAL_TAGS:
                    tag_set.add(tag)

        return sorted(tag_set)

    def _list_of_strings(self, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [str(item).strip() for item in value if str(item).strip()]

    def _list_of_records(self, value: Any) -> list[dict[str, Any]]:
        if not isinstance(value, list):
            return []
        return [item for item in value if isinstance(item, dict)]

    def _tags_from_text(self, text: str) -> list[str]:
        stop_words = {
            "about",
            "after",
            "also",
            "and",
            "are",
            "around",
            "from",
            "has",
            "have",
            "into",
            "near",
            "that",
            "the",
            "their",
            "there",
            "this",
            "with",
        }
        tags: list[str] = []
        for word in re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{2,}", text.lower()):
            if word in stop_words or word in tags:
                continue
            tags.append(self._normalize_tag(word))
            if len(tags) >= 20:
                break
        return tags

    def _normalize_tag(self, tag: str) -> str:
        return re.sub(r"-+", "-", re.sub(r"[^a-z0-9_-]+", "-", tag.lower().strip())).strip("-")

    @property
    def cached(self) -> bool:
        return self.cache_dir.exists() and any(self.cache_dir.iterdir())

    @property
    def model_path(self) -> Path:
        return self.cache_dir

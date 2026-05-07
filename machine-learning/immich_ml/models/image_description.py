from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, cast

import numpy as np
import orjson
from huggingface_hub import snapshot_download
from PIL import Image

from immich_ml.config import log
from immich_ml.models.base import InferenceModel
from immich_ml.schemas import ImageDescriptionAcceleration, ModelTask, ModelType

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
  "tags": ["tag1", "tag2", "tag3"]
}

Rules:
- Keep the description factual and searchable.
- Prefer concrete nouns over vague adjectives.
- Include brands, signage, screens, documents, uniforms, tools, vehicles, animals, food, and landmarks only when
  visible.
- Use 8 to 20 tags.
- Tags should be lowercase, short, and useful for search.
- Avoid moralizing language.
"""

NSFW_PROMPT_SUFFIX = """
The dedicated NSFW classifier flagged this image. If visible evidence supports it, include specific factual NSFW
reasons in the description and tags, such as nudity, naked, sex, explicit, or nsfw. If apparent age is uncertain around
NSFW content, use conservative tags such as nsfw_review rather than explicit age claims.
"""

OPENVINO_MODEL_ALIASES = {
    "microsoft/Phi-3.5-vision-instruct": "OpenVINO/Phi-3.5-vision-instruct-int4-ov",
    "Qwen/Qwen2.5-VL-3B-Instruct": "llmware/qwen2.5-vl-3b-ov",
}
DEFAULT_OPENVINO_MAX_IMAGE_EDGE = 512
PHI_OPENVINO_IMAGE_TAG = "<|image_1|>"
QWEN_OPENVINO_IMAGE_TAG = "<|vision_start|><|image_pad|><|vision_end|>"

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
        self.nsfw = model_kwargs.get("nsfw")
        super().__init__(model_name, **model_kwargs)

    def configure(self, **kwargs: Any) -> None:
        if "acceleration" in kwargs:
            acceleration = self._resolve_acceleration(self._acceleration(kwargs["acceleration"]))
            if acceleration != self.acceleration:
                log.warning("Ignoring image description acceleration change until the model is reloaded.")
        if "device" in kwargs:
            device = str(kwargs["device"] or "AUTO")
            if device != self.device:
                log.warning("Ignoring image description device change until the model is reloaded.")
        if "nsfw" in kwargs:
            self.nsfw = kwargs["nsfw"]

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
        if self.acceleration == ImageDescriptionAcceleration.CUDA:
            return self._predict_cuda(image)

        prompt = self._make_openvino_prompt()
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

    def _generate_openvino(self, prompt: str, images: list[Any]) -> Any:
        session = cast(Any, self.session)
        return session.generate(
            prompt,
            images=images,
            generation_config=self._generation_config(),
        )

    def _should_retry_openvino_on_cpu(self, error: RuntimeError) -> bool:
        return self.device.upper() != "CPU" and "accessing out-of-range dimension" in str(error).lower()

    def _load_cuda(self) -> dict[str, Any]:
        try:
            import torch
            from transformers import AutoModelForCausalLM, AutoProcessor, Qwen2_5_VLForConditionalGeneration
        except ImportError as error:
            raise ImportError(
                "torch and transformers are required for CUDA image description models. "
                "Use the CUDA machine-learning image/extra."
            ) from error

        device = self._torch_device(torch)
        torch_dtype = torch.float16 if str(device).startswith("cuda") else torch.float32
        processor = AutoProcessor.from_pretrained(str(self.cache_dir), trust_remote_code=True)

        if self.hf_model_name in FLORENCE_MODEL_NAMES:
            model = AutoModelForCausalLM.from_pretrained(
                str(self.cache_dir),
                torch_dtype=torch_dtype,
                trust_remote_code=True,
            ).to(device)
        else:
            model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
                str(self.cache_dir),
                torch_dtype="auto",
            ).to(device)

        model.eval()
        return {"model": model, "processor": processor, "device": device, "torch": torch, "torch_dtype": torch_dtype}

    def _predict_cuda(self, image: Image.Image) -> dict[str, Any]:
        if self.hf_model_name in FLORENCE_MODEL_NAMES:
            return self._predict_florence(image)
        return self._predict_qwen(image)

    def _predict_qwen(self, image: Image.Image) -> dict[str, Any]:
        prompt = self._make_prompt()
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
        return True

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

    def _make_prompt(self) -> str:
        prompt = IMAGE_DESCRIPTION_PROMPT
        if isinstance(self.nsfw, dict) and self.nsfw.get("isNsfw"):
            prompt += NSFW_PROMPT_SUFFIX
        return prompt

    def _make_openvino_prompt(self) -> str:
        prompt = self._make_prompt()
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
        description = str(data.get("description") or "").strip()

        return {
            "description": description,
            "people": self._list_of_records(data.get("people")),
            "environment": str(data.get("environment") or "").strip(),
            "objects": self._list_of_strings(data.get("objects")),
            "visible_text": self._list_of_strings(data.get("visible_text")),
            "context": str(data.get("context") or "").strip(),
            "tags": self._list_of_strings(data.get("tags"))[:20],
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
            log.warning("Image description model returned invalid JSON; using raw text as description.")
            return {"description": text, "tags": []}

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
            tags.append(word)
            if len(tags) >= 20:
                break
        return tags

    @property
    def cached(self) -> bool:
        return self.cache_dir.exists() and any(self.cache_dir.iterdir())

    @property
    def model_path(self) -> Path:
        return self.cache_dir

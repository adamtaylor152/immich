from enum import Enum
from typing import Any, Literal, Protocol, TypeGuard, TypeVar

import numpy as np
import numpy.typing as npt
from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing_extensions import TypedDict


class StrEnum(str, Enum):
    value: str

    def __str__(self) -> str:
        return self.value


class BoundingBox(TypedDict):
    x1: int
    y1: int
    x2: int
    y2: int


class ModelTask(StrEnum):
    FACIAL_RECOGNITION = "facial-recognition"
    SEARCH = "clip"
    OCR = "ocr"
    IMAGE_DESCRIPTION = "image-description-tagging"
    NSFW_DETECTION = "nsfw-detection"


class ModelType(StrEnum):
    CLASSIFICATION = "classification"
    DETECTION = "detection"
    RECOGNITION = "recognition"
    TEXTUAL = "textual"
    VISUAL = "visual"


class ModelFormat(StrEnum):
    ARMNN = "armnn"
    ONNX = "onnx"
    RKNN = "rknn"


class ModelSource(StrEnum):
    INSIGHTFACE = "insightface"
    MCLIP = "mclip"
    OPENCLIP = "openclip"
    PADDLE = "paddle"


class ModelPrecision(StrEnum):
    FP16 = "FP16"
    FP32 = "FP32"


class ImageDescriptionAcceleration(StrEnum):
    AUTO = "auto"
    OPENVINO = "openvino"
    CUDA = "cuda"


ModelIdentity = tuple[ModelType, ModelTask]


class SessionNode(Protocol):
    @property
    def name(self) -> str | None: ...

    @property
    def shape(self) -> tuple[int, ...]: ...


class ModelSession(Protocol):
    def run(
        self,
        output_names: list[str] | None,
        input_feed: dict[str, npt.NDArray[np.float32]] | dict[str, npt.NDArray[np.int32]],
        run_options: Any = None,
    ) -> list[npt.NDArray[np.float32]]: ...

    def get_inputs(self) -> list[SessionNode]: ...

    def get_outputs(self) -> list[SessionNode]: ...


class HasProfiling(Protocol):
    profiling: dict[str, float]


class FaceDetectionOutput(TypedDict):
    boxes: npt.NDArray[np.float32]
    scores: npt.NDArray[np.float32]
    landmarks: npt.NDArray[np.float32]


class DetectedFace(TypedDict):
    boundingBox: BoundingBox
    embedding: str
    score: float


FacialRecognitionOutput = list[DetectedFace]


class PipelineEntry(TypedDict):
    modelName: str
    options: dict[str, Any]


PipelineRequest = dict[ModelTask, dict[ModelType, PipelineEntry]]


class InferenceEntry(TypedDict):
    name: str
    task: ModelTask
    type: ModelType
    options: dict[str, Any]


InferenceEntries = tuple[list[InferenceEntry], list[InferenceEntry]]


InferenceResponse = dict[ModelTask | Literal["imageHeight"] | Literal["imageWidth"], Any]


def has_profiling(obj: Any) -> TypeGuard[HasProfiling]:
    return hasattr(obj, "profiling") and isinstance(obj.profiling, dict)


# Max length for the externally-supplied VLM prompt. Multipart body limits
# are the primary defense; this cap is belt-and-braces against an attacker
# who controls the server side and could otherwise send a 100MB prompt.
# See ml.md High concern "external_prompt and other ML model options".
MAX_EXTERNAL_PROMPT_LENGTH = 64 * 1024


class _OptionsBase(BaseModel):
    """Common ground for per-task option models.

    `extra="forbid"` enforces a closed keyspace per task — this catches
    schema drift between server and ML service, and provides a defensive
    barrier against an attacker who controls the server side from sending
    arbitrary kwargs to model constructors.

    NOTE: ``ttl`` is intentionally NOT declared here. ``main.run_inference``
    passes ``ttl=settings.model_ttl`` to ``model_cache.get`` alongside
    ``**entry["options"]``; declaring ``ttl`` as a per-task option would
    let a caller send ``ttl`` in the validated payload, then collide with
    the explicit keyword and raise ``TypeError: got multiple values for
    keyword argument 'ttl'``.
    """

    model_config = ConfigDict(extra="forbid")

    device: str | None = Field(default=None, max_length=64)


class ClipOptions(_OptionsBase):
    """Options for CLIP textual/visual models."""


class FacialRecognitionDetectionOptions(_OptionsBase):
    """Options for the facial-recognition detection task."""

    minScore: float | None = Field(default=None, ge=0.0, le=1.0)


class FacialRecognitionRecognitionOptions(_OptionsBase):
    """Options for the facial-recognition recognition task."""


class OcrDetectionOptions(_OptionsBase):
    """Options for the OCR detection task."""

    minScore: float | None = Field(default=None, ge=0.0, le=1.0)


class OcrRecognitionOptions(_OptionsBase):
    """Options for the OCR recognition task."""

    minScore: float | None = Field(default=None, ge=0.0, le=1.0)


class NsfwDetectionOptions(_OptionsBase):
    """Options for the NSFW classification model."""

    threshold: float | None = Field(default=None, ge=0.0, le=1.0)


class ImageDescriptionOptions(_OptionsBase):
    """Options for the image-description-tagging task.

    Restricts the option keyspace per ml.md High concern — unknown keys are
    rejected, the external prompt is length-capped, and acceleration/device
    are constrained to expected values.
    """

    external_prompt: str | None = None
    # nsfw can be the dict shape {"isNsfw": bool} or None.
    nsfw: dict[str, Any] | None = None
    acceleration: ImageDescriptionAcceleration | str | None = None

    @field_validator("external_prompt")
    @classmethod
    def _cap_prompt_length(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if len(value) > MAX_EXTERNAL_PROMPT_LENGTH:
            raise ValueError(
                f"external_prompt exceeds maximum length of {MAX_EXTERNAL_PROMPT_LENGTH} characters"
            )
        return value


# Map of (task, type) -> options pydantic class for per-entry validation.
OPTIONS_VALIDATORS: dict[tuple[ModelTask, ModelType], type[BaseModel]] = {
    (ModelTask.SEARCH, ModelType.TEXTUAL): ClipOptions,
    (ModelTask.SEARCH, ModelType.VISUAL): ClipOptions,
    (ModelTask.FACIAL_RECOGNITION, ModelType.DETECTION): FacialRecognitionDetectionOptions,
    (ModelTask.FACIAL_RECOGNITION, ModelType.RECOGNITION): FacialRecognitionRecognitionOptions,
    (ModelTask.OCR, ModelType.DETECTION): OcrDetectionOptions,
    (ModelTask.OCR, ModelType.RECOGNITION): OcrRecognitionOptions,
    (ModelTask.IMAGE_DESCRIPTION, ModelType.VISUAL): ImageDescriptionOptions,
    (ModelTask.NSFW_DETECTION, ModelType.CLASSIFICATION): NsfwDetectionOptions,
}


def validate_options(task: ModelTask, type_: ModelType, options: dict[str, Any]) -> dict[str, Any]:
    """Validate per-task options. Falls back to passthrough if the (task, type)
    pair is not registered (e.g. a future task that doesn't need validation)."""
    validator = OPTIONS_VALIDATORS.get((task, type_))
    if validator is None:
        return options
    return validator.model_validate(options).model_dump(exclude_none=True)


T = TypeVar("T")

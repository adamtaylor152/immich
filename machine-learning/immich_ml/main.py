import asyncio
import gc
import os
import secrets
import signal
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from functools import partial
from typing import Any, AsyncGenerator, Callable, Iterator
from zipfile import BadZipFile

import onnxruntime as ort
import orjson
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request
from fastapi.responses import ORJSONResponse, PlainTextResponse
from onnxruntime.capi.onnxruntime_pybind11_state import InvalidProtobuf, NoSuchFile
from PIL.Image import Image
from pydantic import ValidationError
from starlette.formparsers import MultiPartParser
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp

from immich_ml.models import get_model_deps
from immich_ml.models.base import InferenceModel
from immich_ml.models.transforms import decode_pil

from .config import PreloadModelData, log, settings
from .models.cache import ModelCache
from .schemas import (
    ImageDescriptionAcceleration,
    InferenceEntries,
    InferenceEntry,
    InferenceResponse,
    ModelFormat,
    ModelIdentity,
    ModelTask,
    ModelType,
    PipelineRequest,
    T,
    validate_options,
)

MultiPartParser.spool_max_size = 2**26  # spools to disk if payload is 64 MiB or larger

model_cache = ModelCache(revalidate=settings.model_ttl > 0)
thread_pool: ThreadPoolExecutor | None = None
lock = threading.Lock()
active_requests = 0
last_called: float | None = None


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
    global thread_pool
    log.info(
        (
            "Created in-memory cache with unloading "
            f"{f'after {settings.model_ttl}s of inactivity' if settings.model_ttl > 0 else 'disabled'}."
        )
    )

    try:
        if settings.request_threads > 0:
            # asyncio is a huge bottleneck for performance, so we use a thread pool to run blocking code
            thread_pool = ThreadPoolExecutor(settings.request_threads) if settings.request_threads > 0 else None
            log.info(f"Initialized request thread pool with {settings.request_threads} threads.")
        if settings.model_ttl > 0 and settings.model_ttl_poll_s > 0:
            asyncio.ensure_future(idle_shutdown_task())
        if settings.preload is not None:
            await preload_models(settings.preload)
        yield
    finally:
        log.handlers.clear()
        # Drop strong references held by the cache so Torch/OpenVINO sessions
        # (which may hold multi-GB of pinned GPU memory) are eligible for GC
        # before the worker is respawned. Without this, `del model` only
        # deleted the loop variable and the cache dict kept references alive.
        # See ml.md Medium "Lifespan teardown doesn't release model GPU memory".
        try:
            model_cache.cache._cache.clear()
        except Exception as error:
            log.warning(f"Failed to clear model cache during shutdown: {error}")
        if thread_pool is not None:
            thread_pool.shutdown()
        gc.collect()
        # If torch is present, also drop any cached CUDA allocator state.
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass
        except Exception as error:
            log.warning(f"Failed to empty CUDA cache during shutdown: {error}")


async def preload_models(preload: PreloadModelData) -> None:
    log.info(
        f"Preloading models: clip:{preload.clip} facial_recognition:{preload.facial_recognition} "
        f"image_description:{preload.image_description}"
    )

    async def load_models(model_string: str, model_type: ModelType, model_task: ModelTask) -> None:
        for model_name in model_string.split(","):
            model_name = model_name.strip()
            model = await model_cache.get(model_name, model_type, model_task)
            await load(model)

    if preload.clip.textual is not None:
        await load_models(preload.clip.textual, ModelType.TEXTUAL, ModelTask.SEARCH)

    if preload.clip.visual is not None:
        await load_models(preload.clip.visual, ModelType.VISUAL, ModelTask.SEARCH)

    if preload.facial_recognition.detection is not None:
        await load_models(
            preload.facial_recognition.detection,
            ModelType.DETECTION,
            ModelTask.FACIAL_RECOGNITION,
        )

    if preload.facial_recognition.recognition is not None:
        await load_models(
            preload.facial_recognition.recognition,
            ModelType.RECOGNITION,
            ModelTask.FACIAL_RECOGNITION,
        )

    if preload.ocr.detection is not None:
        await load_models(
            preload.ocr.detection,
            ModelType.DETECTION,
            ModelTask.OCR,
        )

    if preload.ocr.recognition is not None:
        await load_models(
            preload.ocr.recognition,
            ModelType.RECOGNITION,
            ModelTask.OCR,
        )

    if preload.image_description.visual is not None:
        await load_models(
            preload.image_description.visual,
            ModelType.VISUAL,
            ModelTask.IMAGE_DESCRIPTION,
        )


def update_state() -> Iterator[None]:
    global active_requests, last_called
    active_requests += 1
    last_called = time.time()
    try:
        yield
    finally:
        active_requests -= 1


def get_entries(entries: str = Form()) -> InferenceEntries:
    try:
        request: PipelineRequest = orjson.loads(entries)
        without_deps: list[InferenceEntry] = []
        with_deps: list[InferenceEntry] = []
        for task, types in request.items():
            for type, entry in types.items():
                # Validate per-task option keyspace. Unknown keys are rejected
                # to prevent schema drift / arbitrary kwargs to model constructors.
                # See ml.md High concern "external_prompt and other ML model options".
                raw_options = entry.get("options", {}) or {}
                if not isinstance(raw_options, dict):
                    raise HTTPException(422, "Invalid request format: options must be an object.")
                validated_options = validate_options(task, type, raw_options)
                parsed: InferenceEntry = {
                    "name": entry["modelName"],
                    "task": task,
                    "type": type,
                    "options": validated_options,
                }
                dep = get_model_deps(parsed["name"], type, task)
                (with_deps if dep else without_deps).append(parsed)
        return without_deps, with_deps
    except (orjson.JSONDecodeError, ValidationError, KeyError, AttributeError) as e:
        log.error(f"Invalid request format: {e}")
        raise HTTPException(422, "Invalid request format.")


app = FastAPI(lifespan=lifespan)


# Health endpoints stay unauthenticated so RunPod's proxy probes and LAN deployments
# (the default UX) keep working unchanged. Auth only kicks in for paths that actually
# do inference, and only when IMMICH_ML_AUTH_TOKEN is set in the environment.
# Normalised exempt paths — comparison strips trailing slash and lowercases.
_AUTH_EXEMPT_PATHS = frozenset({"/", "/ping"})
# Cap on the Authorization header byte length to avoid degenerate-input
# denial-of-service from arbitrary-length headers. Starlette already caps but
# making this explicit here is defensive and cheap.
_MAX_AUTH_HEADER_LENGTH = 8 * 1024


def _normalize_auth_path(path: str) -> str:
    """Lowercase + trailing-slash strip, but never strip the root '/'."""
    normalized = path.lower()
    if len(normalized) > 1 and normalized.endswith("/"):
        normalized = normalized.rstrip("/")
    return normalized


def _is_loopback_host(host: str) -> bool:
    """Return True if `host` is a loopback bind (127.0.0.0/8 or ::1)."""
    if not host:
        return False
    lowered = host.strip().lower()
    return (
        lowered == "localhost"
        or lowered.startswith("127.")
        or lowered == "::1"
        or lowered == "[::1]"
    )


class BearerAuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp, expected_token: str | None, warn_when_unset: bool) -> None:
        super().__init__(app)
        # Encode once so compare_digest sees bytes of consistent type.
        self._expected_bytes: bytes | None = expected_token.encode("utf-8") if expected_token else None
        self._warn_when_unset = warn_when_unset

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        normalized_path = _normalize_auth_path(request.url.path)
        if self._expected_bytes is None:
            # Auth was not configured. We loudly warn every inference attempt
            # so operators see this in logs in the default-UX local deploy.
            if self._warn_when_unset and normalized_path not in _AUTH_EXEMPT_PATHS:
                log.warning(
                    "IMMICH_ML_AUTH_TOKEN is unset and ML is bound to a non-loopback "
                    "address. Inference endpoint is reachable without authentication. "
                    "Set IMMICH_ML_AUTH_TOKEN to enable bearer auth."
                )
            return await call_next(request)
        if normalized_path in _AUTH_EXEMPT_PATHS:
            return await call_next(request)
        header = request.headers.get("authorization", "")
        if len(header) > _MAX_AUTH_HEADER_LENGTH:
            return JSONResponse({"message": "Unauthorized"}, status_code=401)
        scheme, _, token = header.partition(" ")
        if scheme.lower() != "bearer":
            return JSONResponse({"message": "Unauthorized"}, status_code=401)
        # Constant-time comparison to prevent the matching-prefix timing leak
        # that ``token != self._expected`` exposed. ml.md High #1.
        if not secrets.compare_digest(token.encode("utf-8"), self._expected_bytes):
            return JSONResponse({"message": "Unauthorized"}, status_code=401)
        return await call_next(request)


_auth_token = os.environ.get("IMMICH_ML_AUTH_TOKEN", "").strip() or None
_immich_host = os.environ.get("IMMICH_HOST", "[::]").strip()
_bound_loopback = _is_loopback_host(_immich_host)

if _auth_token:
    log.info("Bearer-token authentication enabled for /predict")
elif not _bound_loopback:
    # Loud, one-shot warning at boot. The middleware will additionally warn
    # on every inference request when token is unset and host is non-loopback.
    log.warning(
        "SECURITY: IMMICH_ML_AUTH_TOKEN is unset and IMMICH_HOST '%s' is not a loopback "
        "address. /predict will accept unauthenticated requests. Set IMMICH_ML_AUTH_TOKEN, "
        "bind ML to 127.0.0.1/::1, or place ML behind a reverse proxy that enforces network ACLs.",
        _immich_host,
    )
else:
    log.warning(
        "IMMICH_ML_AUTH_TOKEN unset (bound to loopback '%s'); /predict is unauthenticated. "
        "Acceptable for local development only.",
        _immich_host,
    )

app.add_middleware(
    BearerAuthMiddleware,
    expected_token=_auth_token,
    warn_when_unset=not _bound_loopback,
)


@app.get("/")
async def root() -> ORJSONResponse:
    return ORJSONResponse({"message": "Immich ML"})


@app.get("/ping")
def ping() -> PlainTextResponse:
    return PlainTextResponse("pong")


@app.get("/hardware")
def hardware() -> ORJSONResponse:
    """Report available hardware acceleration providers.

    Public contract — KEEP IN SYNC WITH ``server/src/repositories/machine-learning.repository.ts``
    (``MachineLearningHardware``) and ``server/src/enum.ts`` (``MachineLearningHardwareAcceleration``).
    ``preferredAcceleration`` is serialized as the lowercase string value of
    ``ImageDescriptionAcceleration`` (``"cuda"`` / ``"openvino"`` / ``"auto"``).
    Changing the enum requires a coordinated update on the server side and
    a corresponding Zod schema parse — adding a new variant without updating
    the server will silently break the front-end auto-detect UX.
    """
    providers = ort.get_available_providers()
    openvino_device_ids = _openvino_device_ids(providers)
    torch_cuda_available, cuda_device_count = _torch_cuda_info()
    preferred_acceleration = ImageDescriptionAcceleration.AUTO

    if torch_cuda_available or "CUDAExecutionProvider" in providers:
        preferred_acceleration = ImageDescriptionAcceleration.CUDA
    elif "OpenVINOExecutionProvider" in providers and openvino_device_ids:
        preferred_acceleration = ImageDescriptionAcceleration.OPENVINO

    return ORJSONResponse(
        {
            "providers": providers,
            "openvinoDeviceIds": openvino_device_ids,
            "torchCudaAvailable": torch_cuda_available,
            "cudaDeviceCount": cuda_device_count,
            "preferredAcceleration": preferred_acceleration,
        }
    )


def _openvino_device_ids(providers: list[str]) -> list[str]:
    if "OpenVINOExecutionProvider" not in providers:
        return []

    try:
        # Keep this resilient across onnxruntime versions where internals may change.
        pybind_state = getattr(getattr(ort, "capi", None), "_pybind_state", None)
        get_ids = getattr(pybind_state, "get_available_openvino_device_ids", None)
        if not callable(get_ids):
            return []
        device_ids: list[str] = get_ids()
        return device_ids
    except Exception as error:
        log.warning(f"Unable to read OpenVINO device IDs: {error}")
        return []


def _torch_cuda_info() -> tuple[bool, int]:
    try:
        import torch
    except ImportError:
        return False, 0

    if not torch.cuda.is_available():
        return False, 0

    return True, torch.cuda.device_count()


@app.post("/predict", dependencies=[Depends(update_state)])
async def predict(
    entries: InferenceEntries = Depends(get_entries),
    image: bytes | None = File(default=None),
    text: str | None = Form(default=None),
) -> Any:
    if image is not None:
        decoded = await run(lambda: decode_pil(image))
        if decoded.width == 0 or decoded.height == 0:
            raise HTTPException(400, "Image has zero width or height")
        inputs: Image | str = decoded
    elif text is not None:
        inputs = text
    else:
        raise HTTPException(400, "Either image or text must be provided")
    response = await run_inference(inputs, entries)
    return ORJSONResponse(response)


async def run_inference(payload: Image | str, entries: InferenceEntries) -> InferenceResponse:
    outputs: dict[ModelIdentity, Any] = {}
    response: InferenceResponse = {}

    async def _run_inference(entry: InferenceEntry) -> None:
        model = await model_cache.get(
            entry["name"], entry["type"], entry["task"], ttl=settings.model_ttl, **entry["options"]
        )
        inputs = [payload]
        for dep in model.depends:
            try:
                inputs.append(outputs[dep])
            except KeyError:
                message = f"Task {entry['task']} of type {entry['type']} depends on output of {dep}"
                raise HTTPException(400, message)
        model = await load(model)
        output = await run(model.predict, *inputs, **entry["options"])
        outputs[model.identity] = output
        response[entry["task"]] = output

    without_deps, with_deps = entries
    await asyncio.gather(*[_run_inference(entry) for entry in without_deps])
    if with_deps:
        await asyncio.gather(*[_run_inference(entry) for entry in with_deps])
    if isinstance(payload, Image):
        response["imageHeight"], response["imageWidth"] = payload.height, payload.width

    return response


async def run(func: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    if thread_pool is None:
        return func(*args, **kwargs)
    partial_func = partial(func, *args, **kwargs)
    return await asyncio.get_running_loop().run_in_executor(thread_pool, partial_func)


async def load(model: InferenceModel) -> InferenceModel:
    if model.loaded:
        return model

    def _load(model: InferenceModel) -> InferenceModel:
        if model.load_attempts > 1:
            raise HTTPException(500, f"Failed to load model '{model.model_name}'")
        with lock:
            try:
                model.load()
            except FileNotFoundError as e:
                if model.model_format == ModelFormat.ONNX:
                    raise e
                log.warning(
                    f"{model.model_format.upper()} is available, but model '{model.model_name}' does not support it.",
                    exc_info=e,
                )
                model.model_format = ModelFormat.ONNX
                model.load()
        return model

    try:
        return await run(_load, model)
    except (OSError, InvalidProtobuf, BadZipFile, NoSuchFile):
        log.warning(f"Failed to load {model.model_type.replace('_', ' ')} model '{model.model_name}'. Clearing cache.")
        model.clear_cache()
        return await run(_load, model)


async def idle_shutdown_task() -> None:
    while True:
        if (
            last_called is not None
            and not active_requests
            and not lock.locked()
            and time.time() - last_called > settings.model_ttl
        ):
            log.info("Shutting down due to inactivity.")
            os.kill(os.getpid(), signal.SIGINT)
            break
        await asyncio.sleep(settings.model_ttl_poll_s)

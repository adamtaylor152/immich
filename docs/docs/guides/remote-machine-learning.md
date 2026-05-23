# Remote Machine Learning

Immich's machine-learning service runs five distinct workloads, all of which read the asset's preview image and write structured metadata back to Postgres:

| Task                | What it produces                                                                  | Default model                                                  | Triggered by                     |
| ------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------- |
| Smart Search (CLIP) | A 512- or 768-dimensional embedding stored in `smart_search` (pgvector).          | `ViT-B-32__openai` (or `ViT-B-16-SigLIP-384__webli` on RunPod) | Upload, manual backfill          |
| Face Detection      | Bounding boxes + per-face embeddings stored in `asset_faces`.                     | `buffalo_l`                                                    | Upload, manual backfill          |
| OCR                 | Text extracted from receipts, signs, screenshots; indexed for full-text search.   | `paddleocr` defaults                                           | Upload (if enabled)              |
| Image Description   | A short caption + structured tags written to the asset description and tag table. | `Qwen/Qwen2.5-VL-3B-Instruct` (configurable)                   | Upload (if enabled), or backfill |
| NSFW Detection      | A 0–1 score + private flag; can hide the asset from non-elevated sessions.        | `onnx-community/nsfw_image_detection-ONNX`                     | Upload (if enabled), or backfill |

By default every one of these runs in the `immich-machine-learning` container that ships in the same `docker-compose.yml` as the server. On low-memory hardware (Raspberry Pi, NAS appliances, small VPS) the description and CLIP workloads will be slow, memory-tight, or both. This guide covers the two ways to push the work elsewhere:

1. **Self-hosted remote ML** — run the container on a more powerful machine on your LAN (a desktop with a GPU, an old gaming laptop, a workstation).
2. **Cloud GPU via RunPod** — pay-per-second cloud inference; ideal when you don't own a GPU or only need one briefly for a one-shot backfill.

The two are not mutually exclusive — you can keep a local container as a fallback and let RunPod handle most jobs, or vice versa.

:::info Smart Search and Face _Recognition_
Smart Search and Face Detection use the remote container. Face _Recognition_ (clustering detected faces into people) does NOT — it operates on the embeddings already in your database, so it's purely a Postgres workload between the server and the database.
:::

:::danger Privacy
The asset preview JPEG is sent over the network to whichever ML endpoint is configured — your LAN box, RunPod, or both. The receiving container does not persist images, but it has no built-in security: anyone with network access to its port can submit arbitrary requests. Treat the URL like an internal service. RunPod adds an HTTPS proxy and API-key auth on top, which is enough for most home setups, but the picture data still leaves your hardware.
:::

## Base configuration

If the default in-stack ML container is keeping up with your library, you don't need this guide — just leave the URL list at its default (empty, which means "use the bundled container"). The rest of this page is for when that stops being true.

### Path 1 — Self-hosted remote ML on your LAN

Run the ML container on a beefier machine and point Immich at it.

1. On the remote machine, ensure Docker is installed.
2. Save the following as `docker-compose.yml` on the remote machine:

   ```yaml
   name: immich_remote_ml

   services:
     immich-machine-learning:
       container_name: immich_machine_learning
       # For hardware acceleration, add one of -[armnn, cuda, rocm, openvino, rknn] to the image tag.
       # Example tag: ${IMMICH_VERSION:-release}-cuda
       image: ghcr.io/immich-app/immich-machine-learning:${IMMICH_VERSION:-release}
       # extends:
       #   file: hwaccel.ml.yml
       #   service: # set to one of [armnn, cuda, rocm, openvino, openvino-wsl, rknn]
       volumes:
         - model-cache:/cache
       restart: always
       ports:
         - 3003:3003

   volumes:
     model-cache:
   ```

3. Pull the appropriate `hwaccel.ml.yml` snippet from the [hardware acceleration docs](/features/ml-hardware-acceleration) if you have a GPU. The CUDA variant (`immich-machine-learning:release-cuda`) is required for the image-description workload — the CPU image does not include `torch` and will fail any description job with `ModuleNotFoundError: No module named 'torch'`.

4. `docker compose up -d` on the remote machine.

5. In Immich → **Administration → System Settings → Machine Learning → URLs**, click **Add URL** and enter `http://<remote-ip>:3003`. Save.

6. Confirm the connection from the **Machine Learning Settings** page — the URL turns green when the periodic `/ping` probe succeeds.

#### Keeping the local container as a fallback

The URL list is tried in order. The first URL that returns a non-5xx response wins; if all fail, the job is marked failed (visible under **Administration → Jobs**). To keep a fallback in place, leave the original `immich-machine-learning` service in your main `docker-compose.yml` running and just _add_ the remote URL above it.

If you'd rather not pay the RAM/CPU of a local fallback and accept that ML jobs simply fail when the remote machine is down, remove the `immich-machine-learning` service from the main compose file and delete its URL from the settings. ML jobs will then go to the remote URL only.

:::info Version skew
Mismatched versions between server and ML containers can produce silent failures. When you update the server, update the remote ML container at the same time.
:::

### Path 2 — Cloud GPU via RunPod

If you don't own a GPU (or yours is busy with games), [RunPod](https://www.runpod.io/) gives you cloud inference at per-second billing. Immich's fork integration provisions and manages a RunPod resource for you — you don't need to write any Docker compose or learn RunPod's CLI.

This fork ships a purpose-built ML image, **`ghcr.io/adamtaylor152/immich-machine-learning:fork-main-cuda-runpod`**, which is the standard CUDA image plus four RunPod-tuned defaults:

- Preloads the CLIP and face-detection models at container boot
- Preloads the configured image-description model at container boot (via env var injected by the integration)
- Disables idle model unloading so the GPU stays warm
- Raises the HTTP keep-alive timeout to 90 s to match RunPod's edge proxy

The image works for both Pod and Serverless modes with no changes; the integration picks the right one for you. The setup itself is a six-field form in the admin UI — see [One-time RunPod setup](#one-time-runpod-setup) below.

## When does RunPod make sense?

The hard question with cloud GPU is _how much will I actually spend?_ Two factors dominate: how many photos you process, and which mode you pick.

### How long an ML pipeline takes per asset

On an RTX A5000 (Ampere 24 GB, RunPod's cheapest 24 GB option), the full ML pipeline for one asset breaks down roughly:

| Task              | Time per asset | Notes                                                                     |
| ----------------- | -------------- | ------------------------------------------------------------------------- |
| Smart Search      | 0.05–0.15 s    | CLIP embedding, batch-friendly                                            |
| Face Detection    | 0.05–0.15 s    | Skipped on photos without faces (still a network round trip)              |
| OCR               | 0.3–0.8 s      | Slower on dense receipts/documents                                        |
| Image Description | 3–4 s          | The dominant cost — Qwen2.5-VL-7B inference is a sequence-by-sequence VLM |
| NSFW Detection    | 0.05–0.1 s     | A simple ONNX classifier                                                  |
| **Total**         | **~4–6 s**     | When all five workloads are enabled                                       |

If you've left image description disabled, the per-asset cost drops to **~0.5–1 s** — an order of magnitude cheaper. Most of the math below assumes image description IS enabled, because that's the only workload heavy enough to justify a cloud GPU. If you only need CLIP and face detection, a Raspberry Pi 5 can technically keep up; offloading is overkill.

### Pod vs Serverless: the cost model

| Aspect                    | **Pod** (dedicated)                                                      | **Serverless** (load-balanced)                                                           |
| ------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Billing granularity       | Per-second while pod is **Running** (or **Stopped** for the volume only) | Per-second while a worker is actively processing                                         |
| A5000 active rate         | ~$0.16–0.26 / hr                                                         | ~$0.34–0.43 / hr                                                                         |
| A5000 idle rate           | Same as active — pod is billed continuously while running                | $0 / hr (`Min workers = 0`) — scales to zero                                             |
| First-launch latency      | 2–3 min (full container pull + model download)                           | 30–90 s after the first request once an endpoint exists                                  |
| Subsequent launch latency | 15–30 s (Stopped → Running, volume persists)                             | N/A — workers are recreated each scale event                                             |
| Auto-stop                 | Configurable idle timer (default 15 min)                                 | Configurable per-endpoint idle timeout (default 30 s)                                    |
| Best for                  | Big one-shot backfills, sustained heavy use                              | Trickle uploads, leave-it-on usage where you don't want to think about stopping anything |

The math is straightforward: at $0.16/hr Pod vs $0.43/hr Serverless, the per-active-second cost of Serverless is **2.7×** higher. The crossover is at **~9 hours per day of active ML work** — beyond that, Pod's continuous-billing model wins because the GPU is utilized enough to dilute the fixed cost.

For most home libraries this number is well under 1 hour per day. **Serverless is the correct default**; Pod is only worth it for the initial library scan or if you're processing tens of thousands of new photos a week.

### Cost estimates for typical home libraries

Three sample libraries, all running on `Qwen/Qwen2.5-VL-7B-Instruct` + Smart Search + Face Detection + NSFW (~4 s per asset average):

#### Scenario A — Small library

| Metric              | Value                    |
| ------------------- | ------------------------ |
| Library size        | 5,000 photos             |
| New uploads / month | ~50                      |
| Initial backfill    | ~5.5 hours of GPU time   |
| Ongoing per month   | ~3.5 minutes of GPU time |

| Cost                | Pod (A5000 @ $0.16/hr)      | Serverless (A5000 @ $0.43/hr) |
| ------------------- | --------------------------- | ----------------------------- |
| Backfill (one-time) | $0.88                       | $2.37                         |
| Ongoing per month   | ~$115/month if left running | < $0.05/month                 |

For a small library Pod is the wrong choice unless you remember to **Terminate Pod** the moment the backfill finishes. Serverless costs almost nothing for the ongoing trickle and skips the discipline.

#### Scenario B — Medium library (active photographer)

| Metric              | Value                   |
| ------------------- | ----------------------- |
| Library size        | 25,000 photos           |
| New uploads / month | ~200                    |
| Initial backfill    | ~28 hours of GPU time   |
| Ongoing per month   | ~13 minutes of GPU time |

| Cost                | Pod (A5000 @ $0.16/hr)      | Serverless (A5000 @ $0.43/hr) |
| ------------------- | --------------------------- | ----------------------------- |
| Backfill (one-time) | $4.48                       | $12.04                        |
| Ongoing per month   | ~$115/month if left running | ~$0.09/month                  |

Recommended pattern: launch a **Pod** for the initial backfill, set `Auto-stop after idle = 15 min` and `Max runtime = 36 hr` so it can't run away, then switch the mode to **Serverless** afterwards. You pay $4.48 once, then near-zero ongoing.

#### Scenario C — Large archive, ongoing additions

| Metric              | Value                   |
| ------------------- | ----------------------- |
| Library size        | 100,000 photos          |
| New uploads / month | ~500                    |
| Initial backfill    | ~111 hours of GPU time  |
| Ongoing per month   | ~33 minutes of GPU time |

| Cost                | Pod (A5000 @ $0.16/hr) | Serverless (A5000 @ $0.43/hr) |
| ------------------- | ---------------------- | ----------------------------- |
| Backfill (one-time) | $17.76                 | $47.73                        |
| Ongoing per month   | ~$115/month            | ~$0.24/month                  |

For a 100,000-asset archive, the backfill is worth doing on Pod. After that, Serverless's near-zero ongoing cost dominates.

:::tip "Why is the active rate cheaper on Pod?"
RunPod charges for raw GPU time on Pod (one tenant). On Serverless, the per-second rate is higher because it covers the orchestration cost — RunPod has to spin up workers on demand, route requests through their proxy, and tear them down. You're paying for the convenience of scale-to-zero. For sustained heavy use Pod is a better deal; for spiky use Serverless wins by not billing the idle hours.
:::

### A note on the assumed rates

The numbers above use rough late-2026 RunPod prices for the AMPERE_24 pool (RTX A4000 / A5000-class hardware). **Actual pricing varies** by GPU type, region, and demand. The RunPod console always shows the current rate per pool. Pick the cheapest pool that fits the model you've chosen (see [Choosing a description model](#choosing-a-description-model) below); the integration will let you put multiple pool IDs in priority order and RunPod will use whichever has capacity.

For larger models, the per-hour rate climbs sharply:

| Pool ID        | Typical GPU       | Active rate (Pod ≈ / Serverless ≈) | VRAM   |
| -------------- | ----------------- | ---------------------------------- | ------ |
| `AMPERE_24`    | RTX A4000 / A5000 | $0.16 / $0.43                      | 24 GB  |
| `ADA_24`       | RTX 4090          | $0.40 / $0.79                      | 24 GB  |
| `AMPERE_48`    | RTX A6000         | $0.34 / $0.62                      | 48 GB  |
| `ADA_48_PRO`   | RTX 6000 Ada      | $0.77 / $1.10                      | 48 GB  |
| `AMPERE_80`    | A100 80 GB        | $1.19 / $1.74                      | 80 GB  |
| `ADA_80_PRO`   | L40 / L40S        | $0.86 / $0.99                      | 80 GB  |
| `AMPERE_80_2X` | 2× A100 80 GB     | ~$2.40 / ~$3.40                    | 160 GB |

## Choosing a description model

Image description is the only workload where model choice meaningfully changes both cost and quality. Smart Search and face detection have established defaults that all CUDA hardware can run; you don't pick those.

The fork's admin UI surfaces a **curated dropdown** of supported image-description models. Each option lists a VRAM hint so you can match it to the GPU pool you have access to. The list (newest first):

| Model                                  | VRAM    | Speed (per asset) | Quality                                                                                                                                                 |
| -------------------------------------- | ------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Qwen3-VL-30B-A3B-Instruct** (MoE)    | ~60 GB  | ~3 s              | Roughly between 7B and 32B in quality. Mixture-of-experts activates only ~3B params per token, so it runs near 7B speed.                                |
| **Qwen2.5-VL-72B-Instruct**            | ~144 GB | ~4 s              | Best quality from the 2.5 family. Requires multi-GPU (e.g. `AMPERE_80_2X`). Overkill for most home libraries unless you want near-perfect descriptions. |
| **Qwen2.5-VL-32B-Instruct**            | ~64 GB  | ~3.5 s            | Excellent at complex scenes, fine details, text reading, cultural context. Needs 80 GB GPU. The sweet spot if you can afford it.                        |
| **Qwen2.5-VL-7B-Instruct**             | ~16 GB  | ~3 s              | The recommended balance: good at composition, OCR-in-image, nuanced scenes. Fits on a 24 GB GPU.                                                        |
| **Qwen2.5-VL-3B-Instruct** _(default)_ | ~6 GB   | ~2 s              | Solid for "what's in this photo" — recognises objects, scenes, basic context. The default; works on the cheapest 24 GB pool.                            |

The **Custom…** option lets you paste any Hugging Face model ID. Only Qwen2.5-VL, Qwen3-VL, Phi-3/3.5-vision, and Florence-2 families are loadable on the CUDA path — other model IDs will fail at load time. Pick Custom only if you know exactly what you're choosing.

### Auto-suggested GPU pools

When you select a model from the dropdown and you're in **Serverless** mode, a small blue banner appears with the GPU pools that RunPod has confirmed can run that model:

| Model            | Recommended pools                  |
| ---------------- | ---------------------------------- |
| Qwen2.5-VL-3B    | `AMPERE_24, ADA_24`                |
| Qwen2.5-VL-7B    | `AMPERE_24, AMPERE_48, ADA_48_PRO` |
| Qwen2.5-VL-32B   | `AMPERE_80, ADA_80_PRO`            |
| Qwen2.5-VL-72B   | `AMPERE_80_2X` (multi-GPU)         |
| Qwen3-VL-30B-A3B | `AMPERE_48, AMPERE_80`             |

The banner has an **Apply to GPU pool list** button that overwrites the textarea with the recommendation. The integration never silently rewrites your pool list — you have to click. After clicking you can edit further (re-order, add more pools, mix in `ADA_*` variants).

The pool list is a **fallback chain**, not a load-balancer: RunPod tries the first pool, falls through to the next if capacity is unavailable. Listing two or three pools is good insurance against a single pool being saturated.

### Fallback model behavior

The admin UI also lets you pick a **fallback model** — typically `Florence-2-base-ft` for setups that use a small local CUDA box as backup. The fallback logic has been deliberately split:

- **On local URLs**: if the primary model 500s, Immich retries the same request with the fallback model.
- **On the RunPod managed URL**: the fallback is **never** attempted. The admin picked one model in the dropdown and that's the contract. (Florence's `trust_remote_code` modeling code also can't load on transformers 5.x, so retrying with it would 500 again anyway.)

If you only use RunPod (no local URL), the fallback never runs — but keeping it set doesn't hurt; it just doesn't fire.

## One-time RunPod setup

1. Create a [RunPod API key](https://www.runpod.io/console/user/settings) with **pod + serverless create / read / delete** permission.
2. In Immich → **Administration → System Settings → Machine Learning → Cloud GPU (RunPod)**:
   - Pick a **Mode** (Pod or Serverless).
   - Paste the API key and click **Test connection** — you should see "Connected" and a list of available GPU types load in the dropdown.
   - For **Pod** mode: pick a GPU type from the dropdown (RTX A5000 is the cheapest 24 GB option; RTX 4090 is faster). Set **Auto-stop after idle (minutes)** — 15 is fine for one-off backfills. Set **Max runtime (hours)** — a hard ceiling, default 24, to prevent runaway billing.
   - For **Serverless** mode: leave **GPU pool IDs** at the defaults from the recommendation banner. Adjust **Min workers** (0 for scale-to-zero, 1 to keep one always warm), **Max workers**, and **Idle timeout (seconds)** if needed.
   - Tick the **data privacy acknowledgement** at the bottom.
3. Click **Launch RunPod GPU**.

Provisioning latency depends on mode:

- **Pod first launch**: ~2–3 minutes (full image pull + initial model download).
- **Pod resume from Stopped**: ~15–30 seconds (volume holds the cached weights).
- **Serverless endpoint creation**: ~5–10 seconds.
- **Serverless first cold-start request**: ~30–90 seconds (worker spins up, downloads description model, loads it into VRAM).

While provisioning is in flight, Immich keeps routing ML jobs to your local container if you have one configured. Once the status badge flips to **running** or **serverless-ready**, the cloud GPU takes over automatically. The RunPod URL appears as a read-only chip at the top of the Machine Learning settings page — that's the "managed URL" that takes priority over the editable URL list.

### Description-model preload (the cold-start fix)

When you save a model choice and launch a RunPod endpoint, Immich sets `MACHINE_LEARNING_PRELOAD__IMAGE_DESCRIPTION__VISUAL=<your-model-name>` on the RunPod template. The ML container honours this at container boot — it downloads and loads the VLM into VRAM _before_ accepting any HTTP traffic, so the first real description job arrives at a worker that's already warm.

Without this preload, the first 2–3 description jobs after a cold worker boot would lose the race against RunPod's CloudFlare edge proxy (a 30 s response timeout); the proxy would return 502 and Immich's queue would mark those assets failed. Preloading shifts the model-load cost into the container boot (~60–90 s), which the edge proxy doesn't time-bound.

**Important**: changing the model in the dropdown does **not** retroactively update an existing endpoint's template. To switch models cleanly:

1. Pick the new model in the dropdown and save.
2. Click **Terminate Pod** (in serverless mode this deletes the endpoint + template).
3. Click **Launch RunPod GPU** again. The new template is created with the new preload env.

Until the endpoint is recreated, the old model continues to serve requests. Existing jobs in flight aren't disrupted.

## How RunPod takes priority over your local ML container

Once a RunPod resource reaches a ready state, Immich uses it as the **first choice** for every ML job, regardless of whether you have a local machine-learning container running. Concretely:

| RunPod state                                                                 | What Immich does                                                                                                                   |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **running** (Pod mode) or **serverless-ready** (Serverless mode)             | All ML jobs go to RunPod first. If a request fails (network error, 5xx), Immich falls through to any local URLs you've configured. |
| **provisioning**, **starting**, **serverless-provisioning**, or **stopping** | ML jobs go to your local URLs only. The RunPod URL hasn't been published yet so it isn't a candidate.                              |
| **idle**, **stopped**, or **error**                                          | ML jobs go to your local URLs only. (If you have no local URL configured either, the jobs fail loudly.)                            |
| Mode set to **Disabled**                                                     | RunPod isn't considered at all; only your local URLs are used.                                                                     |

This is driven by the RunPod **state machine** itself, not by a network health probe — so a serverless worker that takes 60 seconds to cold-start no longer gets demoted below your local fallback partway through booting. The first real ML job after an idle period in scale-to-zero mode will simply wait for the worker to come up, then succeed. Subsequent jobs are fast.

## Running a backfill

After RunPod reaches **Running** (Pod) or **serverless-ready** (Serverless), click **Run ML backfill** to enqueue smart-search, face detection, duplicate detection, OCR, image description, and NSFW detection for every eligible asset. RunPod handles the work; the queue progresses asset-by-asset.

For Pod mode, the auto-stop timer kicks in once the queues drain. For Serverless mode, the worker scales back to zero after the idle timeout.

You can also tick **Auto-backfill on launch** to fire the backfill set automatically every time RunPod transitions to a ready state.

## Power-user configurations

### Scenario 1 — Lightweight home library (5K photos, occasional uploads)

**Goal**: cheap ongoing ML; one small backfill at the start.

- **Mode**: Serverless
- **Model**: `Qwen2.5-VL-3B-Instruct`
- **Pools**: `AMPERE_24, ADA_24`
- **Min workers**: 0
- **Max workers**: 1
- **Idle timeout**: 30 s
- **Local fallback**: none (delete URLs from list for strict cloud routing)

Expected monthly cost: < $0.10 ongoing, $0.50 one-time backfill.

### Scenario 2 — Active photographer, 25K library, ~200 photos/week

**Goal**: best-quality descriptions, fast cold-starts, modest monthly bill.

Two phases:

**Phase 1 — initial backfill** (one-time):

- **Mode**: Pod
- **Model**: `Qwen2.5-VL-7B-Instruct`
- **GPU**: RTX A5000 (24 GB) or RTX 4090 if you want it done in ~half the time
- **Auto-stop after idle**: 15 min (safety net)
- **Max runtime**: 36 hr (kill switch in case the queue stalls)
- Tick **Auto-backfill on launch**; click **Launch RunPod GPU**.

Walk away. When the queue drains, the auto-stop will kick in and you'll pay ~$5. **Click Terminate Pod** to release the volume too if you don't plan to relaunch within a few days.

**Phase 2 — ongoing** (steady state):

- Switch **Mode** to Serverless.
- Keep the same model (`Qwen2.5-VL-7B-Instruct`).
- **Pools**: `AMPERE_24, AMPERE_48` (let RunPod pick whichever has capacity).
- **Min workers**: 0 (or 1 if you upload throughout the day and the 60 s cold-start bothers you).
- **Max workers**: 2.
- **Idle timeout**: 60 s (longer than the default — gives a burst upload a chance to land on the same warm worker).

Expected monthly cost: ~$0.10/month ongoing if Min workers = 0, ~$310/month if Min workers = 1.

### Scenario 3 — Large archive, 100K+ photos, near-daily additions

**Goal**: best-quality model with sane cost, batched backfill.

- **Phase 1 backfill**: same as Scenario 2 but use `Qwen2.5-VL-32B-Instruct` on `AMPERE_80` Pod. Costs ~$50 one-time for the backfill; quality is meaningfully better than 7B for complex scenes.
- **Phase 2 ongoing**: switch to Serverless with `Qwen2.5-VL-7B-Instruct` on `AMPERE_24` for the trickle. Mixing model sizes between backfill and ongoing is fine — the only cost is a one-time cold-start for the new model when Serverless first warms up.
- **Min workers**: 0 (1 is uneconomical at $1.74/hr for `AMPERE_80` serverless — ~$1,250/month if left warm).

### Scenario 4 — Strict RunPod-only routing (no local fallback)

If you don't want your jobs silently routed to a CPU-only local container when RunPod has a hiccup:

1. Delete every entry from the URL list (the editable list above the RunPod accordion).
2. Save.

With no local URLs configured, jobs that can't reach RunPod will **fail** rather than degrading to CPU-only inference. Failed jobs show up under **Administration → Jobs**; you can re-run them by clicking the **Missing** button on the relevant queue. This is the configuration you want if "slow but eventually correct" is more important to you than "fast but possibly low-quality from local CPU".

### Scenario 5 — Multi-instance shared RunPod endpoint

If you run two Immich instances (e.g. yours and a partner's) and want them to share one RunPod endpoint to save money:

1. Set up RunPod in **Serverless** mode on instance A as normal.
2. On instance A, find the endpoint URL (visible as the chip at the top of the ML settings page).
3. On instance B, **don't** configure RunPod. Instead, in the URL list, paste instance A's endpoint URL.
4. On instance B you'll need to provide the RunPod API key as the per-URL bearer token (the URL list supports `<url>|<bearer>` syntax — see the placeholder text).

Both instances now route description requests to the same RunPod endpoint. RunPod auto-scales workers to handle the combined load. Each instance pays for its own requests via the same RunPod account.

:::warning
Shared usage is per-account, not per-instance. The single RunPod bill covers both instances. Make sure both Immich admins agree on the model choice — the preload env is set by whichever instance last launched the endpoint.
:::

### Scenario 6 — Keeping one worker always warm

If a 60-second cold-start on the first upload of the day bothers you (the upload UI will appear to hang during this window), set **Min workers = 1**. This keeps a single worker continuously alive.

Cost impact depends on your pool: ~$310/month for AMPERE_24, ~$795/month for AMPERE_80. Only worth it for high-traffic instances; for personal libraries the 60-second cold start once per idle period is usually acceptable.

## Stopping, terminating, and what they cost

### Pod mode

- **Stop** (idle, but still allocated) — the pod is paused but the persistent volume sticks around with your cached model weights. RunPod charges a small monthly storage fee for the volume (~$0.10/GB/month, so typically $1–3/month for a description-model cache). The GPU is no longer billed. The next **Resume** is fast (~15–30 seconds) because models are already on disk.
- **Terminate Pod** (the red button next to Launch) — destroys the pod _and_ its volume. Storage cost goes to zero. The next launch is a full cold start (~2–3 minutes) and re-downloads models. Use this when you don't expect to relaunch within a few days.

### Serverless mode

- Workers scale to zero automatically based on **Idle timeout** — no manual stop needed for normal operation.
- **Terminate Pod** in serverless mode deletes the RunPod endpoint and template entirely (Immich recreates them automatically the next time you click Launch). Useful when you want to switch to a different image-description model (since the preload env is baked into the template at create time) or to release the resources permanently.

## Security

In **Pod** mode the pod is exposed at `https://<pod-id>-3003.proxy.runpod.net` and is reachable from anywhere on the internet. Immich addresses this by generating a per-launch bearer token, injecting it into the container's `IMMICH_ML_AUTH_TOKEN` env var, and adding an `Authorization: Bearer <token>` header to every request. Any request without the matching token gets a 401. Health endpoints (`/`, `/ping`) stay unauthenticated so RunPod's proxy health probes work.

In **Serverless** mode the endpoint is at `https://<endpoint-id>.api.runpod.ai/...` and RunPod's edge proxy enforces auth itself — every request must include `Authorization: Bearer <RUNPOD_API_KEY>`. Immich passes the API key as the bearer to each request automatically; you don't need a separate per-instance secret. The middleware `IMMICH_ML_AUTH_TOKEN` is NOT set in this mode (the double-bearer wouldn't be forwarded through the proxy anyway).

:::danger
The RunPod API key can spin up paid infrastructure. Treat it like a credit-card credential — anyone with admin access to Immich (or read access to its Postgres database) can spend money on your RunPod account. Rotate the key promptly if either is compromised.
:::

## Troubleshooting

### "Failed to enqueue backfill" right after launching

You clicked **Run ML backfill** before RunPod finished provisioning. Watch the status badge — wait for **running** (Pod) or **serverless-ready** (Serverless) before triggering a backfill. The button is disabled while provisioning is in flight; if you see it enabled but get this error, refresh the settings page to clear stale UI state.

### "Machine learning request failed for all URLs (last error: HTTP 502 Bad Gateway)"

Cold-start race. The first 1–2 description jobs after a serverless worker boots can return 502 from RunPod's CloudFlare edge proxy (the 30 s response timeout) while the description model is still being downloaded or loaded into VRAM. With the preload env active (default since the dropdown change), this should be rare — preload runs at container boot _before_ traffic arrives. If you see it consistently:

1. Check that the description model on your endpoint matches what's in the dropdown. If it doesn't (e.g. you changed the model in the dropdown but didn't recreate the endpoint), terminate + relaunch to pick up the new preload env.
2. Watch the RunPod worker logs (RunPod dashboard → Endpoint → Logs) for `Downloading image-description-tagging model 'X' to /cache/...`. That confirms preload is firing.

### "Machine learning request failed for all URLs (last error: HTTP 500 Internal Server Error)"

Worker-level failure. Common causes:

- Local URL is the standard `:release` image which lacks `torch` — the description workload will 500 because the CUDA path imports torch. Either switch to `:release-cuda` locally, or remove the local URL from the settings and let RunPod handle everything.
- Wrong model name in the dropdown's **Custom…** field. Only Qwen2.5-VL, Qwen3-VL, Phi-3/3.5-vision, and Florence-2 families load.
- Out-of-memory on a too-small GPU. If you set the model to Qwen2.5-VL-72B but the pool is `AMPERE_24`, the model loader will OOM. Use the "Apply to GPU pool list" button next to the model dropdown to pick a sane pool.

### "RunPod URL turned green, then turned red"

The `/ping` health probe is the only reason the chip changes colour, but the chip's colour does NOT affect routing decisions — Immich routes by the RunPod state machine, not by /ping. A flaky chip during the first 60 s of a new endpoint is normal (the proxy is being warmed up).

### Worker keeps crashing on launch

Check the RunPod dashboard → Endpoint → Logs. The most common crashes:

- `OOM`: GPU isn't big enough for the model. Use a larger pool or a smaller model.
- `ModuleNotFoundError: No module named 'X'`: the `:fork-main-cuda-runpod` image is stale relative to the configured model. Pull the latest fork image — the model loader requires `transformers` 5.x and `torchvision`.
- `Failed to download from HuggingFace`: HF Hub rate-limited the worker. Wait 5 minutes and retry; for the cuda-runpod image you can set `HF_TOKEN` in the template env to authenticate downloads.

## See also

- [Image Enrichment](/features/image-enrichment) — descriptions, tags, NSFW filtering
- [Hardware-Accelerated Machine Learning](/features/ml-hardware-acceleration) — CUDA, OpenVINO, ARM NN, RKNN local setups
- [Descriptions and Smart Albums](/features/descriptions-and-smart-albums) — how descriptions feed into smart albums

:::tip
For a self-hosted CUDA box on your LAN, Path 1 above is still the right answer — RunPod adds cost and complexity. RunPod is for users without local GPU hardware, or for one-off backfills bigger than your local box can handle in a reasonable time.
:::

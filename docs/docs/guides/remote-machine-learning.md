# Remote Machine Learning

To alleviate [performance issues on low-memory systems](/FAQ.mdx#why-is-immich-slow-on-low-memory-systems-like-the-raspberry-pi) like the Raspberry Pi, you may also host Immich's machine learning container on a more powerful system, such as your laptop or desktop computer. The server container will send requests containing the image preview to the remote machine learning container for processing. The machine learning container does not persist this data or associate it with a particular user.

:::info
Smart Search and Face Detection will use this feature, but Facial Recognition will not. This is because Facial Recognition uses the _outputs_ of these models that have already been saved to the database. As such, its processing is between the server container and the database.
:::

:::danger
Image previews are sent to the remote machine learning container. Use this option carefully when running this on a public computer or a paid processing cloud. Additionally, as an internal service, the machine learning container has no security measures whatsoever. Please be mindful of where it's deployed and who can access it.
:::

1. Ensure the remote server has Docker installed
2. Copy the following `docker-compose.yml` to the remote server

:::info
If using hardware acceleration, the [hwaccel.ml.yml](https://github.com/immich-app/immich/releases/latest/download/hwaccel.ml.yml) file also needs to be added and the `docker-compose.yml` needs to be configured as described in the [hardware acceleration documentation](/features/ml-hardware-acceleration)
:::

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
    #   service: # set to one of [armnn, cuda, rocm, openvino, openvino-wsl, rknn] for accelerated inference - use the `-wsl` version for WSL2 where applicable
    volumes:
      - model-cache:/cache
    restart: always
    ports:
      - 3003:3003

volumes:
  model-cache:
```

3. Start the remote machine learning container by running `docker compose up -d`

:::info
Version mismatches between both hosts may cause bugs and instability, so remember to update this container as well when updating the local Immich instance.
:::

4. Navigate to the [Machine Learning Settings](https://my.immich.app/admin/system-settings?isOpen=machine-learning)
5. Click _Add URL_
6. Fill the new field with the URL to the remote machine learning container, e.g. `http://ip:port`

## Forcing remote processing

Adding a new URL to the settings is recommended over replacing the existing URL. This is because it will allow machine learning tasks to be processed successfully when the remote server is down by falling back to the local machine learning container. If you do not want machine learning tasks to be processed locally when the remote server is not available, you can instead replace the existing URL and only provide the remote container's URL. If doing this, you can remove the `immich-machine-learning` section of the local `docker-compose.yml` file to save resources, as this service will never be used.

Do note that this will mean that Smart Search and Face Detection jobs will fail to be processed when the remote instance is not available. This in turn means that tasks dependent on these features—Duplicate Detection and Facial Recognition—will not run for affected assets. If this occurs, you must manually click the _Missing_ button next to Smart Search and Face Detection in the [Job Status](http://my.immich.app/admin/queues) page for the jobs to be retried.

## Load balancing

While several URLs can be provided in the settings, they are tried sequentially; there is no attempt to distribute load across multiple containers. It is recommended to use a dedicated load balancer for such use-cases and specify it as the only URL. Among other things, it may enable the use of different APIs on the same server by running multiple containers with different configurations. For example, one might run an OpenVINO container in addition to a CUDA container, or run a standard release container to maximize both CPU and GPU utilization.

:::tip
The machine learning container can be shared among several Immich instances regardless of the models a particular instance uses. However, using different models will lead to higher peak memory usage.
:::

## Using RunPod (cloud GPU)

If your hardware can't run smart-search, face detection, OCR, or image description at a reasonable pace, you can offload them to a [RunPod](https://www.runpod.io/) cloud GPU. Immich offers two modes you pick per-instance in the admin panel:

| Mode                       | Active price (A5000 example) | Idle price                     | When to pick                                                          |
| -------------------------- | ---------------------------- | ------------------------------ | --------------------------------------------------------------------- |
| **Pod** (dedicated)        | $0.16/hr                     | $0.16/hr (billed continuously) | Big one-shot backfills, sustained heavy use, lowest active cost.      |
| **Serverless** (on-demand) | $0.68/hr                     | $0.00/hr (`workersMin=0`)      | Trickle uploads, leave-it-on usage, no manual stop discipline needed. |

Break-even is around 6 active hours per 24h — most home libraries with a handful of uploads per day sit well below that and should pick Serverless. Pod still wins for the initial library scan.

This fork ships a purpose-built image, `ghcr.io/adamtaylor152/immich-machine-learning:fork-main-cuda-runpod`, which is identical to the standard CUDA image plus a few RunPod-tuned defaults (preloads the CLIP and face-recognition models at boot, disables idle model unloading, raises the HTTP keep-alive to match RunPod's 100 s proxy timeout). It works for both modes without changes.

### One-time setup

1. Create a [RunPod API key](https://www.runpod.io/console/user/settings) with pod + serverless create/read/delete permission.
2. In Immich → **Administration → System Settings → Machine Learning → Cloud GPU (RunPod)**:
   - Pick a **Mode** — Pod or Serverless.
   - Paste the API key and click **Test connection**.
   - For **Pod** mode: pick a GPU type (RTX A5000 is the cheapest 24 GB option; RTX 4090 is faster). Set **Auto-stop after idle (minutes)** — the default 15 is fine for one-off backfills. Set **Max runtime (hours)** — a hard ceiling, default 24, to prevent runaway billing.
   - For **Serverless** mode: provide an ordered list of **GPU pool IDs** — `AMPERE_24`, `ADA_24`, `AMPERE_48`, etc. (RunPod's serverless API uses pool IDs, not specific types like "NVIDIA RTX A5000"; see [GPU pools](https://docs.runpod.io/references/gpu-types#gpu-pools)). Adjust `Min workers` (default `0` for true scale-to-zero), `Max workers`, and `Idle timeout` if the defaults don't fit. Behind the scenes, Immich creates the endpoint as a **Load Balancer** type (RunPod's GraphQL `type: "LB"`) so it forwards raw HTTP — the REST API doesn't expose this field, so the integration uses the GraphQL `saveEndpoint` mutation.
   - Tick the data-privacy acknowledgement.
3. Click **Launch RunPod GPU**. Pod first launch takes ~2–3 minutes; subsequent resume from a stopped pod takes ~15–30 seconds. Serverless endpoint creation is ~5–10 seconds; the first request afterwards triggers a ~30–60 second cold start while RunPod spins up a worker.

While provisioning is in flight (the status badge shows **provisioning**, **starting**, or **serverless-provisioning**), Immich keeps routing ML jobs to your local container if you have one configured. The status pane shows an animated progress bar; once the badge flips to **running** or **serverless-ready**, the cloud GPU takes over automatically.

You'll see the RunPod URL show up as a read-only chip near the top of the Machine Learning settings page — that's the "managed URL" that takes priority over the editable URL list below it.

### How RunPod takes priority over your local ML container

Once a RunPod resource reaches a ready state, Immich uses it as the **first choice** for every ML job, regardless of whether you have a local machine-learning container running. Concretely:

| RunPod state                                                                 | What Immich does                                                                                                                   |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **running** (Pod mode) or **serverless-ready** (Serverless mode)             | All ML jobs go to RunPod first. If a request fails (network error, 5xx), Immich falls through to any local URLs you've configured. |
| **provisioning**, **starting**, **serverless-provisioning**, or **stopping** | ML jobs go to your local URLs only. The RunPod URL hasn't been published yet so it isn't a candidate.                              |
| **idle**, **stopped**, or **error**                                          | ML jobs go to your local URLs only. (If you have no local URL configured either, the jobs fail loudly.)                            |
| Mode set to **Disabled**                                                     | RunPod isn't considered at all; only your local URLs are used.                                                                     |

This is driven by the RunPod state machine itself, not by a network health probe — so a serverless worker that takes 60 seconds to cold-start no longer gets demoted below your local fallback partway through booting. The first real ML job after an idle period in scale-to-zero mode will simply wait for the worker to come up (~30–90 seconds), then succeed. Subsequent jobs are fast.

If you'd prefer **strict RunPod-only routing** (no local fallback if RunPod is briefly down), open the URL list above the RunPod accordion and delete every entry. With no local URLs configured, ML jobs that can't reach RunPod will fail rather than silently degrading to CPU-only local inference.

### Running a backfill

After the pod reports **Running**, click **Run ML backfill** to enqueue smart-search, face detection, duplicate detection, OCR, image description, and NSFW detection for every eligible asset. The pod handles the work; the auto-stop timer kicks in once the queues drain.

You can also tick **Auto-backfill on launch** to fire the same set automatically every time the pod transitions to **Running**.

### Stopping, terminating, and what they cost

**Pod mode:**

- **Stop** (idle, but still allocated) — the pod is paused but the persistent volume sticks around with your cached model weights. RunPod still charges a small monthly storage fee for the volume (~$0.10/GB/month), but the GPU is no longer billed. The next **Resume** is fast (~15–30 seconds) because models are already on disk.
- **Terminate Pod** (the red button next to Launch) — destroys the pod _and_ its volume. Storage cost goes to zero. The next launch is a full cold start (~2–3 minutes) and re-downloads models.

**Serverless mode:**

- Workers scale to zero automatically based on **Idle timeout** — no manual stop needed for normal operation.
- **Terminate Pod** in serverless mode deletes the RunPod endpoint and template entirely (Immich recreates them automatically the next time you click Launch). Useful when you want to reset configuration cleanly or release the resources permanently.

### Security

In **Pod** mode the pod is exposed at `https://<pod-id>-3003.proxy.runpod.net` and is reachable from anywhere on the internet. Immich addresses this by generating a per-launch bearer token, injecting it into the container's `IMMICH_ML_AUTH_TOKEN` env var, and adding an `Authorization: Bearer <token>` header to every request. Any request without the matching token gets a 401. Health endpoints (`/`, `/ping`) stay unauthenticated so RunPod's proxy health probes work.

In **Serverless** mode the endpoint is at `https://<endpoint-id>.api.runpod.ai/...` and RunPod's edge proxy enforces auth itself — every request must include `Authorization: Bearer <RUNPOD_API_KEY>`. Immich passes the API key as the bearer to each request automatically; you don't need a separate per-instance secret. The middleware `IMMICH_ML_AUTH_TOKEN` is NOT set in this mode (the double-bearer wouldn't be forwarded through the proxy anyway).

:::info Cold-start expectations (serverless mode)
With **Min workers = 0** (true scale-to-zero, the cheapest option), the first ML request after an idle period triggers a worker boot that takes about 30–90 seconds. Immich waits for the worker rather than falling back to local CPU inference, so that first request _will_ feel slow. Subsequent requests, while the worker stays warm, are near-instant. After about 30 seconds of inactivity (configurable via **Idle timeout (seconds)**), RunPod shuts the worker back down and billing stops.

If you'd rather not pay the cold-start latency on every idle-burst:

- **Set Min workers = 1** to keep a single worker warm at all times. Costs roughly $0.68/hour for an A5000-class card (~$490/month if left running 24/7), but eliminates cold starts. Good fit if you upload throughout the day.
- **Schedule your uploads** to land in clusters — uploading 200 photos in one batch only pays the cold-start cost once.
  :::

:::danger
The RunPod API key can spin up paid infrastructure. Treat it like a credit-card credential — anyone with admin access to Immich (or read access to its Postgres database) can spend money on your RunPod account.
:::

:::tip
For a self-hosted CUDA box on your LAN, the standard `Add URL` flow above is still the right answer. RunPod is for users without local GPU hardware.
:::

# Fork Privacy Suite

This page explains what is different in AJ Taylor's maintained Immich fork and how to roll it out safely in a home lab.

The fork is downstream-only. The upstream `immich-app/immich` project did not accept this feature set, so these changes are maintained in this fork instead. The fork is kept up to date with the upstream Immich project while preserving the privacy and image-enrichment features described here.

## Who This Fork Is For

Use this fork if you want Immich to help with one or more of these jobs:

- Generate searchable AI descriptions and tags for photos.
- Detect likely NSFW images and review the result before hiding anything.
- Hide sensitive content unless the current session is unlocked with the locked-folder PIN.
- Suppress selected tags or people, such as medical, legal, family, work, or private project content.
- Keep private content in albums without showing it during normal browsing.
- Run image-enrichment ML on common home-lab hardware, including Intel iGPU/OpenVINO and NVIDIA/CUDA setups.

This fork is not a replacement for backups, access control, or careful human review. ML results can be wrong, and visible tags are search metadata, not a security boundary.

## What Changed

### Image Descriptions and Tags

Admins can enable an optional machine-learning job that looks at image previews and adds:

- an `AI description:` block to the asset description field;
- searchable tags based on visible objects, context, text, and scene details.

Existing user-written descriptions are preserved. Generated descriptions are appended once instead of replacing your own text.

### NSFW Detection

Admins can enable a separate NSFW detection job. The private classifier result is stored separately from visible tags, so privacy decisions are based on private enrichment metadata rather than the public `nsfw` tag.

Admins can review each result, rerun detection, mark an asset safe, mark an asset NSFW, or accept the classifier result.

### PIN-Gated Hiding

When `Hide detected NSFW assets` is enabled, privately flagged assets are hidden from normal browsing until the current session is unlocked with the locked-folder PIN.

Hidden assets are filtered from timelines, search, albums, map markers, downloads, shared-link payloads, sync streams, people, tags, memories, duplicate groups, stacks, and related derived views. Album membership is preserved; the asset is hidden from responses, not removed from the album.

### Suppressed Content

Users can choose tags and people to suppress from normal browsing. This is useful for content that is private but not necessarily NSFW, such as medical photos, legal documents, family situations, private projects, or anything else you tag intentionally.

Suppressed content uses the locked-folder PIN:

1. Locked session: normal views hide ML-detected NSFW content plus selected suppressed tags or people.
2. PIN-unlocked session: normal views can show that content again.
3. Suppressed-only view: `/suppressed` shows only hidden/suppressed content so you can review and organize it.

Suppressing a person is separate from hiding a person card. A suppressed person is used as a privacy browsing filter.

### Navigation Lock

The main navigation includes a lock/unlock control near Upload:

- Locked means sensitive content is hidden.
- Unlocking opens the existing locked-folder PIN flow.
- Unlocked means the current session can view sensitive content.
- Locking again drops elevated access and refreshes views so hidden content disappears.

### Mobile Actions

Mobile multi-select surfaces include actions to mark selected owned remote assets as NSFW or safe again. Server-side filtering applies to mobile clients as well, even where native mobile settings UI is still catching up.

## Recommended Home-Lab Rollout

Start slowly. Do not enable automatic hiding until you have reviewed classifier behavior on your own library.

1. Make a backup and confirm your normal Immich backup plan works. DO NOT SKIP THIS. 
2. Deploy the fork using the fork's server, web, and machine-learning images or build outputs. Do not mix upstream Immich containers with fork-only server or web code.
3. Open `Administration > Settings > Machine Learning Settings`. I have tested this fork on v3.0 and above and did not identify any issues using my existing Immich deployment.
5. Choose the image-enrichment hardware profile that matches your server:
   - `Auto-detect` for most users;
   - `Intel iGPU (OpenVINO)` for Intel integrated graphics;
   - `NVIDIA GPU (CUDA)` for NVIDIA GPU hosts.
6. Enable `Detect NSFW images`.
8. Run `Administration > Jobs > NSFW Detection > All`.
9. Review results in the asset detail panel and tune the threshold if needed.
10. Enable `Hide detected NSFW assets` only after results look acceptable.
11. Enable `Generate image descriptions and tags` if you want AI descriptions and searchable generated tags.
12. Run `Administration > Jobs > Image descriptions and tags > All`.
13. Create or confirm your locked-folder PIN.
14. Use `Account settings > Suppressed content` to add tags or people you want hidden from normal browsing.
15. Use `/suppressed` after PIN unlock to review and organize hidden/suppressed content.

## Suggested Model Settings

For most home-lab installs, start with the defaults selected by the hardware profile.

| Hardware            | Description and tag model                                                     | NSFW model                                 | Device |
| ------------------- | ----------------------------------------------------------------------------- | ------------------------------------------ | ------ |
| Intel iGPU/OpenVINO | `Qwen/Qwen2.5-VL-3B-Instruct` mapped internally to `llmware/qwen2.5-vl-3b-ov` | `onnx-community/nsfw_image_detection-ONNX` | `AUTO` |
| NVIDIA/CUDA         | `Qwen/Qwen2.5-VL-3B-Instruct` through Transformers/PyTorch                    | `onnx-community/nsfw_image_detection-ONNX` | `AUTO` |

If Qwen has trouble on Intel iGPU/OpenVINO, try these description/tag fallbacks in order:

1. `CelesteImperia/MiniCPM-V-2.6-OpenVINO-INT4`
2. `OpenVINO/Qwen2.5-VL-7B-Instruct-int4-ov`
3. `microsoft/Phi-3.5-vision-instruct`

For CUDA/NVIDIA deployments, `microsoft/Florence-2-base-ft` is the lower-resource fallback model.

For NSFW discovery, prefer improving the dedicated NSFW classifier before relying on captions. A classifier with labels such as `porn`, `sexy`, and `hentai` is usually more direct than a general image description model.

## Safe Operating Notes

- Keep regular backups. Privacy filtering is not a backup strategy.
- Review ML results before enabling hiding.
- Use manual overrides when the classifier is wrong.
- Keep visible tags and private classifier state conceptually separate.
- Do not treat generated tags as a security boundary.
- Expect first backfills to take time on large libraries.
- Watch machine-learning container logs during early setup, especially when testing GPU acceleration.
- Keep the fork updated so you continue receiving upstream Immich fixes and improvements.

## More Detailed Docs

- [Image Enrichment](image-enrichment.md)
- [Hardware-Accelerated Machine Learning](ml-hardware-acceleration.md)
- [Administration: System Settings](../administration/system-settings.md)
- [Administration: Jobs and Workers](../administration/jobs-workers.md)

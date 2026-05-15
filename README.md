<p align="center"> 
  <br/>
  <a href="https://opensource.org/license/agpl-v3"><img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg?color=3F51B5&style=for-the-badge&label=License&logoColor=000000&labelColor=ececec" alt="License: AGPLv3"></a>
  <a href="https://discord.immich.app">
    <img src="https://img.shields.io/discord/979116623879368755.svg?label=Discord&logo=Discord&style=for-the-badge&logoColor=000000&labelColor=ececec" alt="Discord"/>
  </a>
  <br/>
  <br/>
</p>

<p align="center">
<img src="design/immich-logo-stacked-light.svg" width="300" title="Login With Custom URL">
</p>
<h3 align="center">High performance self-hosted photo and video management solution</h3>

# Immich Enhanced

A privacy-first, AI-aware Immich fork with Google Photos-like discovery for self-hosted family libraries.

This repository is a maintained downstream fork of Immich for home-lab users who want more control over privacy, storage, search, and local ML-powered image enrichment.

It is designed for users who want to keep the Immich experience they already know, while adding fork-only features for:

- PIN-gated sensitive media hiding
- Optional NSFW/sensitive-content detection
- Local AI-generated descriptions and tags
- Family-library physical deduplication
- Enhanced RAW support for difficult camera files
- Media Health utilities for missing or corrupt source files
- Better duplicate video detection
- Non-destructive photo and video editing
- Natural-language local discovery
- A “Recently Added” media view
- A “Best Photos” view for locally ranked high-quality images

This fork is actively maintained and kept up to date with upstream Immich while preserving the additional features documented below.

> [!CAUTION]
> This is a downstream fork, not upstream Immich. It includes database changes and fork-only features that are not part of `immich-app/immich`.
>
> These database changes are designed to be reversible back to the main Immich branch, so users can switch back if needed. However, as with any fork that modifies application behavior and database state, you should back up your database and media library before upgrading.

Start with the [fork privacy suite guide](docs/docs/features/fork-privacy-suite.md) for setup notes, recommended rollout steps, physical deduplication guidance, and differences from upstream Immich.

---

## Why This Fork Exists

Immich is already excellent. This fork adds features aimed at real home-lab and family-library workflows where users often need more than a standard photo timeline.

Common use cases include:

- Keeping sensitive or private media in normal albums without exposing it in the main UI
- Hiding medical, financial, identity, or personal records from casual browsing
- Letting family members keep separate accounts while avoiding duplicate storage
- Finding receipts, screenshots, forms, places, people, and dates with natural-language search
- Using local GPUs for ML and video workflows where available
- Editing photos and videos without replacing the original upload

This fork is especially useful for users who want a self-hosted photo library that behaves more like a mature family photo platform while still keeping processing local.

---

## Sensitive Media and Privacy Controls

This fork uses the term **NSFW** broadly to describe sensitive or private media that you may want to keep in albums or your library without moving it to a separate locked folder.

That can include:

- Medical photos
- Prescription or health information
- Credit card or financial images
- Identity documents
- Private family media
- Personal records
- Any media you want hidden from the default timeline, albums, and browsing views

Instead of requiring sensitive media to live only in a separate locked folder, this fork adds a PIN-gated privacy mode.

When locked mode is active, sensitive media is hidden from the normal Immich web UI. Hidden assets do not appear in the timeline, albums, or standard browsing views. A lock icon near the upload button allows an authorized user to enter the PIN and temporarily reveal hidden content.

The fork uses the same PIN as Immich’s locked-folder feature.

### What still works while media is hidden

Hidden assets still remain part of the Immich library and can continue to participate in backend functionality such as:

- Deduplication
- Indexing
- Job queue processing
- Album association
- Metadata handling
- Admin review and repair workflows

From the normal web UI, however, hidden media is not visible unless privacy mode is unlocked.

> [!NOTE]
> These controls are intended to reduce accidental exposure in the Immich UI. They are not a substitute for full-disk encryption, strong account security, network security, or proper server access controls.

---

## AI and Privacy Features

This fork adds optional local AI and privacy workflows for users who want richer search and better control over sensitive content.

### Local ML acceleration

- OpenVINO profiles for common Intel iGPU home-lab setups
- CUDA profiles for common NVIDIA GPU setups
- CPU fallback support when GPU acceleration is unavailable

CPU fallback works, but GPU acceleration is strongly recommended for larger libraries or heavier ML workloads.

### Sensitive-content workflows

- Multi-select actions for marking owned remote assets as sensitive or safe again
- Optional NSFW/sensitive-content detection
- Private review state for detected sensitive assets
- Visible tags for review and organization
- PIN-gated hiding for detected sensitive assets
- PIN-gated hiding for user-selected sensitive tags or people
- A private `/suppressed` view for organizing hidden content without losing album context

### Generated descriptions and tags

- AI-generated image descriptions
- Searchable generated tags
- Admin review tools for generated descriptions
- Admin review tools for generated tags
- Admin repair tools for NSFW/sensitive-content decisions

Generated descriptions and tags are currently alpha-quality and expected to improve over time.

---

## Enhanced RAW Support and Media Health

This fork adds admin tools for libraries with RAW camera files, external-library moves, or media that may have gone missing or corrupt over time.

### Enhanced RAW rendering

- Admin toggle under Admin > System Settings > Image
- Enabled by default
- Uses embedded RAW previews first, then falls back to LibRaw/dcraw_emu when a full RAW render is needed
- Helps difficult RAW and .cr2 files generate usable previews and thumbnails
- Keeps unsupported RAW separate from confirmed corrupt-media findings

### Missing media review

- Finds assets whose source files are missing or unreadable
- Locates same-named candidates inside external-library import paths
- Compares candidate media against existing thumbnails or previews before relinking
- Relinks validated external-library matches and leaves uncertain findings for review

### Corrupt media review

- Scans source media for decode failures
- Shows timeline-style findings with thumbnails and error evidence
- Moves recently revalidated corrupt assets to Immich trash only after PIN and typed confirmation
- Separates unsupported RAW files from true corruption so they are not treated as broken originals

---

## Family-Library Physical Deduplication

This fork adds physical deduplication designed for family and multi-user home libraries.

The goal is simple: if multiple users upload the same original file, Immich should not have to store the same bytes multiple times.

Physical deduplication allows non-master users to share exact master-account file bytes while preserving separate:

- User assets
- Albums
- Metadata
- Permissions
- Ownership boundaries

This is useful when family members have overlapping camera rolls, shared vacation photos, copied phone backups, or imported Google Photos archives.

For example, two family members can each have the same photo in their own Immich account, but the server only stores one physical copy of the file.

This does **not** require partner sharing, and it does **not** merge user libraries or permissions.

---

## Enhanced Video Duplicate Detection

This fork improves duplicate detection for videos by sampling multiple internal-only video frames and comparing CLIP embeddings.

This reduces false duplicate groups caused by:

- Black frames
- Title cards
- Intro screens
- Similar opening frames
- Different-resolution copies of the same video

The result is better duplicate detection for real-world video libraries, especially when users import phone videos, edited clips, social-media exports, or multiple-resolution copies.

---

## Non-Destructive Photo and Video Editing

This fork adds non-destructive editing for photos and videos.

The original upload remains untouched. Edited results are saved as Immich-managed copies or derivatives linked to the same asset workflow.

### Built-in video editor

The included video editor supports common Google Photos-style edits, including:

- Trim
- Crop
- Rotate
- Straighten
- Mirror
- Auto enhance
- Stabilization
- Color and lighting adjustments
- Filters
- Text overlays
- Mute and volume controls
- Speed changes
- Export frame

### GPU-aware rendering

Video edit rendering reuses the server’s existing hardware transcoding settings when safe.

When an edit requires CPU-only FFmpeg filters, rendering falls back to software processing automatically.

This gives users the best available performance without making GPU support mandatory for every edit type.

---

## Recently Added and Best Photos

This fork adds two library views for users who want faster ways to rediscover useful media without changing albums or favorites.

### Recently Added

Recently Added shows the newest uploads first, regardless of photo date or EXIF capture date.

This is useful after large imports, phone migrations, Google Photos takeouts, or external-library updates where the files you just added may have old capture dates.

### Best Photos

Best Photos ranks your highest-quality image assets using local scoring from Immich-generated previews.

Scores are computed and stored privately on your server. The feature does not call cloud APIs, create a physical album, duplicate files, or change favorites.

The first version focuses on images and considers practical quality signals such as:

- Sharpness and blur
- Exposure and brightness sanity
- Contrast and detail
- Usable resolution
- Gentle subject-presence signals where available
- Light penalties for screenshot or document-like images

Videos are not scored or used to change thumbnails in this version, but the stored score data is ready for future video-frame scoring.

---

## Ask Search: Google Photos-Like Local Discovery

Ask Search adds a Google Photos-like way to search your self-hosted library using normal language.

The goal is to make Immich easier to search without sending your photo library to a cloud photo service.

Try searches like:

```text
photos in Banff last summer
photos from April 2024
videos since 2020
screenshots from last month
receipts from 2024
photos of Alice in Calgary from April 2024
```

<br/>
<a href="https://immich.app">
<img src="design/immich-screenshots.png" title="Main Screenshot">
</a>
<br/>

<p align="center">
  <a href="readme_i18n/README_ca_ES.md">Català</a>
  <a href="readme_i18n/README_es_ES.md">Español</a>
  <a href="readme_i18n/README_fr_FR.md">Français</a>
  <a href="readme_i18n/README_it_IT.md">Italiano</a>
  <a href="readme_i18n/README_ja_JP.md">日本語</a>
  <a href="readme_i18n/README_ko_KR.md">한국어</a>
  <a href="readme_i18n/README_de_DE.md">Deutsch</a>
  <a href="readme_i18n/README_nl_NL.md">Nederlands</a>
  <a href="readme_i18n/README_tr_TR.md">Türkçe</a>
  <a href="readme_i18n/README_zh_CN.md">简体中文</a>
  <a href="readme_i18n/README_zh_TW.md">正體中文</a>
  <a href="readme_i18n/README_uk_UA.md">Українська</a>
  <a href="readme_i18n/README_ru_RU.md">Русский</a>
  <a href="readme_i18n/README_pt_BR.md">Português Brasileiro</a>
  <a href="readme_i18n/README_sv_SE.md">Svenska</a>
  <a href="readme_i18n/README_ar_JO.md">العربية</a>
  <a href="readme_i18n/README_vi_VN.md">Tiếng Việt</a>
  <a href="readme_i18n/README_th_TH.md">ภาษาไทย</a>
</p>

> [!WARNING]
> ⚠️ Always follow [3-2-1](https://www.backblaze.com/blog/the-3-2-1-backup-strategy/) backup plan for your precious photos and videos!

> [!NOTE]
> You can find the main documentation, including installation guides, at https://immich.app/.

## Links

- [Documentation](https://docs.immich.app/)
- [About](https://docs.immich.app/overview/introduction)
- [Installation](https://docs.immich.app/install/requirements)
- [Roadmap](https://immich.app/roadmap)
- [Demo](#demo)
- [Features](#features)
- [Translations](https://docs.immich.app/developer/translations)
- [Contributing](https://docs.immich.app/overview/support-the-project)

## Demo

Access the demo [here](https://demo.immich.app). For the mobile app, you can use `https://demo.immich.app` for the `Server Endpoint URL`.

### Login credentials

| Email           | Password |
| --------------- | -------- |
| demo@immich.app | demo     |

## Features

| Features                                     | Mobile | Web |
| :------------------------------------------- | ------ | --- |
| Upload and view videos and photos            | Yes    | Yes |
| Auto backup when the app is opened           | Yes    | N/A |
| Prevent duplication of assets                | Yes    | Yes |
| Selective album(s) for backup                | Yes    | N/A |
| Download photos and videos to local device   | Yes    | Yes |
| Multi-user support                           | Yes    | Yes |
| Album and Shared albums                      | Yes    | Yes |
| Scrubbable/draggable scrollbar               | Yes    | Yes |
| Support raw formats                          | Yes    | Yes |
| Metadata view (EXIF, map)                    | Yes    | Yes |
| Search by metadata, objects, faces, and CLIP | Yes    | Yes |
| Administrative functions (user management)   | No     | Yes |
| Background backup                            | Yes    | N/A |
| Virtual scroll                               | Yes    | Yes |
| OAuth support                                | Yes    | Yes |
| API Keys                                     | N/A    | Yes |
| LivePhoto/MotionPhoto backup and playback    | Yes    | Yes |
| Support 360 degree image display             | No     | Yes |
| User-defined storage structure               | Yes    | Yes |
| Public Sharing                               | Yes    | Yes |
| Archive and Favorites                        | Yes    | Yes |
| Global Map                                   | Yes    | Yes |
| Partner Sharing                              | Yes    | Yes |
| Facial recognition and clustering            | Yes    | Yes |
| Memories (x years ago)                       | Yes    | Yes |
| Offline support                              | Yes    | No  |
| Read-only gallery                            | Yes    | Yes |
| Stacked Photos                               | Yes    | Yes |
| Tags                                         | No     | Yes |
| Folder View                                  | Yes    | Yes |

## Translations

Read more about translations [here](https://docs.immich.app/developer/translations).

<a href="https://hosted.weblate.org/engage/immich/">
<img src="https://hosted.weblate.org/widget/immich/immich/multi-auto.svg" alt="Translation status" />
</a>

## Repository activity

![Activities](https://repobeats.axiom.co/api/embed/9e86d9dc3ddd137161f2f6d2e758d7863b1789cb.svg "Repobeats analytics image")

## Star history

<a href="https://star-history.com/#immich-app/immich&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=immich-app/immich&type=date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=immich-app/immich&type=date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=immich-app/immich&type=date" width="100%" />
 </picture>
</a>

## Contributors

<a href="https://github.com/immich-app/immich/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=immich-app/immich" width="100%"/>
</a>

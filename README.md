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

## AJ Taylor's maintained privacy fork

This repository is a maintained downstream fork of Immich for home-lab users who want optional ML image enrichment, stronger privacy controls for NSFW, sensitive, medical, or otherwise private photo groups (we know you don't want to see photos of your EX), and family-library storage tools.

Upstream Immich did not accept this local feature set *because it was "slop,"* so be cautious about using this or other forks not suitable for inclusion in the main codebase. I have maintained the fork here instead of being submitted to `immich-app/immich`. This fork is actively maintained and kept up to date with the upstream Immich project while preserving the fork-only features documented below.

I use the term NSFW generatelly to describe sensitive or private images that you want to keep in Albums without moving them to the locked folder. Yes, you can use it to manage your 🍆 collection, but it's purpose is really to catch the 5 photos from your wife that you don't want your in-laws to see, gross medical photos, perscription information, and other media that you want to keep private.

## AI and Privacy Features
- OpenVINO (Intel iGPU) and CUDA (Nvidia GPU) machine-learning profiles for common Intel iGPU and NVIDIA home-lab setups. The ML features do fall back to CPU, but are not recommended.
- Multi-select actions for marking owned remote assets as NSFW or safe again.
- AI-generated image descriptions and searchable tags (alpha right now, improving later).
- Optional NSFW detection with private review state and visible tags.
- PIN-gated hiding for detected NSFW/sensitive assets and user-selected sensitive tags or people. Uses the same PIN as the locked folder.
- A `/suppressed` private view for organizing hidden/sensitive content without losing album context.
- Admin review and repair tools for generated descriptions, generated tags, and NSFW decisions.

## Deduplicate Content in Multiple Accounts
- Physical deduplication for family libraries, allowing non-master users to share exact master-account file bytes while keeping separate user assets, albums, metadata, and permissions (i.e. you and your family have the same photo, it's only stored once without affecting permissions and doesn't require partner sharing).
- Enhanced video duplicate detection that samples multiple internal-only video frames and compares CLIP embeddings, reducing false duplicate groups caused by black frames, title cards, or intro screens while still matching different-resolution copies.

## Advanced GPU (and non-GPU) Video Editing
- Non-destructive photo and video editing that keeps the original upload untouched and saves the edited result as an Immich-managed copy/derivative on the same asset.
- A built-in video editor for common Google Photos-style edits, including trim, crop, rotate, straighten, mirror, auto enhance, stabilization, color and lighting adjustments, filters, text overlays, mute/volume controls, speed changes, and export frame.
- GPU-aware video edit rendering that reuses the server's existing hardware transcoding settings when safe, then falls back to software rendering when an edit needs CPU-only FFmpeg filters.

## Google Photos-like Discovery
- Ask for photos in normal language, such as "photos in Banff last summer", "receipts from 2024", "videos since 2020", or "photos from last month", and the fork turns that into the right local search filters.
- Search feels more like browsing a personal photo library and less like filling out a database form. Dates, favorites, media type, places, OCR text, and smart-search context can be combined from one simple prompt.
- Document and receipt searches use local OCR-backed metadata, so old screenshots, forms, invoices, and travel paperwork are easier to find without sending your library to a cloud service.
- Smart-search prompts stay local to your Immich machine-learning setup. The feature is meant to bring useful Google Photos-style discovery to a self-hosted library while keeping your media under your control.
- The search response explains what it tried and warns when something is only approximate, such as person-name understanding before full person resolution is available.

## Recently Added Media
- Recently Added left nav function that shows the most recently uploaded media, regardless of EXIF date data.

Start with the [fork privacy suite guide](docs/docs/features/fork-privacy-suite.md) for plain-language setup notes, recommended rollout steps, physical deduplication guidance, and the differences from upstream Immich.

Many thanks to the hard working people at FUTO and all contributors to Immich.

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

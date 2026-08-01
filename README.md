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
- Local AI-generated descriptions and tags for **both images and videos**
- Free-form **custom-instructions** prompt control (e.g. "if you see a car, identify the make and model")
- **Identity-aware descriptions** that name every recognized person and avoid generic group nouns
- **Nested album folders** with custom icons, drag-and-drop organization, and manual reordering
- Family-library physical deduplication
- Enhanced RAW support for difficult camera files
- Media Health utilities for missing or corrupt source files
- Better duplicate video detection
- Original-format-aware duplicate cleanup that keeps your HEIC or RAW instead of a re-encoded JPG
- Live Photo relinking that reunites separated stills and videos
- Non-destructive photo and video editing
- Natural-language local discovery
- A "Recently Added" media view
- A "Best Photos" view for locally ranked high-quality images
- **Server-to-server migration** that moves a user's whole library between Immich servers, resumably, and audits the result

This fork is actively maintained and kept up to date with upstream Immich while preserving the additional features documented below.

> [!CAUTION]
> This is a downstream fork, not upstream Immich. It includes database changes and fork-only features that are not part of `immich-app/immich`.
>
> Compatibility-certified 3.x releases can hand a converted database to the exact matching official Immich image and later return to a compatible fork while fork-owned sidecars remain dormant. Official plugin and workflow rows stay in the official tables and are not migrated by the fork. See [Switching Between the Fork and Official Immich](docs/docs/features/switching-between-fork-and-official.md) for the versioned procedure and required release gates. Always back up both the database and media library before switching.

> [!IMPORTANT]
> **Before upgrading,** read [Configurable Descriptions, Identity, Videos, and Smart Albums](docs/docs/features/descriptions-and-smart-albums.md). The ML description pipeline in this fork has a recommended setup order, a dependency on Enhanced Video Duplicate Detection for video descriptions, and a curated model dropdown that may not include your existing model. Following the guide saves you from re-queueing your whole library more than once. New in this release: video descriptions via composite frame grids, a free-form "custom instructions" prompt field, and stronger identity-injection wording that names every detected person.

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

> [!IMPORTANT]
> **Read [the descriptions, identity, videos, and smart albums guide](docs/docs/features/descriptions-and-smart-albums.md) before upgrading.** This fork's ML description pipeline has a recommended setup order — Facial Recognition → Enhanced Video Duplicate Detection → prompt tuning → identity injection → re-queue → smart albums — and doing it in the wrong order means re-running expensive jobs across your whole library. The guide includes a day-by-day worked example for a typical family library, a recommended-setup-order table, and concrete custom-instructions examples you can paste into your config. Upgrading without reading it will still work, but you will likely re-queue your library more than once before getting the results you want.

- AI-generated image descriptions
- **AI-generated video descriptions** — composites the sampled frames from Enhanced Video Duplicate Detection into a single grid image and feeds it to the vision-language model with a time-aware prompt, so video descriptions reflect the whole timeline instead of one thumbnail
- Searchable generated tags
- Admin review tools for generated descriptions
- Admin review tools for generated tags
- Admin repair tools for NSFW/sensitive-content decisions
- Curated model dropdown (Qwen2.5-VL 3B/7B, Phi-3.5-vision, Florence-2 fallback) with no silent RunPod fallback to a different model
- Configurable prompt vocabulary, length, and tone
- **Custom instructions** — a free-form natural-language field for guidance like _"if you see a car, identify the make and model"_ or _"name the sport being played"_, without rewriting the whole prompt template
- **Identity injection with required-naming wording** — recognized named faces are passed into the description prompt, and the prompt explicitly requires the model to name each detected person and forbids generic group nouns like _"a family"_ or _"a group"_. Result: a 4-person photo says _"Kelly, Connor, Alexa, and Jeremy at the beach"_ instead of _"a family at the beach"_
- Hallucination-prevention post-validator that strips proper nouns the model invented
- **Advanced raw-prompt-template editor with pre-fill and reset** — toggle Advanced on and the textarea is pre-populated with the current default template so you have a working starting point, plus a Reset to default button if you want to discard edits
- Admin status panel with live counts, last-config-change timestamp, and a real rolling-average re-queue time estimate
- Defer-then-remind workflow: "Re-queue later" sets a persistent banner that reminds you to apply prompt changes after a session of edits
- Per-asset status surfaces a `skipped` reason (e.g. `video-frames-unavailable`) when a description can't be generated, so admins know exactly what to fix

Generated descriptions and tags are currently alpha-quality and expected to improve over time.

> [!TIP]
> The [descriptions, identity, videos, and smart albums guide](docs/docs/features/descriptions-and-smart-albums.md) is the single source of truth for this feature set. It includes: a recommended setup order, basic and advanced setup walkthroughs, nine worked custom-instructions examples covering vehicles, sports, travel landmarks, documents, food, pets, tone, and combined family-library prompts, a complete video-descriptions setup section, identity-injection tuning, smart-album triggers, a troubleshooting catalog, and a day-by-day worked example for an 80,000-photo + 3,000-video library.

### Smart auto-albums

Six built-in auto-curated albums populated automatically from generated description tags:

- Travel
- Documents & Receipts
- Screenshots
- Food
- Pets
- Nature

Each album has independently configurable tag triggers and a confidence threshold, and supports per-album re-evaluation against an existing library. Admins can also permanently exclude individual assets from a smart album without affecting their other album memberships.

Smart albums are disabled by default. See the [configurable descriptions, identity, and smart albums guide](docs/docs/features/descriptions-and-smart-albums.md#smart-album-tag-tuning) for tuning details.

---

## Nested Albums and Folder Organization

Standard Immich albums are a single flat list. This fork lets you organize them into **nested folders**, so a large family library can be grouped the way you actually think about it — for example, `2024 ▸ Summer ▸ Beach Trip` — instead of scrolling one long alphabetical wall of albums.

- **Folders within folders** — nest albums to any depth and group related albums together by year, event, trip, person, or however you like
- **Drag-and-drop organization** — drag one album onto another to nest it, or drag to reorder; works in both the album grid and the album tree
- **Custom album icons** — give any album an icon from a built-in catalog so folders are easy to recognize at a glance
- **Album tree in the sidebar** — browse and jump around your hierarchy from a collapsible tree, with breadcrumbs on every album page so you always know where you are
- **Manual reordering** — arrange albums and sub-albums in the order that makes sense to you, not just by name or date
- **Top-level or fully expanded** — toggle between seeing only your top-level folders or your whole album tree at once
- **Safe by design** — you can't accidentally nest an album inside one of its own sub-albums, and deleting a folder that still contains sub-albums warns you first, with a count of what would be affected

Nested albums are purely an organization layer on top of the albums you already have: your photos, album contents, and sharing are unchanged — you're simply grouping albums into folders. Album organization (the tree, drag-and-drop, icons, and reordering) lives in the web app.

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

## Live Photo Relinking

An Apple **Live Photo** is really two files — a still photo and a short video — stored together. When those parts get uploaded or imported separately (for example from a backup, a desktop sync, or a third-party export), Immich shows them as two unrelated items instead of one playable live photo.

This fork adds a utility that finds those separated pairs and reassembles them.

- Available to every user under **Utilities → Relink live photos**
- Matches pairs primarily on the identifier Apple embeds in both files, so confident matches are exact
- Adds a best-effort fallback for files whose metadata was stripped, matching on filename and capture time — these are shown as lower-confidence matches for you to review before relinking
- Relinking hides the standalone video and restores the playable live photo, just as if it had been uploaded intact

Note: the optional AAC audio track that some live photos include is not part of the reassembled pair.

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

## Smarter Duplicate Keep Suggestions

When you review duplicates, this fork suggests keeping the **original** version of a photo instead of whichever copy happens to be the largest file.

Apple devices capture in **HEIC**, and many cameras shoot **RAW** (DNG and similar). When those originals get re-saved or shared, they often become larger JPGs that look bigger on disk but are actually a lower-quality re-encode. Standard Immich would suggest keeping that bigger JPG; this fork knows the native original is the better one to keep.

- Prefers native originals when choosing which duplicate to keep — **RAW first, then HEIC/HEIF**, then everything else
- Wins even when the JPG copy is larger in file size
- Falls back to the usual file-size and metadata comparison when every copy is the same kind of file
- **On by default**, and can be turned off under **Admin > System Settings > Machine Learning > Duplicate Detection**

This only changes which asset is pre-selected as the keeper in the duplicate review — nothing is deleted automatically.

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

---

## Server-to-Server Library Migration

This fork adds an `immich migrate` command that moves **one user's entire library from one Immich server to another** over the API — originals, albums, tags, descriptions, and everything else — then **audits the result** so you can safely retire the old server.

It is built for real migrations: consolidating two home-lab servers, moving to new hardware, or folding a second instance into your main one.

Two things make it practical for large libraries:

- **It resumes.** Runs are checkpointed to a local database, so a migration of hundreds of thousands of assets can be interrupted — Ctrl+C, a reboot, a dropped VPN, a full disk — and picked up exactly where it left off by re-running the same command.
- **It never stores a file twice.** Every upload is hash-matched by the destination, so files it already has are linked instead of duplicated, and re-running a finished migration transfers nothing.

Nothing is ever deleted from the source server. This is a copy-then-verify operation, and you decide when to decommission the old server.

### Before you start

You need an API key **for the user being migrated, on both servers**.

An admin key will not work. In Immich an API key can only reach the library of the user it belongs to, and anything it uploads is owned by that same user — so an admin key would copy the library into the admin's own account instead. Migrate one user at a time, with that user's own key on each side.

Sign in as the user on each server, go to **Account Settings → API Keys**, and create a key with:

| Server                        | Required permissions                                                                           | Optional                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Source** (moving _from_)    | `asset.read`, `asset.download`, `album.read`, `tag.read`                                       | `stack.read`, `person.read`                                     |
| **Destination** (moving _to_) | `asset.upload`, `asset.update`, `album.create`, `albumAsset.create`, `tag.create`, `tag.asset` | `stack.create`, `person.create`, `person.reassign`, `face.read` |

A key with the `all` permission also works. The command verifies permissions on startup and names anything missing. The optional ones only affect stacks and people; without them those items are skipped and everything else still migrates.

If the two accounts have different email addresses the command warns and continues, since the same person often has different logins on each server — but check the warning, because everything is uploaded into whichever account the destination key belongs to.

If the user doesn't exist on the destination yet, create the account there first, then sign in as them to generate the key.

### Building the CLI

`migrate` is fork-only, so build the CLI from this repository instead of installing `@immich/cli` from npm:

```bash
pnpm install
pnpm --filter @immich/sdk build
pnpm --filter @immich/cli build
```

Run it from anywhere that can reach both servers — a laptop, or ideally a machine on the same network as one of them. Each file is streamed to a temporary folder next to the ledger and deleted immediately after upload, so you only need enough free disk for the files in flight, not for the whole library.

### Preview it first

Start with a dry run. It inventories the source, asks the destination what it already has, and writes an audit report — without changing anything on the destination:

```bash
node packages/cli/dist/index.js migrate \
  --from-url https://old-server.example.com/api --from-key <SOURCE_KEY> \
  --to-url   https://new-server.example.com/api --to-key   <DEST_KEY> \
  --dry-run
```

### Run the migration

Drop `--dry-run` and add `--serve` to get a live progress dashboard:

```bash
node packages/cli/dist/index.js migrate \
  --from-url https://old-server.example.com/api --from-key <SOURCE_KEY> \
  --to-url   https://new-server.example.com/api --to-key   <DEST_KEY> \
  --serve
```

Open <http://127.0.0.1:2285> to watch progress, pause, resume, or stop.

The dashboard is only a window onto the migration — the work happens in the terminal process. **You can close the browser, or the whole tab, and the migration keeps running.** Reopen the page any time to check on it.

To avoid putting API keys in your shell history, use environment variables instead: `IMMICH_FROM_URL`, `IMMICH_FROM_KEY`, `IMMICH_TO_URL`, `IMMICH_TO_KEY`.

### If it stops, just run it again

Press Ctrl+C, lose the network, or reboot the machine — nothing is lost. Re-run the exact same command and it continues, skipping everything already done and reporting what it resumed:

```text
Resuming: 148291/512773 assets already on B.
```

Progress lives in the ledger file (`./immich-migrate.sqlite` by default). Keep it until the migration is verified complete. If some assets failed — a corrupt source file, a timeout — the run continues past them, records them, and you can retry just those with `--retry-failed`.

### Confirming it's safe to decommission

A run that reaches the end performs an audit that re-checks **every single source asset against the destination by file hash**, then prints a summary. (If you stop a run part-way, the audit is reported as `AUDIT INCOMPLETE` rather than a pass — it can only clear the source server once it has checked everything.)

```text
──────── Migration summary ────────
Assets:  512773/512773 on B   (0 failed, 0 missing)
Albums:  184/184   Tags: 96/96
Stacks:  312/312   People: 47/47
Audit report: ./immich-migrate.sqlite.audit.json
Ledger:       ./immich-migrate.sqlite

✅ PASS — every asset is present on SERVER B. SERVER A is safe to decommission.
```

Anything short of `PASS` names the specific assets still missing, both on screen and in the audit report file (`<ledger>.audit.json`). **Only retire the source server once you see the PASS line.** The command also exits with a non-zero status when the migration is incomplete, so it can be checked from a script.

### What gets moved

**Copied to the destination**

- Original photo and video files, byte for byte
- Live Photo pairing (still + video)
- Albums — including nested folders, custom icons, sort direction, and thumbnails
- Tags — including the full nested hierarchy
- Descriptions, including AI-generated text from this fork
- Capture date, GPS location, and star rating
- Favorites and archived status
- Stacks
- AI enrichment data (detected objects, generated tags, sensitive-content review state)
- People's names

**Rebuilt automatically by the destination**

- Thumbnails and previews
- Face detection and clustering
- Smart-search embeddings
- Reverse-geocoded city, state, and country names

**Not migrated**

- Album sharing, activity, and comments
- Anything owned by a different user — migrate each user separately

> [!NOTE]
> People's **names** always transfer, but linking them back to faces is best effort: the destination re-runs its own face detection, so a face must already be detected there before a name can be attached to it.
>
> For the best result, migrate with `--no-faces` first, wait for the destination to finish its face-detection jobs, then re-run without the flag to attach names to the faces it found. If people were already processed too early, re-run with `--retry-failed` to try them again.
>
> When an asset has **more than one** face, there's no way to tell which one was the named person (face data doesn't cross between servers), so those are skipped rather than risk putting the wrong name on someone. The per-person progress line reports how many faces were attached and how many were skipped as ambiguous or not-yet-detected.

### Options

| Option                       | Description                                                       |
| ---------------------------- | ----------------------------------------------------------------- |
| `--from-url`, `--from-key`   | Source server API URL and that user's API key                     |
| `--to-url`, `--to-key`       | Destination server API URL and that user's API key                |
| `-n, --dry-run`              | Preview what would move; writes nothing to the destination        |
| `--serve`                    | Serve the progress dashboard on `127.0.0.1`                       |
| `--port <number>`            | Dashboard port (default `2285`)                                   |
| `-c, --concurrency <number>` | Assets transferred in parallel (default: CPU cores − 1)           |
| `-l, --ledger <path>`        | Resume/audit database (default `./immich-migrate.sqlite`)         |
| `--retry-failed`             | Retry assets that failed on an earlier run, and re-attempt people |
| `--include-trashed`          | Also migrate trashed assets                                       |
| `--no-faces`                 | Skip people and face migration                                    |

Run `node packages/cli/dist/index.js migrate --help` for the full list.

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
  <a href="readme_i18n/README_bg_BG.md">Български</a>
  <a href="readme_i18n/README_pt_BR.md">Português Brasileiro</a>
  <a href="readme_i18n/README_sv_SE.md">Svenska</a>
  <a href="readme_i18n/README_ar_JO.md">العربية</a>
  <a href="readme_i18n/README_vi_VN.md">Tiếng Việt</a>
  <a href="readme_i18n/README_th_TH.md">ภาษาไทย</a>
  <a href="readme_i18n/README_ml_IN.md">മലയാളം</a>
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

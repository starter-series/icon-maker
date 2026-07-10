# Changelog

All notable changes to `icon-maker` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Added provider-neutral `--brief` schema version 2 with `requestType` values
  `direction-discovery`, `direction-review`, `image-generation`, and `compile`;
  machine-readable target constraints, bounded local brand evidence,
  source-contract, provider-boundary, and approval metadata remain offline.
  `imagePrompt` is non-null only for an explicitly approved image-generation request.
- Added lossless direction round trips through `--direction-name`, `--concept`,
  `--expresses`, `--visual-metaphor`, `--mood`, `--tradeoff`, optional
  `--palette` / `--avoid`, and matching `design` config fields. Partial input is
  retained for review before `--approve-direction` or `design.approved: true`.
- Added explicit `--placeholder` mode for deterministic temporary artwork.
- Added `--source <path>` for compiling a project-local SVG or PNG directly,
  including source metadata and raster upscaling warnings in JSON results.
- Added `--adaptive-source` and `mark.source.adaptiveForeground` for supplying
  the transparent foreground that Expo adaptive icons require.
- Added the `apple` target with an iOS single-size entry, the complete macOS
  size matrix, and Xcode `AppIcon.appiconset/Contents.json` generation.
- Added safe Xcode asset-catalog autodetection plus explicit
  `apple.assetCatalog` / `apple.appIconSet` routing for ambiguous projects.

### Changed
- Missing approved source artwork is now a usage error. The built-in geometric
  mark is no longer an implicit fallback when `mark.source` is absent.
- The agent skill now blocks image generation while direction is missing or
  unapproved, offers exactly three complete text-only hypotheses when needed,
  preserves a selected hypothesis through direction approval, then presents
  the generated candidate for separate artwork approval before compilation.
- The skill continues to forbid hand-authored SVG synthesis as a fallback.
- Image-generation handoff now prefers a 1024px PNG; SVG remains accepted when
  it is native vector artwork from a trusted source.
- Added packed-install smoke coverage so CI verifies the packed tarball inside a
  fresh consumer project through both the CLI and programmatic API.
- Clarified pre-release local/source-checkout usage before npm publication.
- Narrowed the public API surface to the documented `makeIcons()` export.
- Consolidated target mark presets and patch roles into target metadata.
- Reused same-size raster outputs within one generation run to avoid duplicate
  PNG work for multi-target and container outputs.
- Apple source outputs flatten onto the configured background and are encoded
  as RGB PNGs without an alpha channel.
- External sources render once per background variant; smaller PNG, ICO, and
  ICNS entries reuse an alpha-aware downsampled pixel buffer from a canonical
  master so output does not depend on other selected targets.
- Existing generated files are left untouched when their bytes are already
  current, preserving Xcode and other incremental-build timestamps.

### Fixed
- Report CLI usage errors, including unknown flags and unknown targets, with
  the documented exit code `2` and parseable `--json` error output.
- Keep `--json` stdout parseable even when a trusted local `.js` config writes
  synchronous or delayed incidental output while loading.
- Honor `--init --config <path>` by creating and reporting the requested config
  file, including data-only `.json` configs.
- Render non-square `mark.source` SVGs into square PNG/ICO/ICNS canvases and
  reject source paths that resolve outside the target directory.
- Refuse source/output collisions and output paths that escape through
  symlinks before rendering or writing any generated files.
- Preserve empty Xcode appearance slots and metadata, detect the selected App
  Icon set name, and refuse to overwrite sets that reference unmanaged files.
- Unwrap exact fenced SVG responses, reject surrounding prose, and identify
  PNG input before scanning text content for SVG markup.
- Warn when `--patch` has no matching manifest instead of silently returning an
  empty patch list.

## 0.1.0 - 2026-06-23

### Added
- Initial deterministic icon compiler with SVG source and PNG outputs for
  `browser-extension`, `expo`, `electron`, `vscode`, `pwa`, `mcp-connector`,
  and `generic` targets.
- CLI with target autodetection, optional path argument, `--json`, `--dry-run`,
  `--out-dir`, `--preview`, `--patch`, and target-aware `--init`.
- Programmatic `makeIcons()` API.
- Claude Code skill and plugin metadata for agent discovery.
- Manifest patching for extension `manifest.json`, Expo `app.json`, package
  `icon` fields, and PWA `public/manifest.json`.
- Transparent Expo adaptive icon foreground output.
- PNG-backed `.ico` and `.icns` containers for Electron and web/PWA surfaces.
- `mark.source` support for compiling a finished SVG brand mark into the same
  platform output sets.
- `icon-preview.html` contact sheet generation.
- JSON patch writes preserve indentation/EOLs and skip already-current files.

[Unreleased]: https://github.com/starter-series/icon-maker/compare/main...HEAD

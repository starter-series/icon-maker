# Changelog

All notable changes to `icon-maker` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Added a read-only `--check` API/CLI contract with `--strict`, structured
  diagnostics, exit-code enforcement, PNG chunk CRC validation, nested ICO/ICNS
  payload checks, Apple RGB checks, Android XML checks, and supported project
  wiring verification.
- Added native Android project discovery, density-specific legacy/round/adaptive
  PNGs, v26/v33 adaptive XML, background color resources, optional separately
  sourced Android 13 monochrome artwork, and conservative AndroidManifest
  launcher-field patching.
- Added safe PWA `.json`/`.webmanifest` discovery for `public` and `www`, output
  routing beside the resolved manifest, and optional maskable/monochrome entries
  only when distinct approved source roles are supplied.
- Added Apple Icon Composer artifact discovery and `auto` / `legacy` /
  `icon-composer` delivery-mode gates. Existing `.icon` files/packages are
  verified as pass-through artifacts and never synthesized or overwritten.
- Added real Electron packager wiring for electron-builder platform icon fields
  and static Electron Forge `packagerConfig.icon`, with conservative warnings
  for dynamic, ambiguous, unsupported, or unmanaged configurations.
- Added role-specific `--maskable-source` / `--monochrome-source` CLI inputs and
  `maskable`, `round`, and `monochrome` config source roles.
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
- Compile results now expose `schemaVersion: 1` and `kind: "compile"` through
  both the CLI and programmatic API.
- All generated assets, preview output, and supported project patches are
  planned before mutation and committed through a rollback-capable multi-file
  write transaction. Existing leaf symlinks and conflicting transaction writes
  are rejected.
- Electron ICNS output now includes the complete modern PNG-backed 16, 32, 64,
  128, 256, 512, and 1024 size set.
- Expo source compilation now requires a distinct adaptive foreground instead
  of silently reusing a potentially opaque default source; patching also wires
  background color and optional monochrome artwork.
- Split icon compilation into explicit prepare, output-plan, render, and write
  phases while preserving the all-render-and-validate-before-write invariant.
- Centralized source/output containment and real-file identity checks in one
  path-safety policy shared by generation, source loading, and Apple routing.
- Replaced the CLI parser's option branch chain with value/flag definitions and
  an isolated option-combination validator.
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
- Kept the public API surface to the documented `makeIcons()` and read-only
  `checkIcons()` exports.
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
- Keep the exclusive writable staging handle open through write and fsync;
  reopening it read-only caused every transaction to fail on Windows.
- Validate original PNG/SVG source data before embedding it, preventing invalid
  nested images from silently producing blank icons. Check SVG document parsing,
  Apple slot metadata, and Icon Composer PNG/SVG layer data as well as filenames.
- Reject empty adaptive/monochrome foregrounds and malformed JSON wiring roots;
  discover optional role assets inside the selected staging directory.
- Preserve semantically current PWA manifest bytes instead of treating formatting
  alone as broken wiring, and avoid shadowing external electron-builder configs.
- Include supported optional source roles in brief JSON, and update vulnerable
  transitive brace-expansion dependencies without changing runtime dependencies.
- Block malformed or unreadable patch targets before any icon output is
  committed; validate PWA JSON roots, Expo object shapes, and Android XML
  structure instead of reporting a partial patch as successful.
- Decode PNG IDAT scanlines (including nested ICO/ICNS payloads), reject
  unsupported critical chunks and invalid palettes, and require real transparent
  pixels for adaptive/monochrome foreground output.
- Preserve original bytes through a verified copy fallback when a rollback
  rename also fails, without deleting the only remaining backup.
- Validate Icon Composer metadata, referenced package assets, Xcode file
  references, and the matching App Icon build setting instead of accepting any
  non-empty `.icon` path.
- Treat coexisting Expo dynamic config as unverified/no-op wiring, and infer
  one-shot optional role assets from persisted PWA/Expo/Android wiring during
  later checks.
- Reject Android manifests with invalid entities, misplaced CDATA/declarations,
  duplicate attributes, or a missing/nonstandard `xmlns:android` binding before
  launcher resources are committed.
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
- Prevent an escaping manifest symlink or malformed PWA manifest from leaving
  generated assets, previews, or patches partially committed.
- Stop treating Electron's unrelated top-level `package.json.icon` field as
  desktop packager wiring.

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

# Changelog

All notable changes to `@starter-series/icon-maker` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/starter-series/icon-maker/compare/v0.1.0...HEAD

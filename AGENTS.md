# Icon Maker

Deterministic icon-set generator for Starter Series launch surfaces. Vanilla JS,
CommonJS, no runtime dependencies, no build step.

## Run this tool (for agents)

Generate icon assets from a repo:

```bash
npx @starter-series/icon-maker --target auto --json
npx @starter-series/icon-maker <path> --target browser-extension --patch --json
```

`--json` prints exactly one JSON object to stdout. Exit codes: `0` ok, `1`
runtime failure, `2` usage/init conflict.

## Structure

```
src/
  generate.js  -> makeIcons(config, opts): target resolution, SVG/PNG/ICO/ICNS writes, optional patches/preview
  targets.js   -> target definitions and repo autodetection
  mark.js      -> deterministic vector primitive construction
  png.js       -> tiny RGBA PNG encoder/rasterizer using Node zlib
  svg.js       -> SVG source renderer from the same primitives
  source.js    -> custom SVG source loading + resvg rasterization
  containers.js -> PNG-backed ICO/ICNS encoders
  preview.js   -> icon-preview.html contact sheet renderer
  patch.js     -> manifest/app/package icon field patchers
  config.js    -> icon-maker.config.js defaults, loading, validation
  cli.js       -> CLI argument parsing and --init helper
  index.js     -> public API
bin/icon-maker.js -> CLI wrapper over makeIcons(); --json agent contract
skills/create-icons/ -> Agent skill wrapping the CLI
```

## Invariants

- Keep runtime dependencies scarce and explicit. `@resvg/resvg-js` exists only
  so custom SVG source files can become PNG/ICO/ICNS assets.
- `icon-maker.config.js` is the source of project intent. Platform-specific file
  paths and manifest fields are mechanical outputs.
- `--json` must keep stdout parseable as one JSON object.
- Do not add an MCP server until there is a fast, structured query surface that
  is useful without writing files. Generation remains CLI-owned.
- Optional `--patch` should only touch known icon fields in known manifest files.
  Preserve JSON indentation/EOLs and skip writes when values are already current.

## Dev

```bash
npm install
npm run lint
npm test
```

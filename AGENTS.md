# Icon Maker

Deterministic delivery icon compiler for Starter Series launch surfaces. Vanilla JS,
CommonJS, no build step. Runtime dependencies are scarce and explicit:
`@resvg/resvg-js` is present only for rasterizing custom SVG/PNG source files.

## Run this tool (for agents)

Compile icon assets from this source checkout:

```bash
node bin/icon-maker.js --brief --target apple,browser-extension,pwa
node bin/icon-maker.js --source ./brand/icon.svg --target apple,pwa --preview --json
node bin/icon-maker.js --source ./brand/icon.svg --adaptive-source ./brand/icon-adaptive.svg --target expo --preview --json
node bin/icon-maker.js --target auto --json
node bin/icon-maker.js <path> --target browser-extension --patch --json
```

After `iconkit` is published to npm, the equivalent public commands are:

```bash
npx iconkit --brief --target apple,browser-extension,pwa
npx iconkit --source ./brand/icon.svg --target apple,pwa --preview --json
npx iconkit --source ./brand/icon.svg --adaptive-source ./brand/icon-adaptive.svg --target expo --preview --json
npx iconkit --target auto --json
npx iconkit <path> --target browser-extension --patch --json
```

`--json` prints exactly one JSON object to stdout. Exit codes: `0` ok, `1`
runtime failure, `2` usage/init conflict.

## Structure

```
src/
  generate.js  -> makeIcons(config, opts): target resolution, SVG/PNG/ICO/ICNS writes, optional patches/preview
  targets.js   -> target definitions and repo autodetection
  apple.js     -> Xcode project/catalog discovery and safe Apple output routing
  brief.js     -> provider-neutral design brief generation for human/chat handoff
  mark.js      -> deterministic vector primitive construction
  png.js       -> tiny RGBA PNG encoder/rasterizer using Node zlib
  svg.js       -> SVG source renderer from the same primitives
  source.js    -> custom SVG/PNG source loading + resvg rasterization
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
  so custom SVG/PNG source files can become platform assets.
- Design providers are optional upstream inputs. `--brief` and `--source` must
  remain usable without an MCP server, plugin, account, or network call.
- Apple output may auto-route only when one Xcode asset catalog is unambiguous.
  Multiple catalogs require explicit `apple.assetCatalog` configuration, and
  multiple selected icon names require `apple.appIconSet`.
- Never overwrite an existing App Icon set that references unmanaged files.
  Apple PNGs must be RGB without an alpha channel.
- Every source and output must stay inside the target checkout after resolving
  symlinks. A generated output must never overwrite its source file.
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
npm run pack:install-smoke
npm run xcode:smoke # macOS/Xcode only
```

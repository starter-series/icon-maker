# Icon Maker

Deterministic delivery icon compiler for Starter Series launch surfaces. Vanilla JS,
CommonJS, no build step. Runtime dependencies are scarce and explicit:
`@resvg/resvg-js` is present only for rasterizing custom SVG/PNG source files.

## Run this tool (for agents)

Compile icon assets from this source checkout:

```bash
node bin/icon-maker.js --brief --target apple,browser-extension,pwa --json
node bin/icon-maker.js --source ./brand/icon.png --target apple,pwa --preview --json
node bin/icon-maker.js --source ./brand/icon.png --adaptive-source ./brand/icon-adaptive.png --target expo --preview --json
node bin/icon-maker.js --placeholder --target auto --json
node bin/icon-maker.js <path> --source ./brand/icon.png --target browser-extension --patch --json
```

After `iconkit` is published to npm, the equivalent public commands are:

```bash
npx iconkit --brief --target apple,browser-extension,pwa --json
npx iconkit --source ./brand/icon.png --target apple,pwa --preview --json
npx iconkit --source ./brand/icon.png --adaptive-source ./brand/icon-adaptive.png --target expo --preview --json
npx iconkit --placeholder --target auto --json
npx iconkit <path> --source ./brand/icon.png --target browser-extension --patch --json
```

`--json` prints exactly one JSON object to stdout. Exit codes: `0` ok, `1`
runtime failure, `2` usage/init conflict.

## Agent source acquisition

- If an approved project-local SVG/PNG already exists, skip image generation
  and compile that source.
- If no source exists and the user explicitly asks to create or acquire a
  design, run `--brief --json`, pass its prompt and source contract to an
  available image-generation model, and present the resulting image for review.
- Never hand-author SVG primitives, canvas code, or CSS art as a fallback for
  unavailable image generation. Return the source request and wait for an
  approved asset instead.
- Do not compile, patch, or treat generated artwork as project intent until the
  user explicitly approves it. After approval, materialize the PNG/SVG inside
  the target checkout, compile with `--preview`, then patch in a separate step.
- Use a provider's local output path when one exists. If it returns only a
  conversation image, wait for the approved image to be attached/exported;
  never recreate it with SVG primitives or a screenshot.
- `--placeholder` is only for an explicitly requested deterministic temporary
  mark. It is not a substitute for image generation or approved artwork.

## Structure

```
src/
  generate.js  -> makeIcons(config, opts): target resolution, SVG/PNG/ICO/ICNS writes, optional patches/preview
  targets.js   -> target definitions and repo autodetection
  apple.js     -> Xcode project/catalog discovery and safe Apple output routing
  brief.js     -> image-generation/source request for upstream provider handoff
  workflow.js  -> source acquisition, image-generation handoff, approval and placeholder policy
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
- Design providers are optional upstream inputs. The CLI never calls them or
  requires network access. Agent workflows may invoke an available image model
  before compilation, but must keep approval and source handoff explicit.
- Missing source is an error by default. Built-in deterministic artwork is
  available only through explicit `--placeholder` intent.
- Never synthesize hand-authored SVG as a fallback for an unavailable image
  model. Image-generation output is a candidate, not approved project intent.
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

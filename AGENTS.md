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
  and compile that source. A configured `mark.source` makes `--brief` return
  `workflow.state: "ready-to-compile"`.
- Otherwise run `--brief --json` first. It resolves technical target constraints
  and performs a bounded local scan for brand assets, guidance documents, and
  palette evidence. Treat discovered evidence as evidence, not approved intent.
- Every brief JSON uses `schemaVersion: 2`. Its `requestType` is
  `direction-discovery`, `direction-review`, `image-generation`, or `compile`,
  matching the four workflow states below.
- When `workflow.state` is `needs-direction`, concept or mood is missing and
  `requestType` is `direction-discovery`; `imageGenerationAllowed` is `false`.
  Never pass that prompt to an image model.
- If the user is unsure, present exactly three text-only hypotheses. Each must
  include a name, what it expresses, visual metaphor, mood, and tradeoff. Label
  them as hypotheses and wait for the user to select, combine, revise, or reject.
  Ground meaning in product context and user-confirmed brand evidence; use
  technical constraints only to check feasibility, never to invent intent.
- Round-trip the selected hypothesis unchanged with `--direction-name`,
  `--concept`, `--expresses`, `--visual-metaphor`, `--mood`, and `--tradeoff`,
  plus optional `--palette` / `--avoid`. Partial input remains in the returned
  `direction` and must be carried into the next run or persisted in config.
- A complete but unapproved direction returns `needs-direction-approval` with
  `requestType: "direction-review"`. Present it and wait; direction approval is
  not artwork approval.
- Approve by rerunning the full direction with `--approve-direction`, or rerun
  from config whose `design` preserves `name`, `concept`, `expresses`,
  `metaphor`, `mood`, `tradeoff`, optional `palette` / `avoid`, and
  `approved: true`.
- Invoke an image model only for `ready-for-image-generation` /
  `generate-image`, `requestType: "image-generation"`, and
  `imageGenerationAllowed: true`. Pass `imagePrompt`; it is `null` in every
  other state.
- Show the generated candidate and wait for explicit artwork approval before
  placing it in the target checkout, compiling with `--preview`, or patching.
- Never hand-author SVG primitives, canvas code, or CSS art as a fallback for
  unavailable image generation. Return the gated source request and wait for an
  approved asset instead.
- Use a provider's local output path when one exists. If it returns only a
  conversation image, wait for the approved image to be attached/exported;
  never recreate it with SVG primitives or a screenshot.
- `--placeholder` is only for an explicitly requested deterministic temporary
  mark. It is not a substitute for image generation or approved artwork.

Approved direction round-trip example:

```bash
node bin/icon-maker.js --brief --target apple,pwa \
  --direction-name "Focused signal" \
  --concept "clarity emerging from noisy inputs" \
  --expresses "calm confidence" \
  --visual-metaphor "one bright signal aligned through a field" \
  --mood precise,quiet \
  --tradeoff "abstract rather than literal" \
  --palette "#0f172a,#14b8a6" \
  --avoid "letters,platform logos" \
  --approve-direction --json
```

## Structure

```
src/
  generate.js  -> makeIcons(config, opts): target resolution, SVG/PNG/ICO/ICNS writes, optional patches/preview
  targets.js   -> target definitions and repo autodetection
  apple.js     -> Xcode project/catalog discovery and safe Apple output routing
  brand.js     -> bounded local brand-asset, guidance, and palette evidence discovery
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
  requires network access; the `--brief` evidence scan also remains local.
  Agent workflows may invoke an image model only after the explicit direction
  gate, and must keep direction approval, artwork approval, and source handoff
  distinct.
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

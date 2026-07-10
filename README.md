<div align="center">

# Icon Maker

**Compile one design into launch-ready icon assets and project wiring.**

Xcode Asset Catalog · app icons · extension manifests · package icons · PWA icons. One compiler.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node >= 22](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](.nvmrc)

**English** | [한국어](README.ko.md)

</div>

---

> **Part of [Starter Series](https://github.com/starter-series)** — reusable launch tooling, not just clone-templates. `icon-maker` is the identity asset companion to `shotkit`: make the icon set first, then capture/store/social assets from the built product.

---

## Status & Scope

- **Pre-release** — the package is implemented, packable, and available as a
  public source repo, but `iconkit` has not been published
  to npm yet. The commands below distinguish local development from post-npm
  release install paths.
- **Currently implemented** — a provider-neutral delivery icon compiler with a
  vanilla-chat design brief, direct SVG/PNG source handoff, Xcode-ready Apple
  AppIcon catalogs, and outputs for `apple`, `browser-extension`, `expo`,
  `electron`, `vscode`, `pwa`, `mcp-connector`, and `generic`; `.ico` / `.icns`
  containers; preview contact sheets; target autodetection; JSON output; and
  optional manifest/package patching.
- **Design intent** — one config, many platform outputs. Icon decisions are project intent, so the source of truth lives in `icon-maker.config.js` or the data-only `icon-maker.config.json`; platform file names and manifest wiring are mechanical.
- **Non-goals** — owning AI logo generation, brand strategy, or illustration.
  Bring a design from a person, vanilla ChatGPT/Claude, an agent, or a design
  tool; the SVG/PNG file is the stable handoff contract.
- **Redacted** — none. The package does not use network calls, credentials, or third-party image services.

## Local Use

```bash
npm install
node bin/icon-maker.js --brief --target apple,browser-extension,pwa
node bin/icon-maker.js --target auto --dry-run --json
node bin/icon-maker.js --target generic --out-dir .tmp-icon-preview --preview --json
rm -rf .tmp-icon-preview
```

The brief command prints a design request without writing files. The dry run
verifies target detection, and the final command uses a disposable output
directory to prove generation, preview rendering, and the JSON contract without
polluting the repo root.

## After npm Release

Install in a consuming repo:

```bash
npm i -D iconkit
```

Zero-install:

```bash
npx iconkit --target auto --json
```

Claude Code plugin path after the public plugin entry exists:

```text
/plugin marketplace add starter-series/create-starter
/plugin install icon-maker@starter-series
```

## Usage

### Vanilla chat handoff

Generate a complete, provider-neutral request for a master icon:

```bash
node bin/icon-maker.js --brief --target apple,browser-extension,pwa
```

Send that output to any vanilla chat or designer. Place the returned SVG or PNG
inside the target project, then compile it without creating a config file:

```bash
node bin/icon-maker.js --source ./brand/icon.svg \
  --target apple,browser-extension,pwa \
  --preview --json
```

Inspect `icon-preview.html`, then explicitly wire manifests/packages:

```bash
node bin/icon-maker.js --source ./brand/icon.svg \
  --target apple,browser-extension,pwa \
  --patch --json
```

After npm publication, replace `node bin/icon-maker.js` with `npx iconkit`.

`--source` is resolved relative to the target project and must stay inside it.
SVG is preferred; a square PNG of at least 1024 x 1024 is accepted. Smaller or
non-square PNG input produces structured warnings. `--out-dir` is also resolved
inside the target project; output may not be redirected outside that boundary.

Expo needs a separate transparent adaptive foreground when the default source
has an opaque background:

```bash
node bin/icon-maker.js --source ./brand/icon.svg \
  --adaptive-source ./brand/icon-adaptive.svg \
  --target expo --preview --json
```

### Persistent project config

Create a config:

```bash
node bin/icon-maker.js --init
```

Generate icons:

```bash
node bin/icon-maker.js                         # auto-detect repo type and write files
node bin/icon-maker.js --target browser-extension --patch
node bin/icon-maker.js --target expo --json
node bin/icon-maker.js ../my-app --target pwa --out-dir out --json
node bin/icon-maker.js --target auto --preview
node bin/icon-maker.js --dry-run --json
```

`--json` prints one machine-readable object to stdout. If an explicit or
trusted local `.js` config writes to stdout while loading, icon-maker routes
that config noise to stderr so stdout remains parseable:

```json
{
  "ok": true,
  "targets": ["browser-extension"],
  "produced": [
    { "target": "browser-extension", "path": "/abs/app/assets/icons/icon128.png", "format": "png", "size": 128 }
  ],
  "patches": []
}
```

## Config Contract

`icon-maker.config.js`:

```js
module.exports = {
  project: {
    name: 'My App',
    slug: 'my-app',
    description: 'What the product does and for whom',
  },
  mark: {
    glyph: 'braces',       // braces | spark | bolt
    shape: 'squircle',     // squircle | circle | square
    background: '#111827',
    foreground: '#f8fafc',
    accent: '#38bdf8',
    radius: 0.24,
    // Use finished sources instead of the generated mark:
    // source: {
    //   default: './brand/icon.svg',
    //   adaptiveForeground: './brand/icon-adaptive.svg',
    // },
  },
  // Required only when Xcode routing is ambiguous or a new set is desired:
  // apple: {
  //   assetCatalog: './MyApp/Assets.xcassets',
  //   appIconSet: 'AppIcon',
  // },
  targets: ['auto'],
};
```

For untrusted target checkouts, prefer `icon-maker.config.json`. Auto-discovery
loads the JSON form first and refuses to auto-execute a target repo's
`icon-maker.config.js` unless the path is passed explicitly with `--config`.

## Targets

| Target | Outputs |
|---|---|
| `apple` | detected Xcode App Icon set: RGB iOS 1024 source, complete macOS size matrix, `Contents.json` |
| `browser-extension` | `assets/icons/icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`, `icon.svg` |
| `expo` | `assets/icon.png`, transparent-foreground `assets/adaptive-icon.png`, `assets/icon.svg` |
| `electron` | `assets/icon.png`, `assets/icon.ico`, `assets/icon.icns`, `assets/icon.svg` |
| `vscode` | `assets/icon.png` (256), `assets/icon.svg` |
| `pwa` | `public/icon-192.png`, `public/icon-512.png`, `public/favicon.ico`, `public/favicon.svg` |
| `mcp-connector` | `assets/icon.png` (1024), `assets/icon-512.png`, `assets/icon.svg` |
| `generic` | `assets/icon.png`, `assets/icon.svg` |

## External SVG or PNG Source

For a one-off vanilla-chat handoff, use `--source`. When the design path should
remain project intent, point `mark.source` at it:

```js
module.exports = {
  mark: {
    source: {
      default: './brand/icon.svg',
      adaptiveForeground: './brand/icon-adaptive.svg',
    },
  },
  targets: ['expo', 'pwa'],
};
```

SVG outputs preserve an SVG source. A PNG source is embedded in generated SVG
wrappers. PNG/ICO/ICNS and Apple outputs are rasterized through
`@resvg/resvg-js` into square canvases using contain scaling. Keep the source
inside the target directory. Keep SVG input self-contained: use inline
fills/strokes and avoid remote fonts or external images for portable output.

An exact Markdown-fenced SVG code block is unwrapped automatically. Prose
around the fence is rejected. A source path may not collide with any generated
or preview output path, and output paths or symlinks may not escape the target
directory. When selected targets need different files at the same path, use
`--out-dir` to isolate them.

> **Security:** the SVG output (e.g. `favicon.svg`) preserves `mark.source`
> after optional exact Markdown-fence removal; icon-maker does not sanitize it.
> An SVG can carry `<script>` or
> event-handler attributes that execute when the file is opened or served
> directly in a browser. Only point `mark.source` at SVGs you author or trust;
> never feed it an untrusted third-party SVG whose output you then serve.

## Apple and Xcode

The `apple` target emits one App Icon set that Xcode can compile for iOS and
macOS. It reads `ASSETCATALOG_COMPILER_APPICON_NAME` from `project.pbxproj` when
that value is unambiguous. Preview-only catalogs are ignored. With exactly one
production asset catalog, icon-maker writes into it; with none, it creates
`Assets.xcassets` and warns that the catalog may need to be added to Xcode. With
multiple catalogs or App Icon names, it stops instead of guessing:

```js
module.exports = {
  apple: {
    assetCatalog: './MyApp/Assets.xcassets',
    appIconSet: 'AppIcon',
  },
  targets: ['apple'],
};
```

An explicitly configured catalog must already exist. Existing App Icon sets
that reference files not owned by icon-maker are never overwritten; choose a
new `apple.appIconSet` instead. Empty Xcode appearance slots and set metadata
are preserved. Imported Apple artwork is flattened onto `mark.background`, and
Apple PNGs are encoded as RGB without an alpha channel. The current target uses
the broadly compatible Asset Catalog path; layered Icon Composer authoring
remains an upstream design step.

## Preview

`--preview` writes `icon-preview.html`, a local contact sheet for checking tiny
sizes, transparent backgrounds, and platform containers:

```bash
node bin/icon-maker.js --target auto --preview
```

`--patch` updates known fields when the matching manifest exists:

- `manifest.json` extension `icons`
- Expo `app.json` `expo.icon` and Android adaptive foreground
- Electron / VS Code `package.json` `icon`
- `public/manifest.json` PWA `icons`

When `--patch` is requested and a matching manifest is absent, the JSON result
contains a `patch-target-missing` warning. Generate and review first; patch in a
second command when the assets are accepted.

## Agent Surfaces

- Current source checkout: `node /path/to/icon-maker/bin/icon-maker.js <path> --target auto --json`
- Vanilla handoff: `node /path/to/icon-maker/bin/icon-maker.js <path> --brief --target apple,pwa`
- Published CLI after npm release: `npx iconkit <path> --target auto --json`
- Skill: [`skills/create-icons/SKILL.md`](skills/create-icons/SKILL.md)
- Source plugin metadata: [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json)

There is no MCP server in v1. Icon generation is file-producing local work, so the reliable surface is a CLI with a JSON contract plus a skill that tells agents when and how to run it.

## Dev

```bash
npm install
npm run lint
npm test
npm run pack:install-smoke
npm run xcode:smoke # macOS/Xcode only
```

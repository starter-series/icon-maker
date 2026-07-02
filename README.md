<div align="center">

# Icon Maker

**Generate launch-ready icon sets from one deterministic config.**

App icons · extension icons · connector logos · PWA icons · SVG source. One command.

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
- **Currently implemented** — an icon compiler that renders a deterministic SVG source plus PNG outputs for `browser-extension`, `expo`, `electron`, `vscode`, `pwa`, `mcp-connector`, and `generic`; optional custom SVG source rasterization; `.ico` / `.icns` containers for app/web surfaces; preview contact sheets; a CLI (`icon-maker`) with `--json`, optional `path`, target autodetection, `--dry-run`, `--out-dir`, `--preview`, and optional manifest patching; a programmatic API (`makeIcons()`); a Claude Code skill (`skills/create-icons/`); and source-repo plugin metadata (`icon-maker@starter-series`).
- **Design intent** — one config, many platform outputs. Icon decisions are project intent, so the source of truth lives in `icon-maker.config.js`; platform file names and manifest wiring are mechanical.
- **Non-goals** — AI logo generation, brand strategy, and pixel-perfect illustration. v1 is a deterministic starter-layer compiler. Use a design tool later if the brand needs custom illustration polish.
- **Redacted** — none. The package does not use network calls, credentials, or third-party image services.

## Local Use

```bash
npm install
node bin/icon-maker.js --target auto --dry-run --json
node bin/icon-maker.js --target generic --out-dir .tmp-icon-preview --preview --json
rm -rf .tmp-icon-preview
```

The first command verifies target detection without writing files. The second
uses a disposable output directory so a fresh checkout can prove generation,
preview rendering, and the JSON contract without polluting the repo root.

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

Create a config:

```bash
icon-maker --init
```

Generate icons:

```bash
icon-maker                         # auto-detect repo type and write files
icon-maker --target browser-extension --patch
icon-maker --target expo --json
icon-maker ../my-app --target pwa --out-dir out --json
icon-maker --target auto --preview
icon-maker --dry-run --json
```

`--json` prints one machine-readable object to stdout:

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
  },
  mark: {
    glyph: 'braces',       // braces | spark | bolt
    shape: 'squircle',     // squircle | circle | square
    background: '#111827',
    foreground: '#f8fafc',
    accent: '#38bdf8',
    radius: 0.24,
    // Use a finished SVG source instead of the generated mark:
    // source: './assets/source-icon.svg',
  },
  targets: ['auto'],
};
```

## Targets

| Target | Outputs |
|---|---|
| `browser-extension` | `assets/icons/icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`, `icon.svg` |
| `expo` | `assets/icon.png`, transparent-foreground `assets/adaptive-icon.png`, `assets/icon.svg` |
| `electron` | `assets/icon.png`, `assets/icon.ico`, `assets/icon.icns`, `assets/icon.svg` |
| `vscode` | `assets/icon.png` (256), `assets/icon.svg` |
| `pwa` | `public/icon-192.png`, `public/icon-512.png`, `public/favicon.ico`, `public/favicon.svg` |
| `mcp-connector` | `assets/icon.png` (1024), `assets/icon-512.png`, `assets/icon.svg` |
| `generic` | `assets/icon.png`, `assets/icon.svg` |

## Custom SVG Source

When you already have a brand mark, point `mark.source` at it:

```js
module.exports = {
  mark: {
    source: './assets/source-icon.svg',
  },
  targets: ['expo', 'pwa'],
};
```

SVG outputs copy that source, while PNG/ICO/ICNS outputs are rasterized through
`@resvg/resvg-js`. Keep the source SVG self-contained: inline fills/strokes and
avoid remote fonts or external images.

> **Security:** the SVG output (e.g. `favicon.svg`) is copied from `mark.source`
> **verbatim** — icon-maker does not sanitize it. An SVG can carry `<script>` or
> event-handler attributes that execute when the file is opened or served
> directly in a browser. Only point `mark.source` at SVGs you author or trust;
> never feed it an untrusted third-party SVG whose output you then serve.

## Preview

`--preview` writes `icon-preview.html`, a local contact sheet for checking tiny
sizes, transparent backgrounds, and platform containers:

```bash
icon-maker --target auto --preview
```

`--patch` updates known fields when the matching manifest exists:

- `manifest.json` extension `icons`
- Expo `app.json` `expo.icon` and Android adaptive foreground
- Electron / VS Code `package.json` `icon`
- `public/manifest.json` PWA `icons`

## Agent Surfaces

- Current source checkout: `node /path/to/icon-maker/bin/icon-maker.js <path> --target auto --json`
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
```

---
name: create-icons
description: Generate app, browser-extension, PWA, VS Code, Electron, or MCP connector icon assets with icon-maker. Use when asked to create or refresh icon files, starter placeholder icons, connector logos, extension manifest icons, Expo app icons, or launch asset icon sets for a repo.
allowed-tools: Bash(npx @starter-series/icon-maker*), Bash(node *icon-maker*/bin/icon-maker.js*), Bash(npm run icon:*), Read, Edit
---

# Create icon assets with icon-maker

`icon-maker` generates deterministic SVG + PNG icon sets from one local config.
It is meant for starter-layer identity assets: enough to replace placeholders,
wire manifests, and make launch surfaces coherent before custom design polish.

## Steps

1. **Inspect the repo type** — look for:
   - `manifest.json` with `manifest_version` -> `browser-extension`
   - `app.json` with `expo` or `app.config.js` -> `expo`
   - `package.json` with `engines.vscode` -> `vscode`
   - Electron deps -> `electron`
   - `public/manifest.json` -> `pwa`
   - `server.json` -> `mcp-connector`
2. **Create or update config** — if there is no `icon-maker.config.js`, run:

   ```bash
   npx @starter-series/icon-maker --init
   ```

   Then edit `mark.background`, `mark.foreground`, `mark.accent`, and
   `mark.glyph` (`braces`, `spark`, or `bolt`) to match the product.
3. **Generate**:

   ```bash
   npx @starter-series/icon-maker --target auto --json
   npx @starter-series/icon-maker --target browser-extension --patch --json
   npx @starter-series/icon-maker <path> --target expo --json
   npx @starter-series/icon-maker --target auto --preview --json
   ```

   Use `--patch` only when the user wants manifest/app/package icon references
   updated. Use `--preview` when the user needs to inspect tiny sizes or
   transparent backgrounds. Use `--dry-run --json` to preview output paths
   without writing.

   If the npm package is not published or you are validating the source checkout,
   use the source CLI path instead of `npx`:

   ```bash
   node /path/to/icon-maker/bin/icon-maker.js <repo> --init
   node /path/to/icon-maker/bin/icon-maker.js <repo> --target auto --json
   node /path/to/icon-maker/bin/icon-maker.js <repo> --target browser-extension --patch --json
   ```
4. **Verify** — read the JSON result, check `produced[]`, and inspect any
   `warnings[]`. If `--patch` was used, verify the relevant file:
   `manifest.json`, `app.json`, `package.json`, or `public/manifest.json`.

## Notes

- The CLI writes PNGs directly and also keeps an editable SVG source.
- For finished brand marks, set `mark.source: './path/to/source.svg'`; SVG
  outputs copy that source and PNG/ICO/ICNS outputs rasterize it through
  `@resvg/resvg-js`.
- `expo` emits a transparent-background `adaptive-icon.png` foreground.
- `electron` emits PNG, ICO, and ICNS; `pwa` emits `favicon.ico` plus PNG/SVG.
- v1 does not call image-generation, Figma, or design tools. Treat external
  polish as a follow-up after deterministic assets exist.
- Do not position this as an MCP server. File generation belongs to the CLI;
  the skill is the agent UX.

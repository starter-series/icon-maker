---
name: create-icons
description: Compile Apple/Xcode, app, browser-extension, PWA, VS Code, Electron, or MCP connector icon assets with icon-maker. Use when asked to create a provider-neutral design brief, import a finished SVG/PNG, refresh icon files, wire manifests, or prepare launch icon sets for a repo.
allowed-tools: Bash(npx iconkit*), Bash(node *icon-maker*/bin/icon-maker.js*), Bash(npm run icon:*), Read, Edit
---

# Create icon assets with icon-maker

`icon-maker` compiles one local design source into deterministic platform icon
sets. Design may come from a person, vanilla chat, an agent, or a design tool;
the compiler itself stays local and provider-neutral.

## Steps

1. **Inspect the repo type** — look for:
   - `.xcodeproj`, `.xcworkspace`, or `.xcassets` -> `apple`
   - `manifest.json` with `manifest_version` -> `browser-extension`
   - `app.json` with `expo` or `app.config.js` -> `expo`
   - `package.json` with `engines.vscode` -> `vscode`
   - Electron deps -> `electron`
   - `public/manifest.json` -> `pwa`
   - `server.json` -> `mcp-connector`
2. **Choose the source path** — when no finished icon exists, generate a design
   brief that can be sent to any person or vanilla chat:

   ```bash
   node /path/to/icon-maker/bin/icon-maker.js --brief --target apple,pwa
   ```

   After npm release:

   ```bash
   npx iconkit --brief --target apple,pwa
   ```

   Once an SVG or PNG exists inside the target repo, pass it directly with
   `--source`. For Expo, request a second transparent foreground and pass it
   with `--adaptive-source`. No config file is required for this handoff path.
3. **Create or update config when the intent should persist** — if there is no `icon-maker.config.js`, run
   the source checkout while this package is pre-release:

   ```bash
   node /path/to/icon-maker/bin/icon-maker.js --init
   ```

   After `iconkit` is published to npm, the equivalent public command is:

   ```bash
   npx iconkit --init
   ```

   Then edit `mark.background`, `mark.foreground`, `mark.accent`, and
   `mark.glyph` (`braces`, `spark`, or `bolt`) to match the product.
4. **Generate** from the source checkout while this package is pre-release:

   ```bash
   node /path/to/icon-maker/bin/icon-maker.js --target auto --json
   node /path/to/icon-maker/bin/icon-maker.js --source ./brand/icon.svg --target apple,pwa --preview --json
   node /path/to/icon-maker/bin/icon-maker.js --source ./brand/icon.svg --adaptive-source ./brand/icon-adaptive.svg --target expo --preview --json
   node /path/to/icon-maker/bin/icon-maker.js --target browser-extension --patch --json
   node /path/to/icon-maker/bin/icon-maker.js <path> --target expo --json
   node /path/to/icon-maker/bin/icon-maker.js --target auto --preview --json
   ```

   After npm release:

   ```bash
   npx iconkit --target auto --json
   npx iconkit --source ./brand/icon.svg --target apple,pwa --preview --json
   npx iconkit --source ./brand/icon.svg --adaptive-source ./brand/icon-adaptive.svg --target expo --preview --json
   npx iconkit --target browser-extension --patch --json
   npx iconkit <path> --target expo --json
   npx iconkit --target auto --preview --json
   ```

   Generate with `--preview` first. After the user accepts the contact sheet,
   run a second command with `--patch` to update manifest/app/package icon
   references. Use `--dry-run --json` to preview output paths without writing.

   If you are validating a different source checkout, pass that checkout path
   explicitly:

   ```bash
   node /path/to/icon-maker/bin/icon-maker.js <repo> --init
   node /path/to/icon-maker/bin/icon-maker.js <repo> --target auto --json
   node /path/to/icon-maker/bin/icon-maker.js <repo> --target browser-extension --patch --json
   ```
5. **Verify** — read the JSON result, check `produced[]`, and inspect any
   `warnings[]`. If `--patch` was used, verify the relevant file:
   `manifest.json`, `app.json`, `package.json`, or `public/manifest.json`.

## Notes

- The CLI writes platform PNGs and preserves SVG input or creates an SVG
  wrapper for PNG input where a target needs SVG.
- For finished brand marks, use `--source` for a one-off SVG/PNG handoff or set
  `mark.source` when the path should persist in config.
- `apple` detects the selected App Icon name from Xcode. Configure
  `apple.assetCatalog` or `apple.appIconSet` when routing is ambiguous. It
  refuses to replace an existing set that references unmanaged files.
- `expo` emits a transparent `adaptive-icon.png`; external designs should use
  a distinct `--adaptive-source` or `mark.source.adaptiveForeground`.
- `electron` emits PNG, ICO, and ICNS; `pwa` emits `favicon.ico` plus PNG/SVG.
- The compiler does not call image-generation, Figma, or design tools. Those
  are optional upstream providers; the SVG/PNG file is the handoff contract.
- Do not position this as an MCP server. File generation belongs to the CLI;
  the skill is the agent UX.

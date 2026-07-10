---
name: create-icons
description: Acquire an icon candidate through an available image-generation provider when explicitly requested, obtain approval, then compile the approved SVG/PNG into Apple/Xcode, app, browser-extension, PWA, VS Code, Electron, or MCP connector assets with icon-maker.
---

# Create icon assets with icon-maker

`icon-maker` compiles one approved local design source into deterministic
platform icon sets. Image generation is an optional upstream provider step,
not a capability of the offline compiler.

## Hard boundary

- Never hand-author an SVG, canvas drawing, CSS illustration, or geometric
  diagram as a substitute for visual image generation.
- Never treat image-generation output as approved project intent. Present it
  and wait for explicit user approval before compiling or patching files.
- If no image-generation tool is available, return the structured source
  request and ask for an approved project-local SVG/PNG. Do not improvise.
- If the provider returns only a conversation image, wait for the approved
  image to be attached or exported. Never reconstruct it with SVG or a
  screenshot. Use a provider's local output path when one is available.
- Use `--placeholder` only when the user explicitly requests temporary,
  deterministic artwork.

## Steps

1. **Inspect the repo type** — look for:
   - `.xcodeproj`, `.xcworkspace`, or `.xcassets` -> `apple`
   - `manifest.json` with `manifest_version` -> `browser-extension`
   - `app.json` with `expo` or `app.config.js` -> `expo`
   - `package.json` with `engines.vscode` -> `vscode`
   - Electron deps -> `electron`
   - `public/manifest.json` -> `pwa`
   - `server.json` -> `mcp-connector`
2. **Resolve the source** — when an approved project-local SVG/PNG already
   exists, use it and skip image generation. When no source exists and the user
   explicitly asks to create or acquire one, generate the structured upstream
   request:

   ```bash
   node /path/to/icon-maker/bin/icon-maker.js --brief --target apple,pwa --json
   ```

   After npm release:

   ```bash
   npx iconkit --brief --target apple,pwa --json
   ```

   Read the JSON form when operating as an agent. It declares
   `workflow.nextAction: "generate-image"`, the source contract, and the
   approval gate. Invoke an available image-generation tool with `prompt`, then
   show its result and stop. After explicit approval, place the provider output
   inside the target repo and pass it with `--source`. For Expo, acquire a
   second transparent foreground and pass it with `--adaptive-source`.
3. **Create or update config when the intent should persist** — if there is no `icon-maker.config.js`, run
   the source checkout while this package is pre-release:

   ```bash
   node /path/to/icon-maker/bin/icon-maker.js --init
   ```

   After `iconkit` is published to npm, the equivalent public command is:

   ```bash
   npx iconkit --init
   ```

   Set `mark.source` to the approved asset. `mark.background` controls Apple
   flattening for transparent input. Use generated mark fields only together
   with explicit `placeholder: true` intent.
4. **Generate** from the source checkout while this package is pre-release:

   ```bash
   node /path/to/icon-maker/bin/icon-maker.js --placeholder --target auto --json
   node /path/to/icon-maker/bin/icon-maker.js --source ./brand/icon.png --target apple,pwa --preview --json
   node /path/to/icon-maker/bin/icon-maker.js --source ./brand/icon.png --adaptive-source ./brand/icon-adaptive.png --target expo --preview --json
   node /path/to/icon-maker/bin/icon-maker.js --source ./brand/icon.png --target browser-extension --patch --json
   node /path/to/icon-maker/bin/icon-maker.js <path> --source ./brand/icon.png --target expo --json
   node /path/to/icon-maker/bin/icon-maker.js --source ./brand/icon.png --target auto --preview --json
   ```

   After npm release:

   ```bash
   npx iconkit --placeholder --target auto --json
   npx iconkit --source ./brand/icon.png --target apple,pwa --preview --json
   npx iconkit --source ./brand/icon.png --adaptive-source ./brand/icon-adaptive.png --target expo --preview --json
   npx iconkit --source ./brand/icon.png --target browser-extension --patch --json
   npx iconkit <path> --source ./brand/icon.png --target expo --json
   npx iconkit --source ./brand/icon.png --target auto --preview --json
   ```

   Compile approved artwork with `--preview` first. After the user accepts the
   compiled contact sheet, run a second command with `--patch` to update
   manifest/app/package icon references. Use `--dry-run --json` to preview
   output paths without writing.

   If you are validating a different source checkout, pass that checkout path
   explicitly:

   ```bash
   node /path/to/icon-maker/bin/icon-maker.js <repo> --init
   node /path/to/icon-maker/bin/icon-maker.js <repo> --source ./brand/icon.png --target auto --json
   node /path/to/icon-maker/bin/icon-maker.js <repo> --source ./brand/icon.png --target browser-extension --patch --json
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
- The compiler does not call image-generation, Figma, or design tools. The
  agent may call an available image-generation provider before compilation,
  but the approved project-local SVG/PNG remains the handoff contract.
- Do not position this as an MCP server. File generation belongs to the CLI;
  the skill is the agent UX.

---
name: create-icons
description: Resolve icon target constraints and brand evidence, obtain separate direction and artwork approvals, then compile an approved SVG/PNG into Apple/Xcode, app, browser-extension, PWA, VS Code, Electron, or MCP connector assets with icon-maker.
---

# Create icon assets with icon-maker

`icon-maker` compiles one approved local design source into deterministic
platform icon sets. Image generation is an optional upstream provider step,
not a capability of the offline compiler.

## Hard boundary

- Never pass a prompt from `needs-direction` or `needs-direction-approval` to an
  image model. `imageGenerationAllowed` must be `true`, and only the non-null
  `imagePrompt` field may be used.
- Treat discovered brand assets, guidance, and colors as evidence to review,
  not as approved project intent.
- If the user is unsure about direction, offer exactly three text-only
  hypotheses. Each must include a name, what it expresses, visual metaphor,
  mood, and tradeoff. Ground their meaning in product context and confirmed
  brand evidence; technical constraints affect feasibility only. Wait for the
  user to select, combine, revise, or reject.
- Direction approval permits image generation; it does not approve the
  generated artwork. Show the candidate and wait for separate artwork approval
  before compiling or patching.
- Never hand-author an SVG, canvas drawing, CSS illustration, or geometric
  diagram as a substitute for visual image generation.
- If no image-generation tool is available after direction approval, return the
  structured source request and ask for an approved project-local SVG/PNG.
- If a provider returns only a conversation image, wait for the approved image
  to be attached or exported. Use its local output path when one exists; never
  reconstruct it with SVG or a screenshot.
- Use `--placeholder` only when the user explicitly requests temporary,
  deterministic artwork.

## Steps

1. **Run the source request first** when no approved source is already known:

   ```bash
   node /path/to/icon-maker/bin/icon-maker.js <repo> --brief --target auto --json
   ```

   After npm release:

   ```bash
   npx iconkit <repo> --brief --target auto --json
   ```

   Read the JSON form. `--brief` resolves `technicalConstraints`, performs a
   bounded local `brandContext` scan, and checks for a configured approved
   source. Every response uses `schemaVersion: 2`; `requestType` is one of
   `direction-discovery`, `direction-review`, `image-generation`, or `compile`.
   A known approved project-local SVG/PNG returns `compile` and always skips
   image generation.

2. **Follow `workflow.state` exactly**:

   - `ready-to-compile` / `compile`: use the reported source and continue to
     preview.
   - `needs-direction` / `direction-discovery`: concept or mood is missing and
     `imageGenerationAllowed` is `false`. Review any brand evidence and ask for
     the missing intent. If the user is unsure, present exactly the three
     text-only hypotheses defined above and wait.
   - `needs-direction-approval` / `direction-review`: concept and mood are
     complete, but unapproved. Present the direction, explain its expression
     and tradeoff, and wait.
   - `ready-for-image-generation` / `image-generation`: proceed only when
     `nextAction` is `generate-image` and `imageGenerationAllowed` is `true`.

   Round-trip a selected hypothesis without shortening it. Use
   `--direction-name`, `--concept`, `--expresses`, `--visual-metaphor`, `--mood`,
   and `--tradeoff`; add `--palette` and `--avoid` when present. Partial input is
   preserved in the returned `direction`, so carry every returned field into
   the next invocation or persist it in config. First run the complete payload
   without approval to obtain `direction-review`. After explicit approval,
   rerun the identical payload with `--approve-direction`:

   ```bash
   node /path/to/icon-maker/bin/icon-maker.js <repo> --brief \
     --target apple,pwa \
     --direction-name "Focused signal" \
     --concept "clarity emerging from noisy inputs" \
     --expresses "calm confidence" \
     --visual-metaphor "one bright signal aligned through a field" \
     --mood "precise,quiet" \
     --tradeoff "abstract rather than literal" \
     --palette "#0f172a,#14b8a6" \
     --avoid "letters,platform logos" \
     --approve-direction --json
   ```

   The config equivalent is a complete, user-approved direction followed by a
   new `--brief` run:

   ```js
   design: {
     name: 'Focused signal',
     concept: 'clarity emerging from noisy inputs',
     expresses: 'calm confidence',
     metaphor: 'one bright signal aligned through a field',
     mood: ['precise', 'quiet'],
     tradeoff: 'abstract rather than literal',
     palette: ['#0f172a', '#14b8a6'],
     avoid: ['letters', 'platform logos'],
     approved: true,
   }
   ```

   Only these explicit CLI or config approval paths may produce
   `ready-for-image-generation` / `generate-image`.

3. **Generate and review a candidate** only from the approved image-generation
   brief. Pass its `imagePrompt` and `sourceContract` to an available image provider,
   show the result, and stop for artwork approval. For Expo, acquire the separate
   transparent adaptive foreground required by `sourceContract.variants`.

4. **Materialize approved artwork** inside the target checkout. Prefer the
   provider's local output path. Use `--source` for a one-off handoff, or run
   `--init` and set `mark.source` when the path should persist. Set
   `mark.source.adaptiveForeground` for Expo when needed. `mark.background`
   controls Apple flattening for transparent input.

5. **Compile a preview, then patch separately**:

   ```bash
   node /path/to/icon-maker/bin/icon-maker.js <repo> --source ./brand/icon.png --target auto --preview --json
   node /path/to/icon-maker/bin/icon-maker.js <repo> --source ./brand/icon.png --adaptive-source ./brand/icon-adaptive.png --target expo --preview --json
   node /path/to/icon-maker/bin/icon-maker.js <repo> --source ./brand/icon.png --target browser-extension --patch --json
   ```

   After npm release, replace the executable with `npx iconkit`. Use
   `--dry-run --json` to inspect output paths without writing. Review
   `icon-preview.html` before running the separate `--patch` command.

6. **Verify** the JSON result, including `produced[]` and `warnings[]`. If
   `--patch` was used, inspect the relevant `manifest.json`, `app.json`,
   `package.json`, or `public/manifest.json`.

## Notes

- The CLI writes platform PNGs and preserves SVG input or creates an SVG
  wrapper for PNG input where a target needs SVG.
- `apple` detects the selected App Icon name from Xcode. Configure
  `apple.assetCatalog` or `apple.appIconSet` when routing is ambiguous; existing
  sets that reference unmanaged files are not replaced.
- `expo` requires a distinct transparent adaptive foreground when the default
  artwork has an opaque background.
- `electron` emits PNG, ICO, and ICNS; `pwa` emits favicon ICO plus PNG/SVG.
- The compiler never calls image-generation, Figma, or design tools. The
  approved project-local SVG/PNG remains the compiler handoff contract.
- Do not position this as an MCP server. File generation belongs to the CLI;
  the skill is the agent UX.

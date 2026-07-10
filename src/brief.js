const path = require('path');
const { defaultConfig, loadConfig, mergeConfig } = require('./config');
const { TARGETS, resolveTargets } = require('./targets');

const TARGET_GUIDANCE = {
  apple: 'use full square artwork with no baked-in platform mask or rounded-corner clipping; keep key details away from the outer edge.',
  'browser-extension': 'the mark must remain recognizable at 16, 32, 48, and 128 pixels.',
  expo: 'provide a centered mark that also works as an Android adaptive-icon foreground.',
  electron: 'support desktop use from 16 pixels through a 1024-pixel master.',
  vscode: 'keep the silhouette readable at 256 pixels and avoid fine text.',
  pwa: 'support 192- and 512-pixel app icons plus favicon-scale rendering.',
  'mcp-connector': 'use a clear product symbol that remains legible in marketplace listings.',
  generic: 'create a reusable square master suitable for later platform compilation.',
};

function resolveBriefConfig(inputConfig, cwd, explicitConfig, targets) {
  if (inputConfig) {
    const presetTargets = targets?.length ? targets : inputConfig.targets || ['auto'];
    return mergeConfig(defaultConfig(cwd, presetTargets), inputConfig);
  }
  return loadConfig(cwd, explicitConfig, targets).config;
}

function renderDesignBrief(config, targets) {
  const projectName = config.project?.name || 'Untitled app';
  const slug = config.project?.slug || 'app-icon';
  const description = config.project?.description || config.project?.purpose;
  const targetLines = targets.map((target) => `- ${TARGETS[target].label}: ${TARGET_GUIDANCE[target]}`);
  const colors = [
    config.mark?.background && `background ${config.mark.background}`,
    config.mark?.foreground && `foreground ${config.mark.foreground}`,
    config.mark?.accent && `accent ${config.mark.accent}`,
  ].filter(Boolean).join(', ');
  const variantDeliverables = targets.includes('expo')
    ? '- Also provide a separate self-contained SVG with a transparent canvas containing only the centered adaptive foreground mark.'
    : null;
  const returnInstruction = targets.includes('expo')
    ? '- Return two clearly named finished assets: `icon.svg` for the default icon and `icon-adaptive.svg` for the transparent adaptive foreground. In a text-only interface, return exactly two labelled SVG code blocks.'
    : '- Return the finished asset itself. In a text-only interface, return exactly one SVG code block; in an interface that can create files, provide the SVG or PNG file.';
  const compositionChecks = [
    '- Keep the main symbol centered with generous breathing room.',
    '- Make the core idea identifiable at 16 pixels.',
    targets.includes('apple')
      ? "- Use an opaque full-canvas background for Apple app-icon delivery; do not pre-apply Apple's rounded mask."
      : null,
    '- Avoid trademarked logos, copyrighted characters, and replicas of platform hardware.',
    returnInstruction,
  ].filter(Boolean);

  return `# Master icon design brief: ${projectName}

Create one distinctive master app icon for "${projectName}" (${slug}). The result will be compiled into production assets for multiple platforms, so prioritize a simple silhouette, strong contrast, and recognition at very small sizes.

## Product context

${description || 'No product description was provided. Do not invent domain-specific features; use a neutral, ownable symbol that can be refined after the product context is supplied.'}

## Deliverable

- Preferred: one self-contained square SVG with a 1024 x 1024 viewBox.
- Accepted fallback: one square PNG at least 1024 x 1024 pixels.
${variantDeliverables || ''}
- Use vector shapes and embedded fills/strokes. Do not use remote fonts, linked images, scripts, or event handlers.
- Do not include explanatory text, mockups, device frames, drop shadows outside the canvas, or multiple icon candidates in the final asset.
- Avoid words and fine lettering unless a letterform is essential to the product identity.
- Suggested palette from the project: ${colors || 'choose a high-contrast palette appropriate to the product'}.

## Target requirements

${targetLines.join('\n')}

## Composition checks

${compositionChecks.join('\n')}
`;
}

function makeDesignBrief(inputConfig = null, opts = {}) {
  const cwd = path.resolve(opts.cwd || process.cwd());
  const config = resolveBriefConfig(inputConfig, cwd, opts.config, opts.targets || []);
  const targets = resolveTargets(opts.targets || [], cwd, config.targets);
  return {
    ok: true,
    kind: 'design-brief',
    cwd,
    targets,
    project: {
      name: config.project?.name || path.basename(cwd),
      slug: config.project?.slug || path.basename(cwd),
      description: config.project?.description || config.project?.purpose || null,
    },
    sourceContract: {
      preferred: 'svg',
      accepted: ['svg', 'png'],
      minimumRasterSize: 1024,
      variants: targets.includes('expo') ? ['default', 'adaptiveForeground'] : ['default'],
    },
    prompt: renderDesignBrief(config, targets),
  };
}

module.exports = { makeDesignBrief, renderDesignBrief };

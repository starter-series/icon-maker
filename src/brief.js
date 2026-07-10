const path = require('path');
const { defaultConfig, loadConfig, mergeConfig } = require('./config');
const { TARGETS, resolveTargets } = require('./targets');
const { sourceAcquisitionWorkflow, sourceContract } = require('./workflow');

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
  const deliverableLines = [
    '- Preferred from image-generation providers: one square PNG at least 1024 x 1024 pixels.',
    '- Accepted alternative: a self-contained SVG only when supplied as native vector artwork.',
    targets.includes('expo')
      ? '- Also provide a separate 1024 x 1024 transparent PNG containing only the centered adaptive foreground mark. A native vector SVG is also accepted.'
      : null,
    '- Native SVG must use embedded vector shapes and fills/strokes without remote fonts, linked images, scripts, or event handlers.',
    '- Do not include explanatory text, mockups, device frames, drop shadows outside the canvas, or multiple icon candidates in the final asset.',
    '- Avoid words and fine lettering unless a letterform is essential to the product identity.',
    '- Do not infer that an unspecified palette or visual style represents approved brand intent.',
  ].filter(Boolean);
  const returnInstruction = targets.includes('expo')
    ? '- Return two clearly named finished image files: `icon.png` and `icon-adaptive.png` (or native vector equivalents).'
    : '- Return one finished image file. Prefer PNG from an image-generation model; use SVG only when it is native vector artwork.';
  const compositionChecks = [
    '- Keep the main symbol centered with generous breathing room.',
    '- Make the core idea identifiable at 16 pixels.',
    targets.includes('apple')
      ? "- Use an opaque full-canvas background for Apple app-icon delivery; do not pre-apply Apple's rounded mask."
      : null,
    '- Avoid trademarked logos, copyrighted characters, and replicas of platform hardware.',
    '- If finished image generation is unavailable, do not substitute a schematic SVG assembled from generic circles, boxes, arrows, or UI symbols.',
    returnInstruction,
  ].filter(Boolean);

  return `# Master icon design brief: ${projectName}

Create one distinctive master app icon candidate for "${projectName}" (${slug}) using an image-generation model or another visual design provider. The result will be reviewed before it is compiled into production assets, so prioritize a simple silhouette, strong contrast, and recognition at very small sizes. Produce finished visual artwork, not a technical diagram or UI-flow illustration.

## Product context

${description || 'No product description was provided. Treat any result as exploratory and do not imply that an inferred visual direction is approved.'}

## Deliverable

${deliverableLines.join('\n')}

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
    kind: 'source-request',
    cwd,
    targets,
    project: {
      name: config.project?.name || path.basename(cwd),
      slug: config.project?.slug || path.basename(cwd),
      description: config.project?.description || config.project?.purpose || null,
    },
    sourceContract: sourceContract(targets),
    workflow: sourceAcquisitionWorkflow(targets),
    prompt: renderDesignBrief(config, targets),
  };
}

module.exports = { makeDesignBrief, renderDesignBrief };

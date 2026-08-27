const fs = require('fs');
const path = require('path');
const { discoverBrandContext } = require('./brand');
const { defaultConfig, loadConfig, mergeConfig } = require('./config');
const { loadSource } = require('./source');
const { TARGETS, resolveTargets } = require('./targets');
const { resolveDirection, sourceAcquisitionWorkflow, sourceContract } = require('./workflow');

const TARGET_GUIDANCE = {
  apple: 'use full square artwork with no baked-in platform mask or rounded-corner clipping; keep key details away from the outer edge.',
  android: 'use a full-square default source plus separately approved adaptiveForeground, optional round-specific, and optional Android 13 monochrome source roles; keep adaptive foreground key details inside the central 66 x 66 safe zone of its 108 x 108 layer, and never invent role variants from technical constraints.',
  'browser-extension': 'the mark must remain recognizable at 16, 32, 48, and 128 pixels.',
  expo: 'provide a centered mark that also works as an Android adaptive-icon foreground.',
  electron: 'support desktop use from 16 pixels through a 1024-pixel master.',
  vscode: 'keep the silhouette readable at 256 pixels and avoid fine text.',
  pwa: 'support 192- and 512-pixel any-purpose icons plus favicon-scale rendering; only separately approved artwork may be labeled maskable or monochrome, and maskable key details must stay inside the central 40%-radius safe zone.',
  'mcp-connector': 'use a clear product symbol that remains legible in marketplace listings.',
  generic: 'create a reusable square master suitable for later platform compilation.',
};

function targetSourceRoles(target) {
  if (target === 'android') {
    return [
      { name: 'default', required: true, approvalRequired: true },
      {
        name: 'adaptiveForeground',
        required: true,
        approvalRequired: true,
        transparentBackground: true,
        layerSize: '108x108',
        safeZone: '66x66',
      },
      { name: 'round', required: false, approvalRequired: true, fallback: 'default' },
      { name: 'monochrome', required: false, approvalRequired: true, minimumAndroidApi: 33 },
    ];
  }
  if (target === 'pwa') {
    return [
      { name: 'default', required: true, approvalRequired: true, purpose: 'any' },
      {
        name: 'maskable',
        required: false,
        approvalRequired: true,
        purpose: 'maskable',
        safeZone: 'center circle with 40% radius',
      },
      { name: 'monochrome', required: false, approvalRequired: true, purpose: 'monochrome' },
    ];
  }
  return undefined;
}

function technicalConstraints(targets) {
  return targets.map((target) => {
    const constraint = {
      target,
      label: TARGETS[target].label,
      guidance: TARGET_GUIDANCE[target],
      outputs: TARGETS[target].files.map((file) => ({
        path: file.path,
        format: file.format,
        size: file.size,
        sizes: file.sizes,
        role: file.role || 'default',
        opaqueBackground: file.opaqueBackground === true,
        transparentBackground: file.transparentBackground === true,
      })),
    };
    const sourceRoles = targetSourceRoles(target);
    if (sourceRoles) constraint.sourceRoles = sourceRoles;
    return constraint;
  });
}

function resolveBriefConfig(inputConfig, cwd, explicitConfig, targets) {
  if (inputConfig) {
    const presetTargets = targets?.length ? targets : inputConfig.targets || ['auto'];
    return mergeConfig(defaultConfig(cwd, presetTargets), inputConfig);
  }
  return loadConfig(cwd, explicitConfig, targets).config;
}

function renderDirection(direction) {
  const lines = [
    direction.name ? `- Name: ${direction.name}` : null,
    `- Concept: ${direction.concept}`,
    direction.expresses ? `- What it expresses: ${direction.expresses}` : null,
    direction.metaphor ? `- Visual metaphor: ${direction.metaphor}` : null,
    `- Mood: ${direction.mood.join(', ')}`,
    direction.tradeoff ? `- Tradeoff: ${direction.tradeoff}` : null,
    direction.palette.length ? `- Palette: ${direction.palette.join(', ')}` : '- Palette: not specified; do not imply approval',
    direction.avoid.length ? `- Avoid: ${direction.avoid.join(', ')}` : null,
    direction.references.length ? `- References: ${direction.references.join(', ')}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

function renderKnownDirection(direction) {
  const lines = [
    direction.name ? `- Name: ${direction.name}` : null,
    direction.concept ? `- Concept: ${direction.concept}` : null,
    direction.expresses ? `- What it expresses: ${direction.expresses}` : null,
    direction.metaphor ? `- Visual metaphor: ${direction.metaphor}` : null,
    direction.mood.length ? `- Mood: ${direction.mood.join(', ')}` : null,
    direction.tradeoff ? `- Tradeoff: ${direction.tradeoff}` : null,
    direction.palette.length ? `- Palette: ${direction.palette.join(', ')}` : null,
    direction.avoid.length ? `- Avoid: ${direction.avoid.join(', ')}` : null,
  ].filter(Boolean);
  return lines.length ? lines.join('\n') : '- Nothing has been approved or proposed yet.';
}

function renderBrandEvidence(brandContext) {
  const lines = [
    ...brandContext.assets.map((item) => `- Asset (${item.kind}): ${item.relativePath}`),
    ...brandContext.documents.map((item) => `- Guidance document: ${item.relativePath}`),
    ...brandContext.colors.map((item) => `- Color ${item.value}: ${item.source}`),
  ];
  return lines.length ? lines.join('\n') : '- No existing logo, palette, or brand-guidance evidence was found.';
}

function renderDirectionRequest(config, targets, direction, brandContext, workflow) {
  const projectName = config.project?.name || 'Untitled app';
  const description = config.project?.description || config.project?.purpose;
  const targetLines = targets.map((target) => `- ${TARGETS[target].label}: ${TARGET_GUIDANCE[target]}`);
  const questions = workflow.questions.map((item) => `- ${item.prompt}`);
  return `# Icon direction required: ${projectName}

Image generation is blocked until the visual direction is explicit. Product context and technical constraints are evidence, not approved brand intent.

## Product context

${description || 'No product description was provided.'}

## Existing brand evidence

${renderBrandEvidence(brandContext)}

${brandContext.hasEvidence ? 'Review this evidence with the requester before treating it as current brand intent.' : ''}

## Technical target constraints

${targetLines.join('\n')}

## Known direction (unapproved)

${renderKnownDirection(direction)}

## Missing direction

${questions.join('\n')}

If the requester does not know yet, offer exactly three text-only exploratory directions before generating any image. For each direction include: name, what it expresses, visual metaphor, mood, and tradeoff. Ground meaning in product context and user-confirmed brand evidence; use technical constraints only to check feasibility. Clearly label the directions as hypotheses rather than approved intent. The requester may select, combine, revise, or reject all three. Wait for that decision, then rerun the source request with every field from the resulting direction for review.
`;
}

function renderDesignBrief(config, targets, direction, brandContext) {
  if (!direction?.approved) {
    throw new Error('icon-maker: image-generation briefs require an explicitly approved direction');
  }
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
    targets.includes('android')
      ? '- Also provide a separately approved transparent adaptiveForeground source designed as a 108 x 108 layer, with all key details inside the central 66 x 66 safe zone.'
      : null,
    targets.includes('android')
      ? '- Provide round artwork only when it is intentionally different from the default source, and provide Android 13 monochrome artwork only as a separately approved single-color source; never derive either role from technical constraints.'
      : null,
    targets.includes('pwa')
      ? '- Provide PWA maskable or monochrome artwork only as separately approved source roles. Keep all essential maskable details inside the centered circle whose radius is 40% of the canvas.'
      : null,
    '- Native SVG must use embedded vector shapes and fills/strokes without remote fonts, linked images, scripts, or event handlers.',
    '- Do not include explanatory text, mockups, device frames, drop shadows outside the canvas, or multiple icon candidates in the final asset.',
    '- Avoid words and fine lettering unless a letterform is essential to the product identity.',
    '- Do not infer that an unspecified palette or visual style represents approved brand intent.',
  ].filter(Boolean);
  const returnInstructions = [];
  if (targets.includes('android')) {
    returnInstructions.push('- Return clearly named `icon.png` and `icon-adaptive.png` files. Include `icon-round.png` or `icon-monochrome.png` only when that separate source role was explicitly approved.');
  } else if (targets.includes('expo')) {
    returnInstructions.push('- Return two clearly named finished image files: `icon.png` and `icon-adaptive.png` (or native vector equivalents).');
  }
  if (targets.includes('pwa')) {
    returnInstructions.push('- Return `icon-maskable.png` or `icon-monochrome.svg` only when that distinct PWA artwork role was explicitly approved; do not relabel the default icon.');
  }
  if (!returnInstructions.length) {
    returnInstructions.push('- Return one finished image file. Prefer PNG from an image-generation model; use SVG only when it is native vector artwork.');
  }
  const compositionChecks = [
    '- Keep the main symbol centered with generous breathing room.',
    '- Make the core idea identifiable at 16 pixels.',
    targets.includes('apple')
      ? "- Use an opaque full-canvas background for Apple app-icon delivery; do not pre-apply Apple's rounded mask."
      : null,
    '- Avoid trademarked logos, copyrighted characters, and replicas of platform hardware.',
    '- If finished image generation is unavailable, do not substitute a schematic SVG assembled from generic circles, boxes, arrows, or UI symbols.',
    ...returnInstructions,
  ].filter(Boolean);

  return `# Master icon design brief: ${projectName}

Create one distinctive master app icon candidate for "${projectName}" (${slug}) using an image-generation model or another visual design provider. The result will be reviewed before it is compiled into production assets, so prioritize a simple silhouette, strong contrast, and recognition at very small sizes. Produce finished visual artwork, not a technical diagram or UI-flow illustration.

## Product context

${description || 'No product description was provided. Treat any result as exploratory and do not imply that an inferred visual direction is approved.'}

## Approved direction for this candidate

${renderDirection(direction)}

## Existing brand evidence

${renderBrandEvidence(brandContext)}

## Deliverable

${deliverableLines.join('\n')}

## Target requirements

${targetLines.join('\n')}

## Composition checks

${compositionChecks.join('\n')}
`;
}

function renderDirectionReview(config, targets, direction, brandContext) {
  const projectName = config.project?.name || 'Untitled app';
  const targetLines = targets.map((target) => `- ${TARGETS[target].label}: ${TARGET_GUIDANCE[target]}`);
  return `# Icon direction approval required: ${projectName}

The following direction is complete enough to review, but it is not approved. Do not generate an image yet.

## Proposed direction

${renderDirection(direction)}

## Existing brand evidence

${renderBrandEvidence(brandContext)}

## Technical target constraints

${targetLines.join('\n')}

Explain what this direction would express and its main tradeoff. Wait for explicit user approval or revision. After approval, rerun the source request with the same direction and the direction-approval flag.
`;
}

function relativeSourcePath(cwd, sourcePath) {
  return path.relative(fs.realpathSync(cwd), sourcePath).split(path.sep).join('/');
}

function renderSourceReady(cwd, source) {
  const relativePath = relativeSourcePath(cwd, source.path);
  return `# Approved icon source found\n\nImage generation is not needed. Compile a preview from ${relativePath} and obtain approval before patching project files.\n`;
}

function sourceSummary(cwd, source) {
  if (!source) return null;
  return {
    path: relativeSourcePath(cwd, source.path),
    type: source.type,
    width: source.width,
    height: source.height,
  };
}

function makeDesignBrief(inputConfig = null, opts = {}) {
  const cwd = path.resolve(opts.cwd || process.cwd());
  const config = resolveBriefConfig(inputConfig, cwd, opts.config, opts.targets || []);
  const targets = resolveTargets(opts.targets || [], cwd, config.targets);
  const brandContext = discoverBrandContext(cwd);
  const direction = resolveDirection(config, opts.direction || {});
  const approvedSource = loadSource(cwd, config);
  const workflow = sourceAcquisitionWorkflow(targets, { approvedSource, brandContext, direction });
  const prompt = workflow.state === 'ready-to-compile'
    ? renderSourceReady(cwd, approvedSource)
    : workflow.state === 'needs-direction'
      ? renderDirectionRequest(config, targets, direction, brandContext, workflow)
      : workflow.state === 'needs-direction-approval'
        ? renderDirectionReview(config, targets, direction, brandContext)
        : renderDesignBrief(config, targets, direction, brandContext);
  const requestType = {
    'ready-to-compile': 'compile',
    'needs-direction': 'direction-discovery',
    'needs-direction-approval': 'direction-review',
    'ready-for-image-generation': 'image-generation',
  }[workflow.state];
  return {
    ok: true,
    kind: 'source-request',
    schemaVersion: 2,
    requestType,
    cwd,
    targets,
    project: {
      name: config.project?.name || path.basename(cwd),
      slug: config.project?.slug || path.basename(cwd),
      description: config.project?.description || config.project?.purpose || null,
    },
    source: sourceSummary(cwd, approvedSource),
    brandContext,
    direction,
    technicalConstraints: technicalConstraints(targets),
    sourceContract: sourceContract(targets),
    workflow,
    prompt,
    imagePrompt: requestType === 'image-generation' ? prompt : null,
  };
}

module.exports = { makeDesignBrief, renderDesignBrief, renderDirectionRequest };

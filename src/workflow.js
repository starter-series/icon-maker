function sourceContract(targets = []) {
  return {
    preferred: 'png',
    accepted: ['png', 'svg'],
    minimumRasterSize: 1024,
    variants: targets.includes('expo') ? ['default', 'adaptiveForeground'] : ['default'],
  };
}

function normalizeList(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))];
}

function resolveDirection(config = {}, overrides = {}) {
  const base = config.design || config.direction || {};
  const hasContentOverride = [
    'name',
    'concept',
    'expresses',
    'metaphor',
    'mood',
    'tradeoff',
    'palette',
    'avoid',
    'references',
  ]
    .some((key) => overrides[key] !== undefined && overrides[key] !== null);
  const approval = overrides.approved === true || (!hasContentOverride && overrides.approved !== false && base.approved === true);
  const concept = String(overrides.concept ?? base.concept ?? '').trim() || null;
  const mood = normalizeList(overrides.mood ?? base.mood);
  return {
    name: String(overrides.name ?? base.name ?? '').trim() || null,
    concept,
    expresses: String(overrides.expresses ?? base.expresses ?? '').trim() || null,
    metaphor: String(overrides.metaphor ?? base.metaphor ?? '').trim() || null,
    mood,
    tradeoff: String(overrides.tradeoff ?? base.tradeoff ?? '').trim() || null,
    palette: normalizeList(overrides.palette ?? base.palette),
    avoid: normalizeList(overrides.avoid ?? base.avoid),
    references: normalizeList(overrides.references ?? base.references),
    approved: approval === true && Boolean(concept) && mood.length > 0,
  };
}

function baseWorkflow(targets) {
  return {
    providerBoundary: 'external',
    recommendedProvider: 'image-generation-model',
    alternativeProviders: ['human-designer', 'vector-design-tool', 'existing-asset'],
    approvalRequired: true,
    artworkApprovalRequired: true,
    compileOnlyAfterApproval: true,
    noFallbackSvgSynthesis: true,
    fallbackAction: 'request-approved-source',
    sourceContract: sourceContract(targets),
  };
}

function sourceAcquisitionWorkflow(targets = [], context = {}) {
  const direction = context.direction || resolveDirection();
  const brandContext = context.brandContext || { hasEvidence: false };
  const base = baseWorkflow(targets);
  if (context.approvedSource) {
    return {
      ...base,
      state: 'ready-to-compile',
      nextAction: 'compile-preview',
      imageGenerationAllowed: false,
      direction,
    };
  }

  const missingDirection = [];
  if (!direction.concept) missingDirection.push('concept');
  if (!direction.mood.length) missingDirection.push('mood');
  if (missingDirection.length) {
    const questions = [];
    if (missingDirection.includes('concept')) {
      questions.push({ key: 'concept', prompt: 'What should the icon express about the product?' });
    }
    if (missingDirection.includes('mood')) {
      questions.push({ key: 'mood', prompt: 'What mood should the icon carry?' });
    }
    return {
      ...base,
      state: 'needs-direction',
      nextAction: brandContext.hasEvidence ? 'review-brand-evidence' : 'collect-direction',
      imageGenerationAllowed: false,
      missingDirection,
      questions,
      direction,
      uncertainUserPath: {
        action: 'offer-text-directions',
        count: 3,
        format: 'text-only',
        imageGenerationAllowed: false,
        selectionRequired: true,
        allowedResponses: ['select', 'combine', 'revise', 'reject-all'],
        eachMustInclude: ['name', 'what-it-expresses', 'visual-metaphor', 'mood', 'tradeoff'],
        basisPolicy: {
          meaning: ['product-context', 'user-confirmed-brand-evidence'],
          feasibility: ['technical-target-constraints'],
          forbiddenInference: 'technical constraints are not design intent',
        },
      },
    };
  }

  if (!direction.approved) {
    return {
      ...base,
      state: 'needs-direction-approval',
      nextAction: 'review-direction',
      imageGenerationAllowed: false,
      directionApprovalRequired: true,
      direction,
    };
  }

  return {
    ...base,
    state: 'ready-for-image-generation',
    nextAction: 'generate-image',
    imageGenerationAllowed: true,
    directionApprovalRequired: false,
    direction,
  };
}

function resolveSourceMode(source, config = {}, opts = {}) {
  if (source) return 'source';
  if (opts.placeholder === true || config.placeholder === true) return 'placeholder';
  const err = new Error(
    'icon-maker: no approved icon source found; provide --source or mark.source after approval, ' +
    'or use --placeholder for explicit temporary artwork',
  );
  err.exitCode = 2;
  throw err;
}

module.exports = { resolveDirection, resolveSourceMode, sourceAcquisitionWorkflow, sourceContract };

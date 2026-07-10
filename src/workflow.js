function sourceContract(targets = []) {
  return {
    preferred: 'png',
    accepted: ['png', 'svg'],
    minimumRasterSize: 1024,
    variants: targets.includes('expo') ? ['default', 'adaptiveForeground'] : ['default'],
  };
}

function sourceAcquisitionWorkflow(targets = []) {
  return {
    state: 'needs-source',
    nextAction: 'generate-image',
    providerBoundary: 'external',
    recommendedProvider: 'image-generation-model',
    alternativeProviders: ['human-designer', 'vector-design-tool', 'existing-asset'],
    approvalRequired: true,
    compileOnlyAfterApproval: true,
    noFallbackSvgSynthesis: true,
    fallbackAction: 'request-approved-source',
    sourceContract: sourceContract(targets),
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

module.exports = { resolveSourceMode, sourceAcquisitionWorkflow, sourceContract };

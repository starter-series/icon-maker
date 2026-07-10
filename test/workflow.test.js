const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveDirection,
  resolveSourceMode,
  sourceAcquisitionWorkflow,
  sourceContract,
} = require('../src/workflow');

describe('source acquisition workflow', () => {
  test('blocks image generation until concept and mood are explicit', () => {
    assert.deepEqual(sourceContract(['apple', 'pwa']), {
      preferred: 'png',
      accepted: ['png', 'svg'],
      minimumRasterSize: 1024,
      variants: ['default'],
    });
    const workflow = sourceAcquisitionWorkflow(['expo']);
    assert.equal(workflow.state, 'needs-direction');
    assert.equal(workflow.nextAction, 'collect-direction');
    assert.equal(workflow.imageGenerationAllowed, false);
    assert.deepEqual(workflow.missingDirection, ['concept', 'mood']);
    assert.equal(workflow.uncertainUserPath.action, 'offer-text-directions');
    assert.equal(workflow.uncertainUserPath.count, 3);
    assert.ok(workflow.uncertainUserPath.eachMustInclude.includes('what-it-expresses'));
    assert.deepEqual(workflow.uncertainUserPath.basisPolicy.feasibility, ['technical-target-constraints']);
    assert.match(workflow.uncertainUserPath.basisPolicy.forbiddenInference, /not design intent/);
    assert.equal(workflow.providerBoundary, 'external');
    assert.equal(workflow.recommendedProvider, 'image-generation-model');
    assert.equal(workflow.approvalRequired, true);
    assert.equal(workflow.compileOnlyAfterApproval, true);
    assert.equal(workflow.noFallbackSvgSynthesis, true);
    assert.deepEqual(workflow.sourceContract.variants, ['default', 'adaptiveForeground']);
  });

  test('reviews discovered brand evidence before asking for new direction', () => {
    const workflow = sourceAcquisitionWorkflow(['pwa'], {
      brandContext: { hasEvidence: true },
      direction: resolveDirection(),
    });
    assert.equal(workflow.state, 'needs-direction');
    assert.equal(workflow.nextAction, 'review-brand-evidence');
    assert.equal(workflow.imageGenerationAllowed, false);
  });

  test('requires approval even after direction is complete', () => {
    const direction = resolveDirection(
      { design: { concept: 'one approved source becoming exact delivery assets', mood: ['precise', 'quiet'] } },
      { palette: '#0f172a,#14b8a6' },
    );
    const workflow = sourceAcquisitionWorkflow(['apple'], { direction });
    assert.equal(workflow.state, 'needs-direction-approval');
    assert.equal(workflow.nextAction, 'review-direction');
    assert.equal(workflow.imageGenerationAllowed, false);
  });

  test('allows image generation only after direction is complete and approved', () => {
    const direction = resolveDirection(
      { design: { concept: 'one approved source becoming exact delivery assets', mood: ['precise', 'quiet'] } },
      { palette: '#0f172a,#14b8a6', approved: true },
    );
    const workflow = sourceAcquisitionWorkflow(['apple'], { direction });
    assert.equal(workflow.state, 'ready-for-image-generation');
    assert.equal(workflow.nextAction, 'generate-image');
    assert.equal(workflow.imageGenerationAllowed, true);
    assert.equal(workflow.directionApprovalRequired, false);
    assert.deepEqual(workflow.direction.palette, ['#0f172a', '#14b8a6']);
  });

  test('invalidates config approval when direction content is overridden', () => {
    const direction = resolveDirection(
      { design: { concept: 'approved concept', mood: ['quiet'], approved: true } },
      { mood: 'energetic' },
    );
    assert.equal(direction.approved, false);
    assert.equal(sourceAcquisitionWorkflow(['pwa'], { direction }).state, 'needs-direction-approval');
  });

  test('does not approve an incomplete direction', () => {
    const direction = resolveDirection({}, { concept: 'a signal', approved: true });
    assert.equal(direction.approved, false);
    assert.equal(sourceAcquisitionWorkflow(['pwa'], { direction }).state, 'needs-direction');
  });

  test('preserves a selected text hypothesis through direction review', () => {
    const direction = resolveDirection({}, {
      name: 'Focused signal',
      concept: 'clarity emerging from noisy inputs',
      expresses: 'calm confidence',
      metaphor: 'one bright signal aligned through a field',
      mood: 'precise,quiet',
      tradeoff: 'abstract rather than literal',
    });
    assert.deepEqual(direction, {
      name: 'Focused signal',
      concept: 'clarity emerging from noisy inputs',
      expresses: 'calm confidence',
      metaphor: 'one bright signal aligned through a field',
      mood: ['precise', 'quiet'],
      tradeoff: 'abstract rather than literal',
      palette: [],
      avoid: [],
      references: [],
      approved: false,
    });
  });

  test('skips image generation when an approved source is already configured', () => {
    const workflow = sourceAcquisitionWorkflow(['pwa'], { approvedSource: { type: 'png' } });
    assert.equal(workflow.state, 'ready-to-compile');
    assert.equal(workflow.nextAction, 'compile-preview');
    assert.equal(workflow.imageGenerationAllowed, false);
  });

  test('allows built-in artwork only through explicit placeholder intent', () => {
    assert.equal(resolveSourceMode({ type: 'png' }, {}, {}), 'source');
    assert.equal(resolveSourceMode(null, {}, { placeholder: true }), 'placeholder');
    assert.equal(resolveSourceMode(null, { placeholder: true }, {}), 'placeholder');
    assert.throws(
      () => resolveSourceMode(null, {}, {}),
      { exitCode: 2, message: /no approved icon source found/ },
    );
  });
});

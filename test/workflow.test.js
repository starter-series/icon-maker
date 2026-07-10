const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveSourceMode, sourceAcquisitionWorkflow, sourceContract } = require('../src/workflow');

describe('source acquisition workflow', () => {
  test('prefers an image-generation PNG handoff and requires approval', () => {
    assert.deepEqual(sourceContract(['apple', 'pwa']), {
      preferred: 'png',
      accepted: ['png', 'svg'],
      minimumRasterSize: 1024,
      variants: ['default'],
    });
    const workflow = sourceAcquisitionWorkflow(['expo']);
    assert.equal(workflow.nextAction, 'generate-image');
    assert.equal(workflow.providerBoundary, 'external');
    assert.equal(workflow.recommendedProvider, 'image-generation-model');
    assert.equal(workflow.approvalRequired, true);
    assert.equal(workflow.compileOnlyAfterApproval, true);
    assert.equal(workflow.noFallbackSvgSynthesis, true);
    assert.deepEqual(workflow.sourceContract.variants, ['default', 'adaptiveForeground']);
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

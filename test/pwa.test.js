const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  discoverPwaManifestCandidates,
  planPwaIconFiles,
  planPwaManifestPatch,
  pwaAssetsFromArtifacts,
  resolvePwaManifest,
} = require('../src/pwa');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'icon-maker-pwa-'));
}

function write(file, contents = '{}\n') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function standardAssets(root = 'public') {
  return {
    any: {
      192: `${root}/icon-192.png`,
      512: `${root}/icon-512.png`,
    },
  };
}

function codes(result) {
  return result.diagnostics.map((item) => item.code);
}

describe('PWA manifest planning', () => {
  test('adds maskable and monochrome files only for explicit role sources', () => {
    const base = planPwaIconFiles();
    assert.equal(base.some((file) => file.role === 'maskable'), false);
    assert.equal(base.some((file) => file.role === 'monochrome'), false);

    const files = planPwaIconFiles({ includeMaskable: true, includeMonochrome: true });
    assert.equal(files.filter((file) => file.role === 'maskable').length, 2);
    assert.equal(files.filter((file) => file.role === 'monochrome').length, 1);
    const assets = pwaAssetsFromArtifacts(files.map((file) => ({
      target: 'pwa',
      path: file.path,
      format: file.format,
      size: file.size,
      role: file.role,
    })));
    assert.equal(assets.maskable.approved, true);
    assert.equal(assets.maskable[512], 'public/icon-maskable-512.png');
    assert.equal(assets.monochrome.path, 'public/icon-monochrome.svg');
  });

  test('discovers one data-only manifest and rejects ambiguous candidates', () => {
    const cwd = tempDir();
    const manifest = path.join(cwd, 'public', 'manifest.webmanifest');
    write(manifest);

    assert.deepEqual(discoverPwaManifestCandidates(cwd), [manifest]);
    assert.deepEqual(resolvePwaManifest(cwd), {
      status: 'ready',
      manifestPath: manifest,
      patchSupported: true,
      publicRoot: path.join(cwd, 'public'),
      publicUrlBase: '/',
      diagnostics: [],
    });

    write(path.join(cwd, 'www', 'manifest.json'));
    assert.throws(
      () => resolvePwaManifest(cwd),
      { exitCode: 2, message: /multiple PWA manifests.*set pwa\.manifest explicitly/ },
    );
  });

  test('honors an explicit manifest and enforces data-only checkout containment', {
    skip: process.platform === 'win32',
  }, () => {
    const cwd = tempDir();
    write(path.join(cwd, 'public', 'manifest.json'));
    const selected = path.join(cwd, 'www', 'custom.webmanifest');
    write(selected);

    const result = resolvePwaManifest(cwd, { pwa: { manifest: './www/custom.webmanifest' } });
    assert.equal(result.manifestPath, selected);
    assert.equal(result.patchSupported, true);

    write(path.join(cwd, 'app', 'manifest.js'), 'module.exports = {}');
    assert.throws(
      () => resolvePwaManifest(cwd, { pwa: { manifest: './app/manifest.js' } }),
      { exitCode: 2, message: /data-only/ },
    );

    const outside = tempDir();
    write(path.join(outside, 'manifest.json'));
    fs.symlinkSync(path.join(outside, 'manifest.json'), path.join(cwd, 'outside.json'));
    assert.throws(
      () => resolvePwaManifest(cwd, { pwa: { manifest: './outside.json' } }),
      { exitCode: 2, message: /must stay inside/ },
    );
  });

  test('marks src and Next app manifests unsupported when public URLs are ambiguous', () => {
    for (const relativePath of ['src/manifest.webmanifest', 'app/manifest.json', 'src/app/manifest.json']) {
      const cwd = tempDir();
      write(path.join(cwd, relativePath));
      const resolved = resolvePwaManifest(cwd);
      assert.equal(resolved.status, 'unsupported', relativePath);
      assert.equal(resolved.patchSupported, false, relativePath);
      assert.equal(resolved.publicUrlBase, null, relativePath);
      assert.ok(codes(resolved).includes('pwa-manifest-location-unsupported'), relativePath);

      const plan = planPwaManifestPatch({ cwd, assets: standardAssets() });
      assert.equal(plan.status, 'unsupported', relativePath);
      assert.equal(plan.changed, false, relativePath);
      assert.equal(plan.contents, null, relativePath);
    }
  });

  test('plans any, approved maskable, and monochrome entries without writing', () => {
    const cwd = tempDir();
    const manifestPath = path.join(cwd, 'public', 'manifest.webmanifest');
    const manifest = {
      name: 'Fixture',
      icons: [
        { src: '/old-any.png', sizes: '192x192', type: 'image/png', custom: 'keep' },
        { src: '/old-mask.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: '/unmanaged-96.png', sizes: '96x96', type: 'image/png', purpose: 'any' },
      ],
    };
    const original = `${JSON.stringify(manifest, null, 4).replace(/\n/g, '\r\n')}\r\n`;
    write(manifestPath, original);

    const plan = planPwaManifestPatch({
      cwd,
      assets: {
        ...standardAssets(),
        maskable: {
          approved: true,
          192: 'public/icon-maskable-192.png',
          512: 'public/icon-maskable-512.png',
        },
        monochrome: { path: 'public/icon-monochrome.svg', sizes: 'any' },
      },
    });

    assert.equal(plan.status, 'planned');
    assert.equal(plan.changed, true);
    assert.deepEqual(plan.diagnostics, []);
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), original);
    assert.doesNotMatch(plan.contents, /(?<!\r)\n/);
    assert.match(plan.contents, /\r\n {4}"name"/);

    const next = JSON.parse(plan.contents);
    const any192 = next.icons.find((entry) => entry.sizes === '192x192' && !entry.purpose);
    const mask192 = next.icons.find((entry) => entry.sizes === '192x192' && entry.purpose === 'maskable');
    assert.deepEqual(any192, {
      src: '/icon-192.png',
      sizes: '192x192',
      type: 'image/png',
      custom: 'keep',
    });
    assert.equal(mask192.src, '/icon-maskable-192.png');
    assert.ok(next.icons.some((entry) => entry.src === '/icon-512.png' && entry.purpose === 'any'));
    assert.ok(next.icons.some((entry) => entry.src === '/icon-maskable-512.png' && entry.purpose === 'maskable'));
    assert.ok(next.icons.some((entry) => (
      entry.src === '/icon-monochrome.svg' && entry.sizes === 'any' &&
      entry.type === 'image/svg+xml' && entry.purpose === 'monochrome'
    )));
    assert.ok(next.icons.some((entry) => entry.src === '/unmanaged-96.png'));
  });

  test('omits unapproved maskable artwork while preserving a usable any plan', () => {
    const cwd = tempDir();
    const manifestPath = path.join(cwd, 'public', 'manifest.json');
    write(manifestPath);

    const plan = planPwaManifestPatch({
      cwd,
      assets: {
        ...standardAssets(),
        maskable: {
          approved: false,
          192: 'public/icon-maskable-192.png',
          512: 'public/icon-maskable-512.png',
        },
      },
    });

    assert.equal(plan.status, 'planned');
    assert.ok(codes(plan).includes('pwa-maskable-unapproved'));
    assert.equal(plan.entries.length, 2);
    assert.equal(plan.entries.every((entry) => entry.purpose === 'any'), true);
  });

  test('diagnoses duplicate slots, generated path collisions, and assets outside the public root', () => {
    const duplicateCwd = tempDir();
    write(
      path.join(duplicateCwd, 'public', 'manifest.json'),
      `${JSON.stringify({
        icons: [
          { src: '/one.png', sizes: '192x192', type: 'image/png' },
          { src: '/two.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        ],
      })}\n`,
    );
    const duplicate = planPwaManifestPatch({ cwd: duplicateCwd, assets: standardAssets() });
    assert.equal(duplicate.status, 'conflict');
    assert.ok(codes(duplicate).includes('pwa-icon-duplicate'));

    const collisionCwd = tempDir();
    write(path.join(collisionCwd, 'public', 'manifest.json'));
    const collision = planPwaManifestPatch({
      cwd: collisionCwd,
      assets: {
        ...standardAssets(),
        maskable: {
          approved: true,
          192: 'public/icon-192.png',
          512: 'public/icon-maskable-512.png',
        },
      },
    });
    assert.equal(collision.status, 'conflict');
    assert.ok(codes(collision).includes('pwa-icon-path-collision'));

    const outsideRoot = planPwaManifestPatch({
      cwd: collisionCwd,
      assets: {
        any: { 192: 'assets/icon-192.png', 512: 'public/icon-512.png' },
      },
    });
    assert.equal(outsideRoot.status, 'conflict');
    assert.ok(codes(outsideRoot).includes('pwa-asset-public-root'));
  });

  test('returns missing and invalid states without mutating files', () => {
    const missingCwd = tempDir();
    const missing = planPwaManifestPatch({ cwd: missingCwd, assets: standardAssets() });
    assert.equal(missing.status, 'missing');
    assert.ok(codes(missing).includes('pwa-manifest-missing'));

    const invalidCwd = tempDir();
    const invalidPath = path.join(invalidCwd, 'public', 'manifest.json');
    write(invalidPath, '{broken');
    const invalid = planPwaManifestPatch({ cwd: invalidCwd, assets: standardAssets() });
    assert.equal(invalid.status, 'invalid');
    assert.ok(codes(invalid).includes('pwa-manifest-invalid'));
    assert.equal(fs.readFileSync(invalidPath, 'utf8'), '{broken');

    write(invalidPath, '[]');
    const invalidRoot = planPwaManifestPatch({ cwd: invalidCwd, assets: standardAssets() });
    assert.equal(invalidRoot.status, 'invalid');
    assert.ok(codes(invalidRoot).includes('pwa-manifest-root-invalid'));
    assert.equal(fs.readFileSync(invalidPath, 'utf8'), '[]');
  });
});

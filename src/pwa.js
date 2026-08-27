const fs = require('fs');
const path = require('path');
const { assertContainedExistingPath, assertContainedOutputPath, isContainedPath } = require('./path-safety');

const MANIFEST_CANDIDATES = [
  'public/manifest.webmanifest',
  'public/manifest.json',
  'www/manifest.webmanifest',
  'www/manifest.json',
  'src/manifest.webmanifest',
  'src/manifest.json',
  'app/manifest.json',
  'src/app/manifest.json',
];

function planPwaIconFiles(options = {}) {
  const files = [
    { path: 'public/icon-192.png', size: 192, format: 'png', role: 'any', sourceRole: 'default' },
    { path: 'public/icon-512.png', size: 512, format: 'png', role: 'any', sourceRole: 'default' },
    { path: 'public/favicon.ico', sizes: [16, 32, 48], format: 'ico', role: 'favicon', sourceRole: 'default' },
    { path: 'public/favicon.svg', size: 1024, format: 'svg', role: 'favicon', sourceRole: 'default' },
  ];
  if (options.includeMaskable === true) {
    files.push(
      {
        path: 'public/icon-maskable-192.png',
        size: 192,
        format: 'png',
        role: 'maskable',
        sourceRole: 'maskable',
      },
      {
        path: 'public/icon-maskable-512.png',
        size: 512,
        format: 'png',
        role: 'maskable',
        sourceRole: 'maskable',
      },
    );
  }
  if (options.includeMonochrome === true) {
    files.push({
      path: 'public/icon-monochrome.svg',
      size: 1024,
      format: 'svg',
      role: 'monochrome',
      sourceRole: 'monochrome',
    });
  }
  return files;
}

function pwaAssetsFromArtifacts(artifacts = []) {
  const pwa = artifacts.filter((item) => item.target === 'pwa');
  const find = (role, size) => pwa.find((item) => item.role === role && item.size === size)?.path;
  const assets = {
    any: {
      192: find('any', 192),
      512: find('any', 512),
    },
  };
  const maskable192 = find('maskable', 192);
  const maskable512 = find('maskable', 512);
  if (maskable192 || maskable512) {
    assets.maskable = { approved: true, 192: maskable192, 512: maskable512 };
  }
  const monochrome = pwa.find((item) => item.role === 'monochrome');
  if (monochrome) {
    assets.monochrome = {
      path: monochrome.path,
      sizes: monochrome.format === 'svg' ? 'any' : `${monochrome.size}x${monochrome.size}`,
      type: monochrome.format === 'svg' ? 'image/svg+xml' : 'image/png',
    };
  }
  return assets;
}

function usageError(message) {
  const err = new Error(message);
  err.exitCode = 2;
  return err;
}

function relative(cwd, file) {
  return path.relative(cwd, file).split(path.sep).join('/') || '.';
}

function diagnostic(severity, code, file, message) {
  return { severity, code, target: 'pwa', path: file, message };
}

function isDataManifestPath(file) {
  const extension = path.extname(file).toLowerCase();
  return extension === '.json' || extension === '.webmanifest';
}

function validateManifestPath(cwd, file, label = 'pwa.manifest') {
  if (!isDataManifestPath(file)) {
    throw usageError(`${label} must point to a data-only .json or .webmanifest file: ${file}`);
  }
  try {
    assertContainedExistingPath(cwd, file, label);
  } catch (err) {
    if (err && err.exitCode === 2) throw err;
    throw usageError(`${label} does not exist: ${file}`);
  }
  if (!fs.statSync(file).isFile()) throw usageError(`${label} must point to a regular file: ${file}`);
  return file;
}

function discoverPwaManifestCandidates(cwd = process.cwd()) {
  const root = path.resolve(cwd);
  const candidates = [];
  for (const candidate of MANIFEST_CANDIDATES) {
    const file = path.join(root, candidate);
    if (!fs.existsSync(file)) continue;
    validateManifestPath(root, file, 'PWA manifest candidate');
    candidates.push(file);
  }
  return candidates;
}

function classifyManifestLocation(cwd, manifestPath) {
  const parts = relative(cwd, manifestPath).split('/');
  if (parts[0] === 'public' || parts[0] === 'www') {
    return {
      patchSupported: true,
      publicRoot: path.join(cwd, parts[0]),
      publicUrlBase: '/',
    };
  }
  return {
    patchSupported: false,
    publicRoot: null,
    publicUrlBase: null,
  };
}

function resolvePwaManifest(cwd = process.cwd(), config = {}, diagnostics = []) {
  const root = path.resolve(cwd);
  const configured = config.pwa?.manifest;
  let manifestPath;
  if (configured !== undefined) {
    if (typeof configured !== 'string' || !configured.trim()) {
      throw usageError('pwa.manifest must be a non-empty path');
    }
    manifestPath = path.resolve(root, configured);
    validateManifestPath(root, manifestPath);
  } else {
    const candidates = discoverPwaManifestCandidates(root);
    if (candidates.length > 1) {
      throw usageError(
        `multiple PWA manifests found (${candidates.map((file) => relative(root, file)).join(', ')}); ` +
        'set pwa.manifest explicitly',
      );
    }
    manifestPath = candidates[0] || null;
  }

  if (!manifestPath) {
    diagnostics.push(diagnostic(
      'warning',
      'pwa-manifest-missing',
      path.join(root, 'public', 'manifest.webmanifest'),
      'no data-only PWA manifest candidate was found',
    ));
    return {
      status: 'missing',
      manifestPath: null,
      patchSupported: false,
      publicRoot: null,
      publicUrlBase: null,
      diagnostics,
    };
  }

  const location = classifyManifestLocation(root, manifestPath);
  if (!location.patchSupported) {
    diagnostics.push(diagnostic(
      'warning',
      'pwa-manifest-location-unsupported',
      manifestPath,
      `${relative(root, manifestPath)} was found, but its deployed public URL base cannot be inferred safely; automatic patching is unsupported`,
    ));
  }
  return {
    status: location.patchSupported ? 'ready' : 'unsupported',
    manifestPath,
    ...location,
    diagnostics,
  };
}

function detectJsonStyle(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const indentMatch = text.match(/\r?\n([ \t]+)"/);
  return {
    eol,
    indent: indentMatch ? indentMatch[1] : '  ',
    finalNewline: text.endsWith('\n'),
  };
}

function renderJson(json, style) {
  const rendered = JSON.stringify(json, null, style.indent).replace(/\n/g, style.eol);
  return style.finalNewline ? `${rendered}${style.eol}` : rendered;
}

function readManifest(manifestPath, diagnostics) {
  let text;
  try {
    text = fs.readFileSync(manifestPath, 'utf8');
  } catch (_err) {
    diagnostics.push(diagnostic(
      'error',
      'pwa-manifest-unreadable',
      manifestPath,
      `${manifestPath} could not be read`,
    ));
    return null;
  }
  try {
    const json = JSON.parse(text);
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      diagnostics.push(diagnostic(
        'error',
        'pwa-manifest-root-invalid',
        manifestPath,
        `${manifestPath} must contain a JSON object at the document root`,
      ));
      return null;
    }
    return { json, text, style: detectJsonStyle(text) };
  } catch (_err) {
    diagnostics.push(diagnostic(
      'error',
      'pwa-manifest-invalid',
      manifestPath,
      `${manifestPath} is not valid JSON`,
    ));
    return null;
  }
}

function normalizePurpose(value) {
  const words = String(value || 'any').trim().split(/\s+/).filter(Boolean).sort();
  return words.length ? words.join(' ') : 'any';
}

function mimeForPath(file, explicit) {
  if (explicit) return explicit;
  return path.extname(file).toLowerCase() === '.svg' ? 'image/svg+xml' : 'image/png';
}

function assetDescriptor(value, defaultSizes) {
  if (typeof value === 'string') return { path: value, sizes: defaultSizes };
  if (!value || typeof value !== 'object') return null;
  const sizes = value.sizes || (value.size ? `${value.size}x${value.size}` : defaultSizes);
  return { path: value.path, sizes, type: value.type };
}

function publicAssetEntry(cwd, resolution, purpose, descriptor, diagnostics) {
  if (!descriptor?.path || typeof descriptor.path !== 'string') return null;
  const absolutePath = path.resolve(cwd, descriptor.path);
  assertContainedOutputPath(cwd, absolutePath, `PWA ${purpose} asset`);
  if (!isContainedPath(path.resolve(resolution.publicRoot), absolutePath)) {
    diagnostics.push(diagnostic(
      'error',
      'pwa-asset-public-root',
      absolutePath,
      `${relative(cwd, absolutePath)} is outside the manifest public root ${relative(cwd, resolution.publicRoot)}`,
    ));
    return null;
  }
  const publicPath = relative(resolution.publicRoot, absolutePath);
  return {
    src: `${resolution.publicUrlBase}${publicPath}`,
    sizes: descriptor.sizes,
    type: mimeForPath(absolutePath, descriptor.type),
    purpose,
    sourcePath: absolutePath,
  };
}

function requiredSizedEntries(cwd, resolution, purpose, group, diagnostics) {
  const entries = [];
  for (const size of [192, 512]) {
    const descriptor = assetDescriptor(group?.[String(size)], `${size}x${size}`);
    if (!descriptor) {
      diagnostics.push(diagnostic(
        'error',
        `pwa-${purpose}-asset-missing`,
        resolution.manifestPath,
        `${purpose} requires a separately supplied ${size}x${size} asset`,
      ));
      continue;
    }
    const entry = publicAssetEntry(cwd, resolution, purpose, descriptor, diagnostics);
    if (entry) entries.push(entry);
  }
  return entries;
}

function desiredIconEntries(cwd, resolution, assets, diagnostics) {
  const entries = requiredSizedEntries(cwd, resolution, 'any', assets.any, diagnostics);
  if (assets.maskable) {
    if (assets.maskable.approved === true) {
      entries.push(...requiredSizedEntries(cwd, resolution, 'maskable', assets.maskable, diagnostics));
    } else {
      diagnostics.push(diagnostic(
        'warning',
        'pwa-maskable-unapproved',
        resolution.manifestPath,
        'maskable assets were supplied but omitted because their separate artwork was not explicitly approved',
      ));
    }
  }
  if (assets.monochrome) {
    const descriptor = assetDescriptor(assets.monochrome, 'any');
    const entry = publicAssetEntry(cwd, resolution, 'monochrome', descriptor, diagnostics);
    if (entry) entries.push(entry);
  }
  return entries;
}

function entrySlot(entry) {
  return `${normalizePurpose(entry.purpose)}:${entry.sizes || ''}`;
}

function addCollisionDiagnostics(existing, desired, manifestPath, diagnostics) {
  const desiredByPath = new Map();
  for (const entry of desired) {
    const previous = desiredByPath.get(entry.src);
    if (previous && entrySlot(previous) !== entrySlot(entry)) {
      diagnostics.push(diagnostic(
        'error',
        'pwa-icon-path-collision',
        manifestPath,
        `${entry.src} is assigned to both ${entrySlot(previous)} and ${entrySlot(entry)}`,
      ));
    } else {
      desiredByPath.set(entry.src, entry);
    }
  }

  const exact = new Set();
  for (const entry of existing) {
    const key = `${entrySlot(entry)}:${entry.src || ''}:${entry.type || ''}`;
    if (exact.has(key)) {
      diagnostics.push(diagnostic(
        'error',
        'pwa-icon-duplicate',
        manifestPath,
        `duplicate manifest icon entry: ${key}`,
      ));
    }
    exact.add(key);
  }

  for (const desiredEntry of desired) {
    const matches = existing.filter((entry) => entrySlot(entry) === entrySlot(desiredEntry));
    if (matches.length > 1) {
      diagnostics.push(diagnostic(
        'error',
        'pwa-icon-duplicate',
        manifestPath,
        `multiple existing entries claim ${entrySlot(desiredEntry)}`,
      ));
    }
    const conflicting = existing.find((entry) => (
      entry?.src === desiredEntry.src && entrySlot(entry) !== entrySlot(desiredEntry)
    ));
    if (conflicting) {
      diagnostics.push(diagnostic(
        'error',
        'pwa-icon-path-collision',
        manifestPath,
        `${desiredEntry.src} is already used by unmanaged slot ${entrySlot(conflicting)}`,
      ));
    }
  }
}

function patchIcons(existing, desired) {
  const icons = existing.map((entry) => ({ ...entry }));
  for (const desiredEntry of desired) {
    const index = icons.findIndex((entry) => entrySlot(entry) === entrySlot(desiredEntry));
    const managed = {
      src: desiredEntry.src,
      sizes: desiredEntry.sizes,
      type: desiredEntry.type,
      purpose: desiredEntry.purpose,
    };
    if (index === -1) icons.push(managed);
    else {
      const current = icons[index];
      icons[index] = { ...current, ...managed };
      if (desiredEntry.purpose === 'any' && current.purpose === undefined) delete icons[index].purpose;
    }
  }
  return icons;
}

function planPwaManifestPatch(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const diagnostics = [];
  const resolution = resolvePwaManifest(cwd, options.config || {}, diagnostics);
  const base = {
    manifestPath: resolution.manifestPath,
    patchSupported: resolution.patchSupported,
    publicRoot: resolution.publicRoot,
    publicUrlBase: resolution.publicUrlBase,
    diagnostics,
  };
  if (resolution.status !== 'ready') {
    return { ...base, status: resolution.status, changed: false, contents: null };
  }

  const document = readManifest(resolution.manifestPath, diagnostics);
  if (!document) return { ...base, status: 'invalid', changed: false, contents: null };
  if (document.json.icons !== undefined && !Array.isArray(document.json.icons)) {
    diagnostics.push(diagnostic(
      'error',
      'pwa-icons-invalid',
      resolution.manifestPath,
      'PWA manifest icons must be an array',
    ));
    return { ...base, status: 'invalid', changed: false, contents: document.text };
  }

  const existing = document.json.icons || [];
  if (existing.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) {
    diagnostics.push(diagnostic(
      'error',
      'pwa-icon-entry-invalid',
      resolution.manifestPath,
      'PWA manifest icon entries must be JSON objects',
    ));
    return { ...base, status: 'invalid', changed: false, contents: document.text };
  }
  const desired = desiredIconEntries(cwd, resolution, options.assets || {}, diagnostics);
  addCollisionDiagnostics(existing, desired, resolution.manifestPath, diagnostics);
  if (diagnostics.some((item) => item.severity === 'error')) {
    return { ...base, status: 'conflict', changed: false, contents: document.text };
  }

  const next = { ...document.json, icons: patchIcons(existing, desired) };
  const contents = JSON.stringify(next) === JSON.stringify(document.json)
    ? document.text : renderJson(next, document.style);
  return {
    ...base,
    status: contents === document.text ? 'unchanged' : 'planned',
    changed: contents !== document.text,
    contents,
    manifest: next,
    entries: desired.map(({ sourcePath: _sourcePath, ...entry }) => entry),
  };
}

module.exports = {
  MANIFEST_CANDIDATES,
  discoverPwaManifestCandidates,
  planPwaIconFiles,
  planPwaManifestPatch,
  pwaAssetsFromArtifacts,
  resolvePwaManifest,
};

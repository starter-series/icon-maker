const fs = require('fs');
const path = require('path');
const { assertContainedOutputPath } = require('./path-safety');

const SKIP_DIRECTORIES = new Set([
  '.git',
  '.build',
  '.next',
  'build',
  'coverage',
  'DerivedData',
  'dist',
  'node_modules',
  'out',
  'Pods',
  'target',
  'vendor',
]);

function scanAppleProject(cwd, maxDepth = 5) {
  const catalogs = [];
  const projects = [];

  function visit(directory, depth) {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (_err) {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.name.endsWith('.xcassets')) {
        catalogs.push(absolutePath);
        continue;
      }
      if (entry.name.endsWith('.xcodeproj') || entry.name.endsWith('.xcworkspace')) {
        projects.push(absolutePath);
        continue;
      }
      if (depth < maxDepth && !SKIP_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) {
        visit(absolutePath, depth + 1);
      }
    }
  }

  visit(cwd, 0);
  return { catalogs, projects };
}

function projectScan(cwd, context) {
  if (context?.appleScan) return context.appleScan;
  const scanned = scanAppleProject(cwd);
  if (context) context.appleScan = scanned;
  return scanned;
}

function hasAppleProject(cwd, context) {
  const scanned = projectScan(cwd, context);
  return scanned.catalogs.length > 0 || scanned.projects.length > 0;
}

function explicitAssetCatalog(cwd, configured) {
  if (typeof configured !== 'string' || !configured.trim()) {
    const err = new Error('apple.assetCatalog must be a non-empty path');
    err.exitCode = 2;
    throw err;
  }
  const candidate = path.resolve(cwd, configured);
  if (!candidate.endsWith('.xcassets')) {
    const err = new Error(`apple.assetCatalog must point to an .xcassets directory: ${candidate}`);
    err.exitCode = 2;
    throw err;
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
    const err = new Error(`apple.assetCatalog does not exist or is not a directory: ${candidate}`);
    err.exitCode = 2;
    throw err;
  }
  assertContainedOutputPath(cwd, candidate, 'apple.assetCatalog');
  return candidate;
}

function isPreviewCatalog(catalog) {
  const parts = catalog.split(path.sep).map((part) => part.toLowerCase());
  const basename = path.basename(catalog).toLowerCase();
  return parts.includes('preview content') || basename.startsWith('preview assets');
}

function resolveAppleAssetCatalog(cwd, config, warnings = [], scanned = null) {
  if (config.apple && Object.prototype.hasOwnProperty.call(config.apple, 'assetCatalog')) {
    return explicitAssetCatalog(cwd, config.apple.assetCatalog);
  }

  const { catalogs } = scanned || scanAppleProject(cwd);
  const candidates = catalogs.filter((catalog) => !isPreviewCatalog(catalog));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    const listed = candidates.map((catalog) => path.relative(cwd, catalog)).join(', ');
    const err = new Error(
      `multiple Xcode asset catalogs found (${listed}); set apple.assetCatalog in icon-maker config`,
    );
    err.exitCode = 2;
    throw err;
  }

  const fallback = path.join(cwd, 'Assets.xcassets');
  assertContainedOutputPath(cwd, fallback, 'apple.assetCatalog');
  warnings.push({
    code: 'apple-catalog-created',
    message: `no Xcode asset catalog was found; writing ${path.relative(cwd, fallback)} (add it to the Xcode project if needed)`,
  });
  return fallback;
}

function normalizeAppIconSetName(value) {
  const raw = String(value || '').trim();
  const name = raw.endsWith('.appiconset') ? raw.slice(0, -'.appiconset'.length) : raw;
  if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name) || /\$[({]/.test(name)) {
    const err = new Error(`apple.appIconSet must be a single asset name: ${raw || '(empty)'}`);
    err.exitCode = 2;
    throw err;
  }
  return name;
}

function detectAppIconSetNames(scanned) {
  const names = new Set();
  const pattern = /ASSETCATALOG_COMPILER_APPICON_NAME\s*=\s*(?:"([^"]+)"|([^;]+))\s*;/g;
  for (const project of scanned.projects.filter((entry) => entry.endsWith('.xcodeproj'))) {
    let text;
    try {
      text = fs.readFileSync(path.join(project, 'project.pbxproj'), 'utf8');
    } catch (_err) {
      continue;
    }
    for (const match of text.matchAll(pattern)) {
      const value = String(match[1] || match[2] || '').trim();
      if (value) names.add(value);
    }
  }
  return [...names];
}

function resolveAppleAppIconSet(cwd, config, warnings = [], scanned = null) {
  const project = scanned || scanAppleProject(cwd);
  const configured = config.apple?.appIconSet;
  const detected = detectAppIconSetNames(project);
  if (configured) {
    const selected = normalizeAppIconSetName(configured);
    if (project.projects.length && detected.length && !detected.includes(selected)) {
      warnings.push({
        code: 'apple-set-selection-required',
        message: `apple.appIconSet is ${selected}, but Xcode currently selects ${detected.join(', ')}; update the target's App Icon setting`,
      });
    }
    return selected;
  }
  if (detected.length > 1) {
    const err = new Error(
      `multiple Xcode App Icon set names found (${detected.join(', ')}); set apple.appIconSet in icon-maker config`,
    );
    err.exitCode = 2;
    throw err;
  }
  return normalizeAppIconSetName(detected[0] || 'AppIcon');
}

function imageKey(image) {
  return JSON.stringify({
    idiom: image.idiom || null,
    platform: image.platform || null,
    size: image.size || null,
    scale: image.scale || null,
    appearances: image.appearances || null,
  });
}

function mergeAppleContents(catalog, appIconSet, generatedContents) {
  const setDirectory = path.join(catalog, `${appIconSet}.appiconset`);
  const contentsPath = path.join(setDirectory, 'Contents.json');
  if (!fs.existsSync(contentsPath)) {
    if (fs.existsSync(setDirectory)) {
      const existingFiles = fs.readdirSync(setDirectory).filter((name) => !name.startsWith('.'));
      if (existingFiles.length) {
        const err = new Error(
          `${path.relative(catalog, setDirectory)} contains files but no Contents.json; refusing to take ownership`,
        );
        err.exitCode = 2;
        throw err;
      }
    }
    return generatedContents;
  }

  let existing;
  try {
    existing = JSON.parse(fs.readFileSync(contentsPath, 'utf8'));
  } catch (_err) {
    const err = new Error(`could not parse existing Xcode app icon metadata: ${contentsPath}`);
    err.exitCode = 2;
    throw err;
  }
  if (!Array.isArray(existing.images)) {
    const err = new Error(`existing Xcode app icon metadata has no images array: ${contentsPath}`);
    err.exitCode = 2;
    throw err;
  }

  const ownedFilenames = new Set(generatedContents.images.map((image) => image.filename));
  const unmanaged = existing.images
    .map((image) => image?.filename)
    .filter((filename) => filename && !ownedFilenames.has(filename));
  if (unmanaged.length) {
    const err = new Error(
      `${appIconSet}.appiconset already references unmanaged icon files (${unmanaged.join(', ')}); ` +
      'configure apple.appIconSet with a new name instead of overwriting them',
    );
    err.exitCode = 2;
    throw err;
  }

  const generatedByKey = new Map(generatedContents.images.map((image) => [imageKey(image), image]));
  const used = new Set();
  const images = existing.images.map((image) => {
    const key = imageKey(image || {});
    const generated = generatedByKey.get(key);
    if (!generated) return image;
    used.add(key);
    return { ...image, ...generated };
  });
  for (const generated of generatedContents.images) {
    const key = imageKey(generated);
    if (!used.has(key)) images.push(generated);
  }
  return {
    ...generatedContents,
    ...existing,
    images,
    info: { ...generatedContents.info, ...existing.info },
  };
}

module.exports = {
  hasAppleProject,
  mergeAppleContents,
  projectScan,
  resolveAppleAppIconSet,
  resolveAppleAssetCatalog,
  scanAppleProject,
};

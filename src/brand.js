const fs = require('fs');
const path = require('path');
const { scanAppleProject } = require('./apple');

const SKIP_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.build',
  'Assets.xcassets',
  'DerivedData',
  'Pods',
  'build',
  'compiled',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'vendor',
]);
const ASSET_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.svg', '.webp']);
const BRAND_ASSET_NAME = /(?:^|[-_.])(brand(?:mark)?|logo(?:mark|type)?|wordmark)(?=[-_.@]|$)/i;
const ICON_ASSET_NAME = /^(?:app-?icon|favicon|icon)\.(?:jpe?g|png|svg|webp)$/i;
const BRAND_DOCUMENT_NAME = /(?:brand|identity|style[-_ ]?guide|visual[-_ ]?guide)/i;

function sortEntries(entries) {
  return entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

function portablePath(value) {
  return String(value).split(path.sep).join('/');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_err) {
    return null;
  }
}

function assetKind(name) {
  if (/wordmark|logotype/i.test(name)) return 'wordmark';
  if (/logo|brandmark|logomark/i.test(name)) return 'logo';
  return 'icon';
}

function scanBrandFiles(cwd, maxDepth = 4) {
  const assets = [];
  const documents = [];

  function visit(directory, depth, inBrandDirectory) {
    let entries;
    try {
      entries = sortEntries(fs.readdirSync(directory, { withFileTypes: true }));
    } catch (_err) {
      return;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          depth >= maxDepth
          || entry.name.startsWith('.')
          || entry.name.endsWith('.xcassets')
          || SKIP_DIRECTORIES.has(entry.name)
        ) continue;
        const nextBrandDirectory = inBrandDirectory || /^(?:brand|branding|identity)$/i.test(entry.name);
        visit(absolutePath, depth + 1, nextBrandDirectory);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      const relativePath = portablePath(path.relative(cwd, absolutePath));
      if (
        assets.length < 24
        && ASSET_EXTENSIONS.has(extension)
        && (inBrandDirectory || BRAND_ASSET_NAME.test(entry.name) || ICON_ASSET_NAME.test(entry.name))
      ) {
        assets.push({ path: absolutePath, relativePath, kind: assetKind(entry.name) });
      }
      if (
        documents.length < 12
        && ['.md', '.txt'].includes(extension)
        && (inBrandDirectory || BRAND_DOCUMENT_NAME.test(entry.name))
      ) {
        documents.push({ path: absolutePath, relativePath });
      }
    }
  }

  visit(cwd, 0, false);
  return { assets, documents };
}

function scanAppleIcons(cwd, assets) {
  const catalogs = scanAppleProject(cwd).catalogs.sort().slice(0, 8);

  function visit(directory, depth) {
    let entries;
    try {
      entries = sortEntries(fs.readdirSync(directory, { withFileTypes: true }));
    } catch (_err) {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.name.endsWith('.appiconset')) {
        const contents = readJson(path.join(absolutePath, 'Contents.json'));
        const images = Array.isArray(contents?.images) ? contents.images : [];
        for (const image of images) {
          const filename = image?.filename;
          if (!filename || path.basename(filename) !== filename || assets.length >= 24) continue;
          const iconPath = path.join(absolutePath, filename);
          const extension = path.extname(iconPath).toLowerCase();
          let stat;
          try {
            stat = fs.lstatSync(iconPath);
          } catch (_err) {
            continue;
          }
          if (!ASSET_EXTENSIONS.has(extension) || !stat.isFile() || stat.isSymbolicLink()) continue;
          assets.push({ path: iconPath, relativePath: portablePath(path.relative(cwd, iconPath)), kind: 'icon' });
        }
        continue;
      }
      if (depth < 3) visit(absolutePath, depth + 1);
    }
  }

  for (const catalog of catalogs) visit(catalog, 0);
}

function addColor(colors, seen, value, source) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^#[0-9a-f]{3}(?:[0-9a-f]{3})?(?:[0-9a-f]{2})?$/.test(normalized)) return;
  if (seen.has(normalized) || colors.length >= 12) return;
  seen.add(normalized);
  colors.push({ value: normalized, source });
}

function manifestColors(cwd, colors, seen) {
  const manifests = [
    ['manifest.json', ['theme_color', 'background_color']],
    [path.join('public', 'manifest.json'), ['theme_color', 'background_color']],
  ];
  for (const [relativePath, fields] of manifests) {
    const data = readJson(path.join(cwd, relativePath));
    for (const field of fields) addColor(colors, seen, data?.[field], `${portablePath(relativePath)}:${field}`);
  }

  const app = readJson(path.join(cwd, 'app.json'))?.expo;
  addColor(colors, seen, app?.primaryColor, 'app.json:expo.primaryColor');
  addColor(colors, seen, app?.backgroundColor, 'app.json:expo.backgroundColor');
  addColor(
    colors,
    seen,
    app?.android?.adaptiveIcon?.backgroundColor,
    'app.json:expo.android.adaptiveIcon.backgroundColor',
  );
}

function svgColors(cwd, assets, colors, seen) {
  for (const asset of assets.filter((item) => path.extname(item.path).toLowerCase() === '.svg')) {
    let text;
    try {
      const stat = fs.statSync(asset.path);
      if (stat.size > 256 * 1024) continue;
      text = fs.readFileSync(asset.path, 'utf8');
    } catch (_err) {
      continue;
    }
    for (const match of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      addColor(colors, seen, match[0], `${portablePath(path.relative(cwd, asset.path))}:svg`);
    }
  }
}

function discoverBrandContext(cwd) {
  const { assets, documents } = scanBrandFiles(cwd);
  scanAppleIcons(cwd, assets);
  const colors = [];
  const seen = new Set();
  manifestColors(cwd, colors, seen);
  svgColors(cwd, assets, colors, seen);
  return {
    assets: assets.map(({ relativePath, kind }) => ({ relativePath, kind })),
    documents: documents.map(({ relativePath }) => ({ relativePath })),
    colors,
    hasEvidence: assets.length > 0 || documents.length > 0 || colors.length > 0,
  };
}

module.exports = { discoverBrandContext, scanBrandFiles };

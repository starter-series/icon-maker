const fs = require('fs');
const path = require('path');
const { TARGETS } = require('./targets');

function detectJsonStyle(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const indentMatch = text.match(/\n([ \t]+)"/);
  return { eol, indent: indentMatch ? indentMatch[1] : '  ' };
}

function readJsonDocument(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    // A missing file is the normal "nothing to patch" case; anything else
    // (permissions, etc.) is surfaced as a read error.
    if (err && err.code === 'ENOENT') return null;
    return { error: `could not read ${file}` };
  }
  try {
    return { json: JSON.parse(text), text, style: detectJsonStyle(text) };
  } catch (_err) {
    return { error: `could not parse ${file}` };
  }
}

// Load a JSON document for patching, distinguishing "file absent" (skip
// quietly) from "file present but unreadable/unparseable" (record a warning so
// the caller does not silently no-op).
function loadPatchDocument(file, warnings) {
  const doc = readJsonDocument(file);
  if (doc && doc.error) {
    if (warnings) warnings.push({ code: 'patch-skipped', message: doc.error });
    return null;
  }
  return doc;
}

function writeJsonDocument(file, doc) {
  const next = `${JSON.stringify(doc.json, null, doc.style.indent)}${doc.style.eol}`;
  if (next === doc.text) return false;
  fs.writeFileSync(file, next);
  return true;
}

function patchJsonDocument(file, warnings, mutate) {
  const doc = loadPatchDocument(file, warnings);
  if (!doc) return null;
  const result = mutate(doc.json);
  if (!result?.changed || !writeJsonDocument(file, doc)) return null;
  return { file, ...result.patch };
}

function setIfChanged(object, key, value) {
  if (object[key] === value) return false;
  object[key] = value;
  return true;
}

function rel(cwd, absolutePath) {
  return path.relative(cwd, absolutePath).split(path.sep).join('/');
}

function producedByName(cwd, produced, target, basename) {
  const item = produced.find((entry) => entry.target === target && path.basename(entry.path) === basename);
  return item ? rel(cwd, item.path) : null;
}

function patchBrowserExtension(cwd, produced, warnings) {
  const file = path.join(cwd, 'manifest.json');
  return patchJsonDocument(file, warnings, (json) => {
    json.icons = json.icons || {};
    let changed = false;
    for (const size of [16, 32, 48, 128]) {
      const iconPath = producedByName(cwd, produced, 'browser-extension', `icon${size}.png`);
      if (iconPath) changed = setIfChanged(json.icons, String(size), iconPath) || changed;
    }
    return { changed, patch: { target: 'browser-extension', action: 'updated manifest.icons' } };
  });
}

function patchExpo(cwd, produced, warnings) {
  const file = path.join(cwd, 'app.json');
  return patchJsonDocument(file, warnings, (json) => {
    if (!json?.expo) return null;
    const icon = producedByName(cwd, produced, 'expo', 'icon.png');
    const adaptive = producedByName(cwd, produced, 'expo', 'adaptive-icon.png');
    let changed = false;
    if (icon) changed = setIfChanged(json.expo, 'icon', `./${icon}`) || changed;
    if (adaptive) {
      json.expo.android = json.expo.android || {};
      json.expo.android.adaptiveIcon = json.expo.android.adaptiveIcon || {};
      changed = setIfChanged(json.expo.android.adaptiveIcon, 'foregroundImage', `./${adaptive}`) || changed;
    }
    return { changed, patch: { target: 'expo', action: 'updated expo icon fields' } };
  });
}

function patchPackageIcon(cwd, produced, target, basename, warnings) {
  const file = path.join(cwd, 'package.json');
  return patchJsonDocument(file, warnings, (json) => {
    const icon = producedByName(cwd, produced, target, basename);
    if (!icon) return null;
    return {
      changed: setIfChanged(json, 'icon', icon),
      patch: { target, action: 'updated package.json icon' },
    };
  });
}

function patchPwa(cwd, produced, warnings) {
  const file = path.join(cwd, 'public', 'manifest.json');
  return patchJsonDocument(file, warnings, (json) => {
    const icon192 = producedByName(cwd, produced, 'pwa', 'icon-192.png');
    const icon512 = producedByName(cwd, produced, 'pwa', 'icon-512.png');
    const generated = [];
    if (icon192) generated.push({ src: `/${icon192.replace(/^public\//, '')}`, sizes: '192x192', type: 'image/png' });
    if (icon512) generated.push({ src: `/${icon512.replace(/^public\//, '')}`, sizes: '512x512', type: 'image/png' });
    if (!generated.length) return null;
    const existing = Array.isArray(json.icons) ? json.icons : [];
    let changed = false;
    for (const gen of generated) {
      // Update in place an entry of the same size that already targets the
      // generated file or has no `purpose`, so dedicated maskable/monochrome
      // entries and unrelated sizes (e.g. apple-touch) are preserved.
      const match = existing.find(
        (entry) => entry && entry.sizes === gen.sizes && (entry.src === gen.src || !entry.purpose),
      );
      if (match) {
        changed = setIfChanged(match, 'src', gen.src) || changed;
        changed = setIfChanged(match, 'type', gen.type) || changed;
      } else {
        existing.push(gen);
        changed = true;
      }
    }
    if (changed) json.icons = existing;
    return { changed, patch: { target: 'pwa', action: 'updated web app manifest icons' } };
  });
}

const PATCHERS = {
  'browser-extension': (cwd, produced, _target, _spec, warnings) => patchBrowserExtension(cwd, produced, warnings),
  expo: (cwd, produced, _target, _spec, warnings) => patchExpo(cwd, produced, warnings),
  'package-icon': (cwd, produced, target, spec, warnings) => patchPackageIcon(cwd, produced, target, spec.basename, warnings),
  pwa: (cwd, produced, _target, _spec, warnings) => patchPwa(cwd, produced, warnings),
};

function patchInputPath(cwd, _target, spec) {
  if (spec.type === 'browser-extension') return path.join(cwd, 'manifest.json');
  if (spec.type === 'expo') return path.join(cwd, 'app.json');
  if (spec.type === 'package-icon') return path.join(cwd, 'package.json');
  if (spec.type === 'pwa') return path.join(cwd, 'public', 'manifest.json');
  return null;
}

function applyPatches(cwd, targets, produced, warnings) {
  const patches = [];
  for (const target of targets) {
    const spec = TARGETS[target]?.patch;
    const patcher = spec && PATCHERS[spec.type];
    const input = spec && patchInputPath(cwd, target, spec);
    if (patcher && input && !fs.existsSync(input)) {
      warnings.push({
        code: 'patch-target-missing',
        message: `--patch requested for ${target}, but ${path.relative(cwd, input)} was not found`,
      });
      continue;
    }
    const patch = patcher ? patcher(cwd, produced, target, spec, warnings) : null;
    if (patch) patches.push(patch);
  }
  return patches;
}

module.exports = { applyPatches, detectJsonStyle };

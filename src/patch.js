const fs = require('fs');
const path = require('path');

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
  const doc = loadPatchDocument(file, warnings);
  if (!doc) return null;
  doc.json.icons = doc.json.icons || {};
  let changed = false;
  for (const size of [16, 32, 48, 128]) {
    const iconPath = producedByName(cwd, produced, 'browser-extension', `icon${size}.png`);
    if (iconPath) changed = setIfChanged(doc.json.icons, String(size), iconPath) || changed;
  }
  if (!changed || !writeJsonDocument(file, doc)) return null;
  return { file, target: 'browser-extension', action: 'updated manifest.icons' };
}

function patchExpo(cwd, produced, warnings) {
  const file = path.join(cwd, 'app.json');
  const doc = loadPatchDocument(file, warnings);
  if (!doc?.json?.expo) return null;
  const icon = producedByName(cwd, produced, 'expo', 'icon.png');
  const adaptive = producedByName(cwd, produced, 'expo', 'adaptive-icon.png');
  let changed = false;
  if (icon) changed = setIfChanged(doc.json.expo, 'icon', `./${icon}`) || changed;
  if (adaptive) {
    doc.json.expo.android = doc.json.expo.android || {};
    doc.json.expo.android.adaptiveIcon = doc.json.expo.android.adaptiveIcon || {};
    changed = setIfChanged(doc.json.expo.android.adaptiveIcon, 'foregroundImage', `./${adaptive}`) || changed;
  }
  if (!changed || !writeJsonDocument(file, doc)) return null;
  return { file, target: 'expo', action: 'updated expo icon fields' };
}

function patchPackageIcon(cwd, produced, target, basename, warnings) {
  const file = path.join(cwd, 'package.json');
  const doc = loadPatchDocument(file, warnings);
  if (!doc) return null;
  const icon = producedByName(cwd, produced, target, basename);
  if (!icon) return null;
  if (!setIfChanged(doc.json, 'icon', icon) || !writeJsonDocument(file, doc)) return null;
  return { file, target, action: 'updated package.json icon' };
}

function patchPwa(cwd, produced, warnings) {
  const file = path.join(cwd, 'public', 'manifest.json');
  const doc = loadPatchDocument(file, warnings);
  if (!doc) return null;
  const icon192 = producedByName(cwd, produced, 'pwa', 'icon-192.png');
  const icon512 = producedByName(cwd, produced, 'pwa', 'icon-512.png');
  const generated = [];
  if (icon192) generated.push({ src: `/${icon192.replace(/^public\//, '')}`, sizes: '192x192', type: 'image/png' });
  if (icon512) generated.push({ src: `/${icon512.replace(/^public\//, '')}`, sizes: '512x512', type: 'image/png' });
  if (!generated.length) return null;
  const existing = Array.isArray(doc.json.icons) ? doc.json.icons : [];
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
  if (!changed) return null;
  doc.json.icons = existing;
  if (!writeJsonDocument(file, doc)) return null;
  return { file, target: 'pwa', action: 'updated web app manifest icons' };
}

function applyPatches(cwd, targets, produced, warnings) {
  const patches = [];
  for (const target of targets) {
    let patch = null;
    if (target === 'browser-extension') patch = patchBrowserExtension(cwd, produced, warnings);
    else if (target === 'expo') patch = patchExpo(cwd, produced, warnings);
    else if (target === 'electron') patch = patchPackageIcon(cwd, produced, 'electron', 'icon.png', warnings);
    else if (target === 'vscode') patch = patchPackageIcon(cwd, produced, 'vscode', 'icon.png', warnings);
    else if (target === 'pwa') patch = patchPwa(cwd, produced, warnings);
    if (patch) patches.push(patch);
  }
  return patches;
}

module.exports = { applyPatches, detectJsonStyle };

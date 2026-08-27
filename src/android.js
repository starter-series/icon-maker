const fs = require('fs');
const path = require('path');
const { assertContainedExistingPath } = require('./path-safety');

const SKIP_DIRECTORIES = new Set([
  '.dart_tool',
  '.git',
  '.gradle',
  '.idea',
  '.next',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'Pods',
  'target',
  'vendor',
]);

const ANDROID_DENSITIES = [
  { name: 'mdpi', scale: 1, legacySize: 48, adaptiveSize: 108 },
  { name: 'hdpi', scale: 1.5, legacySize: 72, adaptiveSize: 162 },
  { name: 'xhdpi', scale: 2, legacySize: 96, adaptiveSize: 216 },
  { name: 'xxhdpi', scale: 3, legacySize: 144, adaptiveSize: 324 },
  { name: 'xxxhdpi', scale: 4, legacySize: 192, adaptiveSize: 432 },
];

function usageError(message) {
  const err = new Error(message);
  err.exitCode = 2;
  return err;
}

function isAndroidManifestPath(file) {
  const parts = path.normalize(file).split(path.sep);
  return parts.length >= 3
    && parts.at(-1) === 'AndroidManifest.xml'
    && parts.at(-2) === 'main'
    && parts.at(-3) === 'src';
}

function scanAndroidProject(cwd, maxDepth = 8) {
  const root = path.resolve(cwd);
  const manifests = [];

  function visit(directory, depth) {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (_err) {
      return;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === 'AndroidManifest.xml' && isAndroidManifestPath(absolutePath)) {
        manifests.push(absolutePath);
        continue;
      }
      if (
        entry.isDirectory()
        && depth < maxDepth
        && !SKIP_DIRECTORIES.has(entry.name)
        && !entry.name.startsWith('.')
      ) {
        visit(absolutePath, depth + 1);
      }
    }
  }

  visit(root, 0);
  manifests.sort((left, right) => left.localeCompare(right));
  return { manifests };
}

function androidProjectScan(cwd, context) {
  if (context?.androidScan) return context.androidScan;
  const scanned = scanAndroidProject(cwd);
  if (context) context.androidScan = scanned;
  return scanned;
}

function hasAndroidProject(cwd, context) {
  return androidProjectScan(cwd, context).manifests.length > 0;
}

function explicitAndroidManifest(cwd, configured) {
  if (typeof configured !== 'string' || !configured.trim()) {
    throw usageError('android.manifest must be a non-empty path');
  }
  const candidate = path.resolve(cwd, configured);
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    throw usageError(`android.manifest does not exist or is not a file: ${candidate}`);
  }
  if (!isAndroidManifestPath(candidate)) {
    throw usageError(`android.manifest must point to src/main/AndroidManifest.xml: ${candidate}`);
  }
  return assertContainedExistingPath(cwd, candidate, 'android.manifest');
}

function androidProjectContext(cwd, manifest) {
  const sourceSetDir = path.dirname(manifest);
  return {
    manifest,
    sourceSetDir,
    resDir: path.join(sourceSetDir, 'res'),
    moduleDir: path.resolve(sourceSetDir, '..', '..'),
    relativeManifest: path.relative(cwd, manifest).split(path.sep).join('/'),
  };
}

function resolveAndroidProject(cwd, config = {}, scanned = null) {
  const root = path.resolve(cwd);
  const realRoot = fs.realpathSync(root);
  if (Object.prototype.hasOwnProperty.call(config.android || {}, 'manifest')) {
    return androidProjectContext(realRoot, explicitAndroidManifest(root, config.android.manifest));
  }

  const candidates = (scanned || scanAndroidProject(root)).manifests || [];
  if (candidates.length === 1) {
    const manifest = assertContainedExistingPath(root, candidates[0], 'android.manifest');
    return androidProjectContext(realRoot, manifest);
  }
  if (candidates.length > 1) {
    const listed = candidates.map((file) => path.relative(root, file).split(path.sep).join('/')).join(', ');
    throw usageError(`multiple Android manifests found (${listed}); set android.manifest in icon-maker config`);
  }
  throw usageError('no Android src/main/AndroidManifest.xml found; set android.manifest in icon-maker config');
}

function validateResourceName(value, label) {
  const resourceName = String(value || '').trim();
  if (!/^[a-z][a-z0-9_]*$/.test(resourceName)) {
    throw usageError(`${label} must be a lowercase Android resource name: ${resourceName || '(empty)'}`);
  }
  return resourceName;
}

function validateAndroidColor(value) {
  const color = String(value || '').trim();
  if (!/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) {
    throw usageError(`android.backgroundColor must be #RRGGBB or #AARRGGBB: ${color || '(empty)'}`);
  }
  return color;
}

function renderAdaptiveIconXml(options = {}) {
  const foreground = validateResourceName(options.foregroundResourceName || 'ic_launcher_foreground', 'foregroundResourceName');
  const background = validateResourceName(options.backgroundResourceName || 'ic_launcher_background', 'backgroundResourceName');
  const monochrome = options.monochromeResourceName
    ? validateResourceName(options.monochromeResourceName, 'monochromeResourceName')
    : null;
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
    `    <background android:drawable="@color/${background}" />`,
    `    <foreground android:drawable="@mipmap/${foreground}" />`,
  ];
  if (monochrome) lines.push(`    <monochrome android:drawable="@mipmap/${monochrome}" />`);
  lines.push('</adaptive-icon>');
  return `${lines.join('\n')}\n`;
}

function renderAndroidColorXml(options = {}) {
  const resourceName = validateResourceName(options.backgroundResourceName || 'ic_launcher_background', 'backgroundResourceName');
  const color = validateAndroidColor(options.backgroundColor || '#FFFFFF');
  return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="${resourceName}">${color}</color>\n</resources>\n`;
}

function planAndroidIconFiles(options = {}) {
  const resourceName = validateResourceName(options.resourceName || 'ic_launcher', 'android.resourceName');
  const roundResourceName = validateResourceName(options.roundResourceName || `${resourceName}_round`, 'android.roundResourceName');
  const foregroundResourceName = validateResourceName(
    options.foregroundResourceName || `${resourceName}_foreground`,
    'android.foregroundResourceName',
  );
  const backgroundResourceName = validateResourceName(
    options.backgroundResourceName || `${resourceName}_background`,
    'android.backgroundResourceName',
  );
  const includeMonochrome = options.includeMonochrome === true;
  const monochromeResourceName = includeMonochrome
    ? validateResourceName(options.monochromeResourceName || `${resourceName}_monochrome`, 'android.monochromeResourceName')
    : null;
  const colorFileName = validateResourceName(options.colorFileName || `${resourceName}_colors`, 'android.colorFileName');
  const names = [resourceName, roundResourceName, foregroundResourceName, monochromeResourceName].filter(Boolean);
  if (new Set(names).size !== names.length) {
    throw usageError('Android launcher resource names must be distinct');
  }

  const files = [];
  for (const density of ANDROID_DENSITIES) {
    const directory = `mipmap-${density.name}`;
    files.push({
      path: `${directory}/${resourceName}.png`,
      format: 'png',
      size: density.legacySize,
      density: density.name,
      role: 'legacy',
      sourceRole: 'default',
    });
    files.push({
      path: `${directory}/${roundResourceName}.png`,
      format: 'png',
      size: density.legacySize,
      density: density.name,
      role: 'round',
      sourceRole: 'round',
      fallbackSourceRole: 'default',
    });
    files.push({
      path: `${directory}/${foregroundResourceName}.png`,
      format: 'png',
      size: density.adaptiveSize,
      density: density.name,
      role: 'adaptive-foreground',
      sourceRole: 'adaptive-foreground',
      transparentBackground: true,
    });
    if (monochromeResourceName) {
      files.push({
        path: `${directory}/${monochromeResourceName}.png`,
        format: 'png',
        size: density.adaptiveSize,
        density: density.name,
        role: 'monochrome',
        sourceRole: 'monochrome',
        transparentBackground: true,
      });
    }
  }

  const adaptiveContents = renderAdaptiveIconXml({
    backgroundResourceName,
    foregroundResourceName,
  });
  files.push({
    path: `mipmap-anydpi-v26/${resourceName}.xml`,
    format: 'xml',
    role: 'adaptive-definition',
    contents: adaptiveContents,
  });
  if (monochromeResourceName) {
    const themedContents = renderAdaptiveIconXml({
      backgroundResourceName,
      foregroundResourceName,
      monochromeResourceName,
    });
    files.push({
      path: `mipmap-anydpi-v33/${resourceName}.xml`,
      format: 'xml',
      role: 'themed-definition',
      contents: themedContents,
    });
    files.push({
      path: `mipmap-anydpi-v33/${roundResourceName}.xml`,
      format: 'xml',
      role: 'themed-round-definition',
      contents: themedContents,
    });
  }
  files.push({
    path: `mipmap-anydpi-v26/${roundResourceName}.xml`,
    format: 'xml',
    role: 'adaptive-round-definition',
    contents: adaptiveContents,
  });
  files.push({
    path: `values/${colorFileName}.xml`,
    format: 'xml',
    role: 'adaptive-background-color',
    contents: renderAndroidColorXml({
      backgroundColor: options.backgroundColor || '#FFFFFF',
      backgroundResourceName,
    }),
  });
  return files;
}

function findTagEnd(text, start) {
  let quote = null;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return index + 1;
    }
  }
  return -1;
}

function findDeclarationEnd(text, start) {
  let quote = null;
  let bracketDepth = 0;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '[') {
      bracketDepth += 1;
    } else if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (char === '>' && bracketDepth === 0) {
      return index + 1;
    }
  }
  return text.length;
}

function findApplicationTags(text) {
  const tags = [];
  let index = 0;
  while (index < text.length) {
    const start = text.indexOf('<', index);
    if (start === -1) break;
    if (text.startsWith('<!--', start)) {
      const end = text.indexOf('-->', start + 4);
      index = end === -1 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', start)) {
      const end = text.indexOf(']]>', start + 9);
      index = end === -1 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<?', start)) {
      const end = text.indexOf('?>', start + 2);
      index = end === -1 ? text.length : end + 2;
      continue;
    }
    if (text.startsWith('<!', start)) {
      index = findDeclarationEnd(text, start + 2);
      continue;
    }
    if (text.startsWith('</', start)) {
      const end = findTagEnd(text, start + 2);
      index = end === -1 ? text.length : end;
      continue;
    }

    let nameStart = start + 1;
    while (/\s/.test(text[nameStart] || '')) nameStart += 1;
    let nameEnd = nameStart;
    while (/[A-Za-z0-9_.:-]/.test(text[nameEnd] || '')) nameEnd += 1;
    const tagEnd = findTagEnd(text, nameEnd);
    if (tagEnd === -1) break;
    if (text.slice(nameStart, nameEnd) === 'application') {
      tags.push({ start, end: tagEnd, text: text.slice(start, tagEnd) });
    }
    index = tagEnd;
  }
  return tags;
}

function findAndroidAttributes(tag, name) {
  const matches = [];
  const pattern = new RegExp(`\\bandroid:${name}\\s*=\\s*(["'])`, 'g');
  let match;
  while ((match = pattern.exec(tag))) {
    const quote = match[1];
    const valueStart = pattern.lastIndex;
    const valueEnd = tag.indexOf(quote, valueStart);
    if (valueEnd === -1) break;
    matches.push({ value: tag.slice(valueStart, valueEnd), start: valueStart, end: valueEnd });
    pattern.lastIndex = valueEnd + 1;
  }
  return matches;
}

function isDynamicManifestValue(value) {
  return String(value).startsWith('?') || /\$\{|\$\(|@\{|\{\{|\}\}|%[A-Z0-9_]+%/.test(value);
}

function lineIndentAt(text, index) {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  return (text.slice(lineStart, index).match(/^[ \t]*/) || [''])[0];
}

function insertionForMissingAttributes(documentText, tag, missing) {
  if (!missing.length) return null;
  const closeLength = tag.text.endsWith('/>') ? 2 : 1;
  const closeIndex = tag.text.length - closeLength;
  const rendered = missing.map(({ name, value }) => `android:${name}="${value}"`);
  if (!/\r?\n/.test(tag.text)) {
    const separator = /\s$/.test(tag.text.slice(0, closeIndex)) ? '' : ' ';
    return { start: closeIndex, end: closeIndex, value: `${separator}${rendered.join(' ')}` };
  }

  const eol = documentText.includes('\r\n') ? '\r\n' : '\n';
  const existingIndent = tag.text.match(/\r?\n([ \t]+)[A-Za-z_:]/)?.[1];
  const attributeIndent = existingIndent || `${lineIndentAt(documentText, tag.start)}    `;
  const lastNewline = tag.text.lastIndexOf('\n', closeIndex - 1);
  const beforeClose = tag.text.slice(lastNewline + 1, closeIndex);
  const lines = rendered.map((attribute) => `${attributeIndent}${attribute}`).join(eol);
  if (beforeClose.trim() === '') {
    return { start: lastNewline + 1, end: lastNewline + 1, value: `${lines}${eol}` };
  }
  return { start: closeIndex, end: closeIndex, value: `${eol}${lines}` };
}

function applyTextEdits(text, edits) {
  let next = text;
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    next = `${next.slice(0, edit.start)}${edit.value}${next.slice(edit.end)}`;
  }
  return next;
}

function manifestWarning(code, message) {
  return { code, message };
}

function hasInvalidXmlEntity(value) {
  return /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(value);
}

function validateStartTag(tag, name) {
  const closingLength = /\/\s*>$/.test(tag) ? 2 : 1;
  const limit = tag.length - closingLength;
  const names = new Set();
  let index = 1 + name.length;
  while (index < limit) {
    if (!/\s/.test(tag[index])) return `attribute after <${name}> is not separated by whitespace`;
    while (index < limit && /\s/.test(tag[index])) index += 1;
    if (index >= limit) break;
    const nameStart = index;
    if (!/[A-Za-z_:]/.test(tag[index])) return `attribute name in <${name}> is invalid`;
    index += 1;
    while (index < limit && /[A-Za-z0-9_.:-]/.test(tag[index])) index += 1;
    const attributeName = tag.slice(nameStart, index);
    if (names.has(attributeName)) return `<${name}> repeats ${attributeName}`;
    names.add(attributeName);
    while (index < limit && /\s/.test(tag[index])) index += 1;
    if (tag[index] !== '=') return `${attributeName} in <${name}> has no value`;
    index += 1;
    while (index < limit && /\s/.test(tag[index])) index += 1;
    const quote = tag[index];
    if (quote !== '"' && quote !== "'") return `${attributeName} in <${name}> is not quoted`;
    const valueStart = index + 1;
    const valueEnd = tag.indexOf(quote, valueStart);
    if (valueEnd === -1 || valueEnd > limit) return `${attributeName} in <${name}> is unterminated`;
    const value = tag.slice(valueStart, valueEnd);
    if (value.includes('<') || hasInvalidXmlEntity(value)) {
      return `${attributeName} in <${name}> contains invalid XML text`;
    }
    index = valueEnd + 1;
  }
  return null;
}

function androidNamespaceError(text) {
  const start = text.search(/<manifest(?:\s|>)/);
  if (start === -1) return 'AndroidManifest.xml has no <manifest> root start tag';
  const end = findTagEnd(text, start + '<manifest'.length);
  if (end === -1) return 'AndroidManifest.xml has an unterminated <manifest> root start tag';
  const tag = text.slice(start, end);
  const namespace = tag.match(/\bxmlns:android\s*=\s*(["'])(.*?)\1/);
  if (!namespace) return 'AndroidManifest.xml must declare xmlns:android on the <manifest> root';
  if (namespace[2] !== 'http://schemas.android.com/apk/res/android') {
    return 'AndroidManifest.xml has an unsupported xmlns:android value';
  }
  return null;
}

function validateAndroidManifestStructure(contents) {
  const text = String(contents);
  const stack = [];
  const roots = [];
  let index = 0;
  let seenXmlDeclaration = false;
  let seenDoctype = false;
  while (index < text.length) {
    const start = text.indexOf('<', index);
    if (start === -1) break;
    const between = text.slice(index, start).replace(index === 0 ? /^\uFEFF/ : /$^/, '');
    if (stack.length && hasInvalidXmlEntity(between)) {
      return 'element text contains an unescaped or invalid entity';
    }
    if (!stack.length && between.trim()) {
      return 'non-whitespace content appears outside the root element';
    }
    if (text.startsWith('<!--', start)) {
      const end = text.indexOf('-->', start + 4);
      if (end === -1) return 'unterminated XML comment';
      if (text.slice(start + 4, end).includes('--')) return 'XML comment contains --';
      index = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', start)) {
      if (!stack.length) return 'CDATA section appears outside the root element';
      const end = text.indexOf(']]>', start + 9);
      if (end === -1) return 'unterminated CDATA section';
      index = end + 3;
      continue;
    }
    if (text.startsWith('<?', start)) {
      const end = text.indexOf('?>', start + 2);
      if (end === -1) return 'unterminated processing instruction';
      const instruction = text.slice(start + 2, end).trim();
      if (/^xml(?:\s|$)/i.test(instruction)) {
        const prefix = text.slice(0, start).replace(/^\uFEFF/, '');
        if (seenXmlDeclaration || roots.length || stack.length || prefix.trim()) {
          return 'XML declaration must appear once at the start of the document';
        }
        if (!/^xml\s+version\s*=\s*(["'])1\.[01]\1(?:\s+[\s\S]*)?$/i.test(instruction)) {
          return 'XML declaration is malformed';
        }
        seenXmlDeclaration = true;
      } else if (!/^[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s|$)/.test(instruction)) {
        return 'processing instruction target is invalid';
      }
      index = end + 2;
      continue;
    }
    if (text.startsWith('<!', start)) {
      const end = findDeclarationEnd(text, start + 2);
      if (end === text.length && text.at(-1) !== '>') return 'unterminated declaration';
      const declaration = text.slice(start + 2, end - 1).trim();
      if (!/^DOCTYPE(?:\s|$)/.test(declaration) || seenDoctype || roots.length || stack.length) {
        return 'declaration must be one DOCTYPE before the root element';
      }
      seenDoctype = true;
      index = end;
      continue;
    }

    const closing = text.startsWith('</', start);
    let nameStart = start + (closing ? 2 : 1);
    while (/\s/.test(text[nameStart] || '')) nameStart += 1;
    let nameEnd = nameStart;
    while (/[A-Za-z0-9_.:-]/.test(text[nameEnd] || '')) nameEnd += 1;
    const name = text.slice(nameStart, nameEnd);
    if (!/^[A-Za-z_:][A-Za-z0-9_.:-]*$/.test(name)) return 'element name is missing or invalid';
    const end = findTagEnd(text, nameEnd);
    if (end === -1) return `unterminated <${name}> element`;
    const tag = text.slice(start, end);
    if (closing) {
      if (tag.slice(nameEnd - start, -1).trim()) return `closing </${name}> element is malformed`;
      if (stack.pop() !== name) return `closing </${name}> element does not match the open element`;
    } else {
      const tagError = validateStartTag(tag, name);
      if (tagError) return tagError;
      if (!stack.length) roots.push(name);
      if (!/\/\s*>$/.test(tag)) stack.push(name);
    }
    index = end;
  }
  const trailing = text.slice(index);
  if (stack.length && hasInvalidXmlEntity(trailing)) {
    return 'element text contains an unescaped or invalid entity';
  }
  if (!stack.length && trailing.trim()) {
    return 'non-whitespace content appears outside the root element';
  }
  if (stack.length) return `unclosed <${stack.at(-1)}> element`;
  if (roots.length !== 1 || roots[0] !== 'manifest') return 'root element must be exactly one <manifest>';
  return null;
}

function planAndroidManifestPatch(contents, options = {}) {
  const text = String(contents);
  const resourceName = validateResourceName(options.resourceName || 'ic_launcher', 'android.resourceName');
  const roundResourceName = validateResourceName(options.roundResourceName || `${resourceName}_round`, 'android.roundResourceName');
  const desired = [
    { name: 'icon', value: `@mipmap/${resourceName}` },
    { name: 'roundIcon', value: `@mipmap/${roundResourceName}` },
  ];
  const structureError = validateAndroidManifestStructure(text);
  if (structureError) {
    return {
      changed: false,
      contents: text,
      warnings: [],
      errors: [{
        code: 'android-manifest-invalid',
        message: `AndroidManifest.xml is not structurally valid: ${structureError}`,
      }],
      attributes: desired,
    };
  }
  const namespaceError = androidNamespaceError(text);
  if (namespaceError) {
    return {
      changed: false,
      contents: text,
      warnings: [],
      errors: [{ code: 'android-manifest-namespace-invalid', message: namespaceError }],
      attributes: desired,
    };
  }
  const tags = findApplicationTags(text);
  if (tags.length !== 1) {
    const code = tags.length ? 'android-manifest-ambiguous-application' : 'android-manifest-application-missing';
    const message = tags.length
      ? `AndroidManifest.xml has ${tags.length} application elements; icon fields were not changed`
      : 'AndroidManifest.xml has no application element; icon fields were not changed';
    return { changed: false, contents: text, warnings: [manifestWarning(code, message)], attributes: desired };
  }

  const tag = tags[0];
  const inspected = desired.map((attribute) => ({
    ...attribute,
    matches: findAndroidAttributes(tag.text, attribute.name),
  }));
  const duplicates = inspected.filter((attribute) => attribute.matches.length > 1);
  if (duplicates.length) {
    return {
      changed: false,
      contents: text,
      warnings: [manifestWarning(
        'android-manifest-ambiguous-icon-attributes',
        `AndroidManifest.xml repeats ${duplicates.map((item) => `android:${item.name}`).join(', ')}; icon fields were not changed`,
      )],
      attributes: desired,
    };
  }
  const dynamic = inspected.filter((attribute) => attribute.matches.some((match) => isDynamicManifestValue(match.value)));
  if (dynamic.length) {
    return {
      changed: false,
      contents: text,
      warnings: [manifestWarning(
        'android-manifest-dynamic-icon',
        `AndroidManifest.xml uses dynamic ${dynamic.map((item) => `android:${item.name}`).join(', ')}; icon fields were not changed`,
      )],
      attributes: desired,
    };
  }

  const tagEdits = [];
  const missing = [];
  for (const attribute of inspected) {
    const match = attribute.matches[0];
    if (!match) {
      missing.push(attribute);
    } else if (match.value !== attribute.value) {
      tagEdits.push({ start: match.start, end: match.end, value: attribute.value });
    }
  }
  const insertion = insertionForMissingAttributes(text, tag, missing);
  if (insertion) tagEdits.push(insertion);
  if (!tagEdits.length) return { changed: false, contents: text, warnings: [], attributes: desired };

  const nextTag = applyTextEdits(tag.text, tagEdits);
  const next = `${text.slice(0, tag.start)}${nextTag}${text.slice(tag.end)}`;
  return { changed: next !== text, contents: next, warnings: [], attributes: desired };
}

module.exports = {
  ANDROID_DENSITIES,
  androidProjectScan,
  hasAndroidProject,
  planAndroidIconFiles,
  planAndroidManifestPatch,
  renderAdaptiveIconXml,
  renderAndroidColorXml,
  resolveAndroidProject,
  scanAndroidProject,
  validateAndroidManifestStructure,
};

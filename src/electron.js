const fs = require('fs');
const path = require('path');

const DYNAMIC_FORGE_CONFIG_NAMES = [
  'forge.config.js',
  'forge.config.cjs',
  'forge.config.mjs',
  'forge.config.ts',
  'forge.config.cts',
  'forge.config.mts',
];

const EXTERNAL_BUILDER_CONFIG_NAMES = ['yml', 'yaml', 'json', 'json5', 'toml', 'js', 'cjs', 'mjs', 'ts']
  .map((extension) => `electron-builder.${extension}`);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function dependencyNames(packageJson) {
  const sections = [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.optionalDependencies,
    packageJson.peerDependencies,
  ];
  return new Set(sections.flatMap((section) => (
    isPlainObject(section) ? Object.keys(section) : []
  )));
}

function findDynamicForgeConfigs(cwd) {
  return DYNAMIC_FORGE_CONFIG_NAMES
    .map((name) => path.join(cwd, name))
    .filter((file) => fs.existsSync(file));
}

function detectElectronProvider(packageJson, options = {}) {
  const dependencies = dependencyNames(packageJson);
  const builder = dependencies.has('electron-builder') || isPlainObject(packageJson.build);
  const staticForge = isPlainObject(packageJson.config?.forge?.packagerConfig);
  const forgeDependency = dependencies.has('@electron-forge/cli') || dependencies.has('electron-forge');
  const dynamicForgeConfigs = options.dynamicForgeConfigs || [];
  const forge = staticForge || forgeDependency || dynamicForgeConfigs.length > 0;

  if (builder && forge) {
    return { provider: 'ambiguous', dynamicForgeConfigs, staticForge };
  }
  if (builder) {
    return { provider: 'electron-builder', dynamicForgeConfigs: [], staticForge: false };
  }
  if (dynamicForgeConfigs.length) {
    return { provider: 'electron-forge-dynamic', dynamicForgeConfigs, staticForge };
  }
  if (staticForge) {
    return { provider: 'electron-forge', dynamicForgeConfigs, staticForge: true };
  }
  if (forgeDependency || packageJson.config?.forge !== undefined) {
    return { provider: 'electron-forge-unsupported', dynamicForgeConfigs, staticForge: false };
  }
  return { provider: 'unknown', dynamicForgeConfigs: [], staticForge: false };
}

function portableRelative(cwd, absolutePath) {
  return path.relative(cwd, absolutePath).split(path.sep).join('/');
}

function producedPath(cwd, produced, basename) {
  const item = produced.find((entry) => (
    entry.target === 'electron' && path.basename(entry.path) === basename
  ));
  return item ? portableRelative(cwd, item.path) : null;
}

function normalizedConfigPath(value) {
  if (typeof value !== 'string') return null;
  return path.posix.normalize(value.replace(/\\/g, '/').replace(/^\.\//, ''));
}

function sameConfigPath(left, right) {
  const normalizedLeft = normalizedConfigPath(left);
  const normalizedRight = normalizedConfigPath(right);
  return normalizedLeft !== null && normalizedLeft === normalizedRight;
}

function warnMissingOutput(warnings, provider, platform, basename) {
  warnings.push({
    code: 'electron-icon-output-missing',
    message: `${provider} ${platform} wiring skipped because generated ${basename} was not found`,
  });
}

function setManagedIcon(parent, key, desired, provider, platform, warnings) {
  if (Object.prototype.hasOwnProperty.call(parent, key)) {
    if (sameConfigPath(parent[key], desired)) return false;
    warnings.push({
      code: 'electron-icon-unmanaged',
      message: `${provider} ${platform} icon already points to an unmanaged value; leaving it unchanged`,
    });
    return false;
  }
  parent[key] = desired;
  return true;
}

function planElectronBuilderWiring(cwd, packageJson, produced, warnings = []) {
  const desired = [
    { platform: 'mac', basename: 'icon.icns' },
    { platform: 'win', basename: 'icon.ico' },
    { platform: 'linux', basename: 'icon.png' },
  ].map((entry) => ({ ...entry, icon: producedPath(cwd, produced, entry.basename) }));
  for (const entry of desired) {
    if (!entry.icon) warnMissingOutput(warnings, 'electron-builder', entry.platform, entry.basename);
  }
  if (!desired.some((entry) => entry.icon)) return { changed: false, complete: false };

  if (packageJson.build !== undefined && !isPlainObject(packageJson.build)) {
    warnings.push({
      code: 'electron-builder-config-unsupported',
      message: 'package.json build config is not an object; leaving it unchanged',
    });
    return { changed: false, complete: false };
  }
  const build = packageJson.build || {};
  let changed = false;
  let complete = true;
  for (const entry of desired) {
    if (!entry.icon) {
      complete = false;
      continue;
    }
    if (build[entry.platform] !== undefined && !isPlainObject(build[entry.platform])) {
      warnings.push({
        code: 'electron-builder-config-unsupported',
        message: `package.json build.${entry.platform} is not an object; leaving it unchanged`,
      });
      complete = false;
      continue;
    }
    const platform = build[entry.platform] || {};
    const wired = setManagedIcon(
      platform,
      'icon',
      entry.icon,
      'electron-builder',
      entry.platform,
      warnings,
    );
    if (!wired && !sameConfigPath(platform.icon, entry.icon)) complete = false;
    if (wired) {
      build[entry.platform] = platform;
      changed = true;
    }
  }
  if (changed) packageJson.build = build;
  return { changed, complete };
}

function forgeIconBase(cwd, produced, warnings) {
  const icns = producedPath(cwd, produced, 'icon.icns');
  const ico = producedPath(cwd, produced, 'icon.ico');
  if (!icns) warnMissingOutput(warnings, 'Electron Forge', 'mac', 'icon.icns');
  if (!ico) warnMissingOutput(warnings, 'Electron Forge', 'win', 'icon.ico');
  if (!icns || !ico) return null;
  const icnsBase = icns.slice(0, -path.posix.extname(icns).length);
  const icoBase = ico.slice(0, -path.posix.extname(ico).length);
  if (icnsBase !== icoBase) {
    warnings.push({
      code: 'electron-forge-icon-base-mismatch',
      message: 'Electron Forge needs matching extensionless ICNS and ICO paths; leaving config unchanged',
    });
    return null;
  }
  return icnsBase;
}

function planElectronForgeWiring(cwd, packageJson, produced, warnings = []) {
  const packagerConfig = packageJson.config?.forge?.packagerConfig;
  if (!isPlainObject(packagerConfig)) {
    warnings.push({
      code: 'electron-forge-static-config-required',
      message: 'Electron Forge wiring requires package.json config.forge.packagerConfig as a static object',
    });
    return { changed: false, complete: false };
  }
  const icon = forgeIconBase(cwd, produced, warnings);
  if (!icon) return { changed: false, complete: false };
  const changed = setManagedIcon(
    packagerConfig,
    'icon',
    icon,
    'Electron Forge',
    'packagerConfig',
    warnings,
  );
  return { changed, complete: changed || sameConfigPath(packagerConfig.icon, icon) };
}

function dynamicConfigList(cwd, options) {
  if (Object.prototype.hasOwnProperty.call(options, 'dynamicForgeConfigs')) {
    return options.dynamicForgeConfigs || [];
  }
  return findDynamicForgeConfigs(cwd);
}

function planElectronWiring(cwd, packageJson, produced, warnings = [], options = {}) {
  const dynamicForgeConfigs = dynamicConfigList(cwd, options);
  const detected = detectElectronProvider(packageJson, { dynamicForgeConfigs });
  let result;
  if (detected.provider === 'electron-builder') {
    const external = EXTERNAL_BUILDER_CONFIG_NAMES.filter((name) => fs.existsSync(path.join(cwd, name)));
    const scripts = isPlainObject(packageJson.scripts) ? Object.values(packageJson.scripts) : [];
    const explicitConfig = scripts.some((script) => typeof script === 'string'
      && /\belectron-builder\b/.test(script) && /(?:^|\s)(?:--config|-c)(?:[=\s]|$)/.test(script));
    if (external.length || explicitConfig) {
      warnings.push({
        code: 'electron-builder-external-config',
        message: 'external electron-builder configuration detected; package.json icon wiring is unverified and will not be changed',
      });
      result = { changed: false, complete: false };
    } else {
      result = planElectronBuilderWiring(cwd, packageJson, produced, warnings);
    }
  } else if (detected.provider === 'electron-forge') {
    result = planElectronForgeWiring(cwd, packageJson, produced, warnings);
  } else if (detected.provider === 'ambiguous') {
    warnings.push({
      code: 'electron-provider-ambiguous',
      message: 'both electron-builder and Electron Forge signals were found; leaving package.json unchanged',
    });
    result = { changed: false, complete: false };
  } else if (detected.provider === 'electron-forge-dynamic') {
    const listed = dynamicForgeConfigs.map((file) => portableRelative(cwd, file)).join(', ');
    warnings.push({
      code: 'electron-forge-dynamic-config',
      message: `dynamic Electron Forge config detected (${listed}); update it manually`,
    });
    result = { changed: false, complete: false };
  } else if (detected.provider === 'electron-forge-unsupported') {
    warnings.push({
      code: 'electron-forge-static-config-required',
      message: 'Electron Forge is present without a static package.json packagerConfig; leaving config unchanged',
    });
    result = { changed: false, complete: false };
  } else {
    warnings.push({
      code: 'electron-packager-unknown',
      message: 'no supported Electron packager configuration was found; leaving package.json unchanged',
    });
    result = { changed: false, complete: false };
  }
  return {
    ...result,
    provider: detected.provider,
    patch: result.changed
      ? { target: 'electron', action: `updated ${detected.provider} icon wiring` }
      : null,
  };
}

module.exports = {
  DYNAMIC_FORGE_CONFIG_NAMES,
  detectElectronProvider,
  findDynamicForgeConfigs,
  planElectronBuilderWiring,
  planElectronForgeWiring,
  planElectronWiring,
};
